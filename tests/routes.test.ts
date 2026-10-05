import { afterEach, expect, test } from 'bun:test';
import { MemoryOAuthAuthority } from '../src/oauth/authority';
import { pkceChallenge } from '../src/oauth/crypto';
import { MemoryTokenStore } from '../src/oauth/token-store';
import { type App, createApp } from '../src/platform/app';
import { parseConfig } from '../src/platform/config';
import { createDeps } from '../src/server';
import before from './fixtures/routes-before.json';
import { cleanup, fakeFetch, linearFactory, memoryLogger, testProxy, track } from './helpers';
import { createMockLinearClient } from './mocks/linear-client';
import { PRODUCTION_VARS } from './production-config';

afterEach(cleanup);

/**
 * The public routes, compared with what the deployed code answered before the migration
 * (`fixtures/routes-before.json`, recorded in workerd). The server runs here with the
 * production vars from `wrangler.production.example.jsonc`, in process: Linear's token endpoint and API are fakes.
 */
const ORIGIN = 'https://linear-mcp.example.workers.dev';
const HOST = 'linear-mcp.example.workers.dev';
const NATIVE = 'http://127.0.0.1:43210/oauth/callback';
const VERIFIER = 'v'.repeat(43);

/** Unknown paths answer JSON, as the template does everywhere, instead of plain text. */
const JSON_NOT_FOUND = { contentType: 'application/json', error: 'not_found' };

/** Differences from the recorded matrix, each deliberate. Keyed by "<label> <METHOD> <path>". */
const CHANGED: Record<string, Partial<Probe>> = {
  // The template serves the server icon.
  'icon GET /icon.svg': {
    status: 200,
    contentType: 'image/svg+xml',
    cacheControl: 'public, max-age=86400',
  },
  'not served GET /.well-known/openid-configuration': JSON_NOT_FOUND,
  'not served GET /.well-known/oauth-protected-resource/other': JSON_NOT_FOUND,
  'unknown GET /nope': JSON_NOT_FOUND,
  'unknown POST /nope': JSON_NOT_FOUND,
  'register GET /register': JSON_NOT_FOUND,
  'token GET /token': JSON_NOT_FOUND,
  'revoke GET /revoke': JSON_NOT_FOUND,
  // The older discovery locations answer as their canonical locations do: readable from any
  // origin they let through the Origin check.
  'discovery GET /.well-known/oauth-protected-resource': { allowOrigin: '*' },
  'discovery GET /mcp/.well-known/oauth-protected-resource': { allowOrigin: '*' },
  'discovery GET /mcp/.well-known/oauth-authorization-server': { allowOrigin: '*' },
  // The OAuth endpoints answer CORS preflights from allowed origins (hono/cors), before the
  // no-store header is added; a preflight carries no OAuth data.
  'register preflight, claude.ai OPTIONS /register': {
    status: 204,
    contentType: null,
    allowOrigin: 'https://claude.ai',
    cacheControl: null,
  },
  'token preflight, claude.ai OPTIONS /token': {
    status: 204,
    contentType: null,
    allowOrigin: 'https://claude.ai',
    cacheControl: null,
  },
  // And an allowed origin can read their answers.
  'register, web, claude.ai origin POST /register': { allowOrigin: 'https://claude.ai' },
  'token, refresh, claude.ai origin POST /token': { allowOrigin: 'https://claude.ai' },
};

interface Probe {
  label: string;
  method: string;
  path: string;
  status: number;
  contentType: string | null;
  allowOrigin: string | null;
  cacheControl: string | null;
  location?: string;
  error?: unknown;
}

