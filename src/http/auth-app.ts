import { oauthMetadataResponse } from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { buildOAuthRoutes } from '../adapters/http-hono/routes.oauth.js';
import type { UnifiedConfig } from '../shared/config/env.js';
import type { TokenStore } from '../shared/storage/interface.js';
import { createAuthServices } from './auth.js';
import { requestSecurityResponse } from './security.js';

/** Build the Bun OAuth proxy that continues to run on PORT+1. */
export function buildAuthApp(
  config: UnifiedConfig,
  store: TokenStore,
  oauthProxyBaseUrl: URL,
) {
  const app = new Hono();
  const auth = createAuthServices(config, store, oauthProxyBaseUrl);
  if (!auth) return app;

  app.use('*', async (context, next) => {
    const request = context.req.raw;
    const rejected = requestSecurityResponse(request, config);
    if (rejected) return rejected;
    const metadata = oauthMetadataResponse(request, auth.metadata);
    if (metadata) return metadata;
    await next();
  });

  app.route('/', buildOAuthRoutes(store, config));
  app.notFound((context) => context.text('Not Found', 404));
  return app;
}
