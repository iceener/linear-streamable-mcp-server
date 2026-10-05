import { expect } from 'bun:test';
import { MemoryOAuthAuthority, type OAuthAuthority } from '../../src/oauth/authority';
import { opaqueToken, pkceChallenge } from '../../src/oauth/crypto';
import type { OAuthProxy, OAuthProxyOptions } from '../../src/oauth/proxy';
import { MemoryTokenStore, type TokenStore } from '../../src/oauth/token-store';
import type { App } from '../../src/platform/app';
import { createServer } from '../../src/server';
import { LINEAR_SCOPES } from '../../src/services/linear-oauth';
import {
  type FetchRoute,
  fakeFetch,
  type LogEntry,
  memoryLogger,
  testApp,
  testConfig,
  testDeps,
  testProxy,
} from '../helpers';

/** The test server's origin. It is its own authorization server. */
export const ORIGIN = 'http://127.0.0.1:3000';
export const HOST = '127.0.0.1:3000';
export const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
export const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
export const CALLBACK = `${ORIGIN}/oauth/callback`;
export const VERIFIER = 'v'.repeat(43);
export const SCOPE = LINEAR_SCOPES.join(' ');

export const PROXY_ENV: Record<string, string> = {
  AUTH_MODE: 'oauth',
  OAUTH_ISSUER_URL: ORIGIN,
  OAUTH_AUTHORIZATION_URL: `${ORIGIN}/authorize`,
  OAUTH_TOKEN_URL: `${ORIGIN}/token`,
  OAUTH_REGISTRATION_URL: `${ORIGIN}/register`,
  OAUTH_SCOPES: SCOPE,
  MCP_ALLOWED_ORIGIN_HOSTNAMES: '127.0.0.1,client.example',
};

/** Linear's token endpoint, answering every code and refresh token with fresh tokens. */
export function linearTokens(
  answer: (form: URLSearchParams) => Response | Promise<Response> = (form) =>
    Response.json({
      access_token: form.get('grant_type') === 'refresh_token' ? 'linear-fresh' : 'linear-access',
      refresh_token: 'linear-refresh',
      expires_in: 3600,
      scope: SCOPE,
    }),
) {
  const forms: URLSearchParams[] = [];
  const route: FetchRoute = async (request) => {
    if (request.url !== LINEAR_TOKEN_URL) return undefined;
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toBe(
      `Basic ${btoa('linear-client:linear-secret')}`,
    );
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(await request.text());
    forms.push(form);
    return answer(form);
  };
  return Object.assign(fakeFetch(route), { forms });
}

export interface ProxyFixture {
  app: App;
  proxy: OAuthProxy;
  tokens: TokenStore;
  authority: OAuthAuthority;
  linear: ReturnType<typeof linearTokens>;
  logs: LogEntry[];
  /** GET without a body, POST with one: JSON, a form, or a raw string. */
  request(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
}

/** The whole server in OAuth mode, its state in memory, Linear answered by `linear`. */
export function proxyFixture(
  options: Partial<
    Pick<
      OAuthProxyOptions,
      | 'tokens'
      | 'authority'
      | 'redirectAllowlist'
      | 'encryptionKey'
      | 'credentials'
      | 'provider'
      | 'bindGrants'
    >
  > & {
    linear?: ReturnType<typeof linearTokens>;
    env?: Record<string, string>;
  } = {},
): ProxyFixture {
  const config = testConfig({ ...PROXY_ENV, ...options.env });
  const logs: LogEntry[] = [];
  const logger = memoryLogger(logs);
  const linear = options.linear ?? linearTokens();
  const tokens = options.tokens ?? new MemoryTokenStore();
  const authority = options.authority ?? new MemoryOAuthAuthority();
  const proxy = testProxy({
    config,
    logger,
    tokens,
    authority,
    fetch: linear,
    ...(options.redirectAllowlist && { redirectAllowlist: options.redirectAllowlist }),
    ...(options.encryptionKey && { encryptionKey: options.encryptionKey }),
    ...(options.credentials && { credentials: options.credentials }),
    ...(options.provider && { provider: options.provider }),
    ...(options.bindGrants !== undefined && { bindGrants: options.bindGrants }),
  });
  const app = testApp(config, {
    deps: testDeps({ config, logger, oauth: proxy }),
    server: createServer,
  });

  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const form = body instanceof URLSearchParams;
    return app.fetch(
      new Request(new URL(path, ORIGIN).href, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Host: HOST,
          ...(body !== undefined && {
            'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
          }),
          ...headers,
        },
        ...(body !== undefined && {
          body: form || typeof body === 'string' ? String(body) : JSON.stringify(body),
        }),
      }),
    );
  };
  return { app, proxy, tokens, authority, linear, logs, request };
}

/** A loopback redirect URI on a port the OS really assigned, as native clients use. */
export function loopback(path = '/oauth/callback'): string {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') });
  const uri = `http://127.0.0.1:${server.port}${path}`;
  server.stop(true);
  return uri;
}

export interface Registered {
  client_id: string;
  redirect_uris: string[];
}

export async function registerNative(f: ProxyFixture, redirectUri: string): Promise<Registered> {
  const response = await f.request('/register', {
    application_type: 'native',
    token_endpoint_auth_method: 'none',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const client = (await response.json()) as Registered;
  expect(client).not.toHaveProperty('registration_access_token');
  expect(client).not.toHaveProperty('registration_client_uri');
  return client;
}

export async function authorize(
  f: ProxyFixture,
  clientId: string,
  redirectUri: string,
  fields: Record<string, string> = {},
): Promise<Response> {
  return f.request(
    `/authorize?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge: await pkceChallenge(VERIFIER),
      code_challenge_method: 'S256',
      state: 'original opaque state & / +',
      ...fields,
    })}`,
  );
}

/** Authorize, then come back from Linear: the client's code and the transaction handle. */
export async function codeFor(
  f: ProxyFixture,
  clientId: string,
  redirectUri: string,
): Promise<{ code: string; state: string }> {
  const response = await authorize(f, clientId, redirectUri);
  expect(response.status).toBe(302);
  const linear = new URL(response.headers.get('location') as string);
  expect(linear.origin + linear.pathname).toBe(LINEAR_AUTHORIZE_URL);
  expect(linear.searchParams.get('scope')).toBe(SCOPE);
  expect(linear.searchParams.get('client_id')).toBe('linear-client');
  const state = linear.searchParams.get('state') as string;
  expect(state).toMatch(/^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{32}$/);
  // Linear never sees the client's redirect URI or state.
  expect(linear.href).not.toContain(encodeURIComponent(redirectUri));
  expect(linear.href).not.toContain('original');
  const callback = await f.request(
    `/oauth/callback?${new URLSearchParams({ code: 'linear-code', state })}`,
  );
  expect(callback.status).toBe(302);
  const target = new URL(callback.headers.get('location') as string);
  expect(target.origin + target.pathname).toBe(redirectUri);
  expect(target.searchParams.get('state')).toBe('original opaque state & / +');
  return { code: target.searchParams.get('code') as string, state };
}

export function redeem(
  f: ProxyFixture,
  clientId: string,
  redirectUri: string,
  code: string,
  overrides: Record<string, string> = {},
): Promise<Response> {
  return f.request(
    '/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: VERIFIER,
      ...overrides,
    }),
  );
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  scope: string;
}

/** A unique handle in the shape the authority routes on. */
export const handleFor = (clientId: string) => `${clientId}.${opaqueToken(24)}`;