function productionApp(): App {
  const vars = PRODUCTION_VARS;
  const config = parseConfig({
    ...vars,
    PROVIDER_CLIENT_ID: 'linear-client',
    PROVIDER_CLIENT_SECRET: 'linear-secret',
    RS_TOKENS_ENC_KEY: Buffer.alloc(32, 1).toString('base64url'),
  });
  const logger = memoryLogger();
  const linear = fakeFetch((request) =>
    request.url === 'https://api.linear.app/oauth/token'
      ? Response.json({
          access_token: 'linear-access',
          refresh_token: 'linear-refresh',
          expires_in: 3600,
          scope: 'read write',
        })
      : undefined,
  );
  const tokens = new MemoryTokenStore();
  const authority = new MemoryOAuthAuthority();
  const deps = {
    ...createDeps(config, logger, { tokens, authority }),
    linear: linearFactory(createMockLinearClient()),
    // As createDeps builds it (no binding, 500 on an unreadable store), with Linear faked.
    oauth: testProxy({
      config,
      logger,
      tokens,
      authority,
      fetch: linear,
      redirectAllowlist: config.settings.PROXY_REDIRECT_ALLOWLIST,
      encryptionKey: config.settings.RS_TOKENS_ENC_KEY,
    }),
  };
  return track(createApp(config, { deps }));
}

/** A path with its query reduced to the sorted parameter names; values vary per run. */
function normalize(path: string): string {
  if (!path.includes('?')) return path;
  const [base, query] = path.split('?') as [string, string];
  return `${base}?${[...new URLSearchParams(query).keys()].sort().join('&')}`;
}

/** JSON-RPC error bodies (the SDK's Host and Origin answers) are recorded as one marker. */
function errorOf(error: unknown): unknown {
  return error === undefined || typeof error === 'string' ? error : '<json-rpc>';
}

