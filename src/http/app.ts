import {
  type AuthInfo,
  type OAuthTokenVerifier,
  oauthMetadataResponse,
  type ServerEventBus,
  type ServerNotifier,
} from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { buildOAuthRoutes } from '../adapters/http-hono/routes.oauth.js';
import { createMcpRuntime } from '../core/runtime.js';
import type { UnifiedConfig } from '../shared/config/env.js';
import type { TokenStore } from '../shared/storage/interface.js';
import type { ToolRegistrationOptions } from '../tools/index.js';
import { createAuthServices, defaultOAuthProxyBaseUrl } from './auth.js';
import { boundedMcpRequest } from './body.js';
import {
  corsPreflightResponse,
  requestSecurityResponse,
  withCors,
} from './security.js';

export interface HttpRuntimeOptions extends ToolRegistrationOptions {
  runtimeName: string;
  tokenStore: TokenStore;
  verifier?: OAuthTokenVerifier;
  eventBus?: ServerEventBus;
  mountOAuthRoutes?: boolean;
  oauthProxyBaseUrl?: URL;
}

export interface HttpRuntime {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
  notify: ServerNotifier;
}

/** Fetch-native HTTP shell shared by Bun and Cloudflare Workers. */
export function buildHttpApp(
  config: UnifiedConfig,
  options: HttpRuntimeOptions,
): HttpRuntime {
  const mcp = createMcpRuntime(config, {
    ...(options.eventBus ? { eventBus: options.eventBus } : {}),
    ...(options.linearClientFactory
      ? { linearClientFactory: options.linearClientFactory }
      : {}),
    ...(options.onToolContext ? { onToolContext: options.onToolContext } : {}),
  });
  const oauthProxyBaseUrl =
    options.oauthProxyBaseUrl ??
    defaultOAuthProxyBaseUrl(config, options.mountOAuthRoutes === true);
  const auth = createAuthServices(
    config,
    options.tokenStore,
    oauthProxyBaseUrl,
    options.verifier,
  );
  const mcpPath = config.MCP_PUBLIC_URL.pathname;
  const app = new Hono();

  app.use('*', async (context, next) => {
    const request = context.req.raw;
    const rejected = requestSecurityResponse(request, config);
    if (rejected) return rejected;
    if (auth) {
      const metadata = oauthMetadataResponse(request, auth.metadata);
      if (metadata) return metadata;
    }
    await next();
  });

  app.get('/health', (context) =>
    context.json({
      status: 'ok',
      runtime: options.runtimeName,
      protocol: '2026-07-28',
      legacyMode: config.MCP_LEGACY_MODE,
      authEnabled: config.AUTH_ENABLED,
      timestamp: new Date().toISOString(),
    }),
  );

  if (auth) {
    const protectedMetadata = () => Response.json(auth.protectedResourceMetadata);
    app.get('/.well-known/oauth-protected-resource', protectedMetadata);
    app.get(`${mcpPath}/.well-known/oauth-protected-resource`, protectedMetadata);
    app.get(`${mcpPath}/.well-known/oauth-authorization-server`, () =>
      Response.json(auth.metadata.oauthMetadata),
    );
  }

  if (options.mountOAuthRoutes && config.AUTH_ENABLED) {
    app.route('/', buildOAuthRoutes(options.tokenStore, config));
  }

  app.options(mcpPath, (context) => corsPreflightResponse(context.req.raw));

  app.all(mcpPath, async (context) => {
    const request = context.req.raw;
    let authInfo: AuthInfo | undefined;
    if (auth) {
      const authResult = await auth.gate(request);
      if (authResult instanceof Response) {
        return withCors(request, authResult);
      }
      authInfo = authResult;
    }

    const bounded = await boundedMcpRequest(request, config.MCP_MAX_REQUEST_BYTES);
    if (bounded.rejection) return withCors(request, bounded.rejection);

    const response = await mcp.fetch(
      bounded.request,
      authInfo ? { authInfo } : undefined,
    );
    return withCors(request, response);
  });

  app.notFound((context) => context.text('Not Found', 404));

  return {
    fetch: async (request) => app.fetch(request),
    close: mcp.close,
    notify: mcp.notify,
  };
}