/** The probe sequence the recorded matrix came from, in the same order. */
async function probeAll(app: App): Promise<{
  matrix: Probe[];
  documents: Record<string, unknown>;
  linear: URL;
}> {
  const matrix: Probe[] = [];
  const documents: Record<string, unknown> = {};
  const probe = async (
    label: string,
    method: string,
    path: string,
    options: { headers?: Record<string, string>; body?: string } = {},
  ) => {
    const response = await app.fetch(
      new Request(new URL(path, ORIGIN).href, {
        method,
        headers: { Host: HOST, ...options.headers },
        ...(options.body !== undefined && { body: options.body }),
        redirect: 'manual',
      }),
    );
    const location = response.headers.get('location');
    const entry: Probe = {
      label,
      method,
      path: normalize(path),
      status: response.status,
      contentType: response.headers.get('content-type')?.split(';')[0] ?? null,
      allowOrigin: response.headers.get('access-control-allow-origin'),
      cacheControl: response.headers.get('cache-control'),
      ...(location && { location: `${new URL(location).origin}${new URL(location).pathname}` }),
    };
    const text = await response.text();
    if (entry.contentType === 'application/json' && text) {
      const json = JSON.parse(text) as Record<string, unknown>;
      if (json && typeof json === 'object' && 'error' in json) entry.error = errorOf(json.error);
    }
    matrix.push(entry);
    return { response, text };
  };
  const json = (value: unknown, headers: Record<string, string> = {}) => ({
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(value),
  });
  const form = (value: Record<string, string>, headers: Record<string, string> = {}) => ({
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(value).toString(),
  });
  const EVIL = { Origin: 'https://evil.example' };
  const CLAUDE = { Origin: 'https://claude.ai' };

  for (const path of [
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/mcp/.well-known/oauth-protected-resource',
    '/mcp/.well-known/oauth-authorization-server',
  ]) {
    const { text } = await probe('discovery', 'GET', path);
    documents[path] = JSON.parse(text);
    await probe('discovery, foreign origin', 'GET', path, { headers: EVIL });
  }
  for (const path of [
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
  ]) {
    await probe('discovery', 'HEAD', path);
    await probe('discovery preflight', 'OPTIONS', path, {
      headers: { ...EVIL, 'Access-Control-Request-Method': 'GET' },
    });
    await probe('discovery', 'POST', path);
  }
  await probe('not served', 'GET', '/.well-known/openid-configuration');
  await probe('not served', 'GET', '/.well-known/oauth-protected-resource/other');
  await probe('health', 'GET', '/health');
  await probe('icon', 'GET', '/icon.svg');
  await probe('unknown', 'GET', '/nope');
  await probe('unknown', 'POST', '/nope');

  const list = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  const mcp = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  await probe('mcp, anonymous', 'POST', '/mcp', { headers: mcp, body: list });
  await probe('mcp, anonymous', 'GET', '/mcp');
  await probe('mcp, unknown token', 'POST', '/mcp', {
    headers: { ...mcp, Authorization: 'Bearer not-a-token' },
    body: list,
  });
  await probe('mcp, foreign origin', 'POST', '/mcp', { headers: { ...mcp, ...EVIL }, body: list });
  await probe('mcp preflight, claude.ai', 'OPTIONS', '/mcp', {
    headers: {
      ...CLAUDE,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type, mcp-protocol-version',
    },
  });

  await probe('register, invalid', 'POST', '/register', json({ redirect_uris: [] }));
  await probe('register', 'GET', '/register');
  await probe(
    'register, foreign origin',
    'POST',
    '/register',
    json({ application_type: 'native', redirect_uris: [NATIVE] }, EVIL),
  );
  await probe(
    'register, web, claude.ai origin',
    'POST',
    '/register',
    json({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }, CLAUDE),
  );
  await probe(
    'register, web, unlisted redirect',
    'POST',
    '/register',
    json({ redirect_uris: ['https://evil.example/callback'] }),
  );
  await probe('register preflight, claude.ai', 'OPTIONS', '/register', {
    headers: {
      ...CLAUDE,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  const { text: registered } = await probe(
    'register, native',
    'POST',
    '/register',
    json({
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      redirect_uris: [NATIVE],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  );
  const client = (JSON.parse(registered) as { client_id: string }).client_id;

  const query = {
    client_id: client,
    response_type: 'code',
    redirect_uri: NATIVE,
    code_challenge: await pkceChallenge(VERIFIER),
    code_challenge_method: 'S256',
    state: 'client-state',
    resource: `${ORIGIN}/mcp`,
  };
  await probe('authorize, no parameters', 'GET', '/authorize');
  await probe(
    'authorize, plain PKCE',
    'GET',
    `/authorize?${new URLSearchParams({ ...query, code_challenge_method: 'plain' })}`,
  );
  await probe('authorize, foreign origin', 'GET', `/authorize?${new URLSearchParams(query)}`, {
    headers: EVIL,
  });
  const { response: authorized } = await probe(
    'authorize',
    'GET',
    `/authorize?${new URLSearchParams(query)}`,
  );
  const linear = new URL(authorized.headers.get('location') as string);
  const state = linear.searchParams.get('state');
  await probe('provider callback, no parameters', 'GET', '/oauth/callback');
  await probe(
    'provider callback, provider error',
    'GET',
    '/oauth/callback?error=access_denied&state=x',
  );
  const { response: called } = await probe(
    'provider callback',
    'GET',
    `/oauth/callback?code=linear-code&state=${state}`,
  );
  const code = new URL(called.headers.get('location') as string).searchParams.get('code') as string;
  await probe(
    'provider callback, replay',
    'GET',
    `/oauth/callback?code=linear-code&state=${state}`,
  );

  await probe('token, empty', 'POST', '/token', form({}));
  await probe('token', 'GET', '/token');
  await probe('token preflight, claude.ai', 'OPTIONS', '/token', {
    headers: {
      ...CLAUDE,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  await probe(
    'token, foreign origin',
    'POST',
    '/token',
    form({ grant_type: 'authorization_code' }, EVIL),
  );
  await probe('token, unsupported grant', 'POST', '/token', form({ grant_type: 'password' }));
  const grant = { grant_type: 'authorization_code', code, client_id: client, redirect_uri: NATIVE };
  await probe(
    'token, wrong verifier',
    'POST',
    '/token',
    form({ ...grant, code_verifier: 'w'.repeat(43) }),
  );
  const { text: issued } = await probe(
    'token, authorization code',
    'POST',
    '/token',
    form({
      ...grant,
      code_verifier: VERIFIER,
      resource: `${ORIGIN}/mcp`,
    }),
  );
  const tokens = JSON.parse(issued) as { access_token: string; refresh_token: string };
  await probe('token, code replay', 'POST', '/token', form({ ...grant, code_verifier: VERIFIER }));
  const refresh = { grant_type: 'refresh_token', refresh_token: tokens.refresh_token };
  await probe(
    'token, refresh, wrong client',
    'POST',
    '/token',
    form({ ...refresh, client_id: 'someone-else' }),
  );
  await probe('token, refresh, no client', 'POST', '/token', form(refresh));
  await probe('token, refresh', 'POST', '/token', form({ ...refresh, client_id: client }));
  await probe(
    'token, refresh, claude.ai origin',
    'POST',
    '/token',
    form({ ...refresh, client_id: client }, CLAUDE),
  );

  await probe('revoke', 'POST', '/revoke', form({ token: tokens.access_token }));
  await probe('revoke', 'GET', '/revoke');

  const bearer = { Authorization: `Bearer ${tokens.access_token}` };
  await probe('mcp, issued token, 2025 tools/list', 'POST', '/mcp', {
    headers: { ...mcp, ...bearer },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'matrix', version: '1' },
      },
    }),
  });
  await probe('mcp, issued token', 'GET', '/mcp', { headers: bearer });
  await probe('mcp, issued token', 'DELETE', '/mcp', { headers: bearer });
  return { matrix, documents, linear };
}

test('every public route answers as before, except the listed changes', async () => {
  const { matrix } = await probeAll(productionApp());
  const recorded = (before.matrix as Probe[]).map((entry) => ({
    ...entry,
    path: normalize(entry.path),
  }));
  expect(matrix.map((entry) => `${entry.label} ${entry.method} ${entry.path}`)).toEqual(
    recorded.map((entry) => `${entry.label} ${entry.method} ${entry.path}`),
  );

  const differences = matrix.flatMap((entry, index) => {
    const old = recorded[index] as Probe;
    const key = `${old.label} ${old.method} ${old.path.split('?')[0]}`;
    const expected = { ...old, ...CHANGED[key] };
    if (expected.error === undefined) delete expected.error;
    return JSON.stringify(entry) === JSON.stringify(expected) ? [] : [{ key, entry, expected }];
  });
  expect(differences).toEqual([]);
});

test('the discovery documents are field for field what production published', async () => {
  const { documents } = await probeAll(productionApp());
  const published = before.documents as Record<string, Record<string, unknown>>;
  for (const [path, document] of Object.entries(documents)) {
    // Added: the authorization server metadata says what the field's absence meant.
    expect(document).toEqual(
      path.endsWith('oauth-authorization-server')
        ? { ...published[path], client_id_metadata_document_supported: false }
        : published[path],
    );
  }
  expect(Object.keys(documents)).toEqual(Object.keys(published));
});

test('Linear is asked for the same sign-in as before, with the same callback', async () => {
  const { linear } = await probeAll(productionApp());
  expect(`${linear.origin}${linear.pathname}`).toBe(before.linearAuthorize.url);
  expect([...linear.searchParams.keys()]).toEqual(before.linearAuthorize.keys);
  expect({
    ...Object.fromEntries(linear.searchParams),
    state: '<handle>',
    client_id: 'mock-linear-client',
  }).toEqual(before.linearAuthorize.query);
  expect(linear.searchParams.get('redirect_uri')).toBe(
    'https://linear-mcp.example.workers.dev/oauth/callback',
  );
});
