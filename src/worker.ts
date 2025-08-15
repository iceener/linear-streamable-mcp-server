import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Router } from 'itty-router';
import { type ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  deleteCode,
  deleteTransaction,
  getLinearTokensByRsAccessToken,
  getRecordByRsRefreshToken,
  getTransaction,
  getTxnIdByCode,
  saveCode,
  saveTransaction,
  setAuthStoreEnv,
  storeRsTokenMapping,
  updateLinearTokensByRsRefreshToken,
} from './auth/store.ts';
import { loadConfig } from './config/env.ts';
import { serverMetadata } from './config/metadata.ts';
import { runWithRequestContext } from './core/context.ts';
import { registerTools } from './tools/index.ts';

// Minimal MCP constants
function getProtocolVersion(): string {
  const cfg = loadConfig();
  return cfg.MCP_PROTOCOL_VERSION || '2025-06-18';
}
const MCP_ENDPOINT_PATH = '/mcp';

// --- PKCE helper ---

async function sha256B64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

type ToolRecord = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{
    content?: Array<unknown>;
    structuredContent?: unknown;
    isError?: boolean;
  }>;
};

// Build an adapter that captures registrations from existing tools
const tools: Record<string, ToolRecord> = {};
type RegisterSchema = {
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { title?: string };
};
type RegisterHandler = (args: unknown) => Promise<unknown>;
type MinimalServer = {
  registerTool: (
    name: string,
    schema: RegisterSchema,
    handler: RegisterHandler,
  ) => void;
};
const adapter: MinimalServer = {
  registerTool(
    name: string,
    schema: RegisterSchema,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ) {
    function toJsonSchema(input: unknown): Record<string, unknown> {
      try {
        // Already JSON schema-ish
        if (
          input &&
          typeof input === 'object' &&
          ('$schema' in (input as Record<string, unknown>) ||
            'type' in (input as Record<string, unknown>))
        ) {
          return input as Record<string, unknown>;
        }
        // Zod object or any Zod type
        const isZodType =
          typeof input === 'object' &&
          input !== null &&
          '_def' in (input as Record<string, unknown>);
        if (isZodType) {
          const json = zodToJsonSchema(input as ZodTypeAny, {
            $refStrategy: 'none',
          });
          return json as unknown as Record<string, unknown>;
        }
        // Zod shape (Record<string, ZodTypeAny>)
        if (input && typeof input === 'object') {
          const values = Object.values(input as Record<string, unknown>);
          const looksLikeShape =
            values.length > 0 &&
            values.every((v) => {
              return (
                v && typeof v === 'object' && '_def' in (v as Record<string, unknown>)
              );
            });
          if (looksLikeShape) {
            const obj = z.object(input as Record<string, ZodTypeAny>);
            const json = zodToJsonSchema(obj, { $refStrategy: 'none' });
            return json as unknown as Record<string, unknown>;
          }
        }
      } catch {}
      // Fallback: return as-is
      return (input ?? {}) as Record<string, unknown>;
    }

    const wrappedHandler: ToolRecord['handler'] = async (args) => {
      const result = await handler(args);
      return result as {
        content?: Array<unknown>;
        structuredContent?: unknown;
        isError?: boolean;
      };
    };
    tools[name] = {
      name,
      title: schema.annotations?.title,
      description: schema.description,
      inputSchema: toJsonSchema(schema.inputSchema),
      handler: wrappedHandler,
    };
  },
};

// Register all tools into the adapter registry
registerTools(adapter as unknown as McpServer);

// Small helpers
function _json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

function _b64urlEncodeString(input: string): string {
  const base64 = btoa(input);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function _b64urlDecodeString(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    return atob(padded);
  } catch {
    return null;
  }
}

type JsonRpcId = string | number;
type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

function ok(id: JsonRpcId, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function error(id: JsonRpcId | undefined, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }),
    {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    },
  );
}

function withCors(resp: Response): Response {
  const headers = new Headers(resp.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
  );
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(resp.body, { status: resp.status, headers });
}

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const cfg = loadConfig();
    if (cfg.OAUTH_REDIRECT_ALLOW_ALL) {
      return true;
    }
    const allowListRaw = cfg.OAUTH_REDIRECT_ALLOWLIST || '';
    const allowed = new Set(
      allowListRaw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .concat([cfg.OAUTH_REDIRECT_URI]),
    );
    const url = new URL(uri);
    if (cfg.NODE_ENV === 'development') {
      const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
      if (loopbackHosts.has(url.hostname)) {
        return true;
      }
    }
    return (
      allowed.has(`${url.protocol}//${url.host}${url.pathname}`) || allowed.has(uri)
    );
  } catch {
    return false;
  }
}

const router = Router();

router.options(MCP_ENDPOINT_PATH, async () =>
  withCors(new Response(null, { status: 204 })),
);

router.post(MCP_ENDPOINT_PATH, async (request: Request) => {
  // Capture request headers (lowercased) for downstream Linear client usage
  const headerRecord: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headerRecord[String(key).toLowerCase()] = String(value);
  });

  // Session correlation for challenges
  const incomingSid = request.headers.get('Mcp-Session-Id');
  const sid = incomingSid?.trim() ? incomingSid : crypto.randomUUID();

  // Helper to send a WWW-Authenticate challenge with sid
  const challenge = (origin: string): Response => {
    const resourceMd = `${origin}/.well-known/oauth-protected-resource?sid=${encodeURIComponent(
      sid,
    )}`;
    const resp = new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unauthorized' },
        id: null,
      }),
      { status: 401 },
    );
    resp.headers.set(
      'WWW-Authenticate',
      `Bearer realm="MCP", authorization_uri="${resourceMd}"`,
    );
    resp.headers.set('Mcp-Session-Id', sid);
    return withCors(resp);
  };

  // RS-only handling and rewrite logic
  const cfg = loadConfig();
  const authHeaderIn = headerRecord.authorization;
  const apiKeyHeader = headerRecord['x-api-key'] || headerRecord['x-auth-token'];

  // Missing Authorization and API key → challenge when auth enabled
  if (cfg.AUTH_ENABLED && !authHeaderIn && !apiKeyHeader) {
    const origin = new URL(request.url).origin;
    return challenge(origin);
  }

  let rsMapped = false;
  let bearer: string | undefined;
  if (authHeaderIn) {
    const m = authHeaderIn.match(/^\s*Bearer\s+(.+)$/i);
    bearer = m?.[1];
    if (bearer) {
      try {
        const mapped = await getLinearTokensByRsAccessToken(bearer);
        if (mapped?.access_token) {
          headerRecord.authorization = `Bearer ${mapped.access_token}`;
          rsMapped = true;
        }
      } catch {}
    }
  }

  // In RS-only mode, unknown bearer → challenge (unless Linear bearer fallback allowed)
  if (
    cfg.AUTH_ENABLED &&
    cfg.AUTH_REQUIRE_RS &&
    bearer &&
    !rsMapped &&
    !cfg.AUTH_ALLOW_LINEAR_BEARER
  ) {
    const origin = new URL(request.url).origin;
    return challenge(origin);
  }

  return runWithRequestContext({ authHeaders: headerRecord }, async () => {
    const raw = await request.text();
    const payload = (raw ? JSON.parse(raw) : {}) as JsonRpcRequest;
    if (payload?.jsonrpc !== '2.0' || typeof payload.method !== 'string') {
      return withCors(new Response('Bad Request', { status: 400 }));
    }
    const { id, method, params } = payload;
    if (!('id' in payload) || typeof id === 'undefined') {
      return withCors(new Response(null, { status: 202 }));
    }

    if (method === 'initialize') {
      return withCors(
        ok(id, {
          protocolVersion: getProtocolVersion(),
          capabilities: { tools: { listChanged: true } },
          serverInfo: {
            name: serverMetadata.title,
            title: serverMetadata.title,
            version: loadConfig().MCP_VERSION,
          },
          instructions: serverMetadata.instructions,
        }),
      );
    }
    if (method === 'tools/list') {
      const list = Object.values(tools).map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return withCors(ok(id, { tools: list }));
    }
    if (method === 'resources/list') {
      return withCors(ok(id, { resources: [] }));
    }
    if (method === 'prompts/list') {
      return withCors(ok(id, { prompts: [] }));
    }
    if (method === 'tools/call') {
      const nameValue = (params as Record<string, unknown> | undefined)?.name;
      const name = typeof nameValue === 'string' ? nameValue : undefined;
      const argsValue = (params as Record<string, unknown> | undefined)?.arguments;
      const args =
        typeof argsValue === 'object' && argsValue !== null && !Array.isArray(argsValue)
          ? (argsValue as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      if (!name || !tools[name]) {
        return withCors(error(id, -32602, `Unknown tool: ${String(name)}`));
      }
      try {
        const tool = tools[name];
        const result = await tool?.handler(args);
        return withCors(ok(id, result));
      } catch (e) {
        return withCors(
          ok(id, {
            isError: true,
            content: [{ type: 'text', text: `Tool failed: ${(e as Error).message}` }],
          }),
        );
      }
    }
    return withCors(error(id, -32601, `Method not found: ${method}`));
  });
});

router.get(MCP_ENDPOINT_PATH, async () =>
  withCors(new Response('Method Not Allowed', { status: 405 })),
);
router.get('/health', async () =>
  withCors(
    new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }),
  ),
);

// Authorization Server discovery (RFC8414) and Protected Resource discovery (RFC9728)
router.get('/.well-known/oauth-authorization-server', async (request: Request) => {
  const base = new URL(request.url).origin;
  return withCors(
    new Response(
      JSON.stringify({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['mcp'],
      }),
      { headers: { 'content-type': 'application/json; charset=utf-8' } },
    ),
  );
});

router.get('/.well-known/oauth-protected-resource', async (request: Request) => {
  const here = new URL(request.url);
  const base = here.origin;
  const sid = here.searchParams.get('sid') ?? undefined;
  const resourceBase = `${base}${MCP_ENDPOINT_PATH}`;
  const resourceUrl = (() => {
    try {
      if (!sid) {
        return resourceBase;
      }
      const u = new URL(resourceBase);
      u.searchParams.set('sid', sid);
      return u.toString();
    } catch {
      return resourceBase;
    }
  })();
  return withCors(
    new Response(
      JSON.stringify({
        authorization_servers: [`${base}/.well-known/oauth-authorization-server`],
        resource: resourceUrl,
      }),
      { headers: { 'content-type': 'application/json; charset=utf-8' } },
    ),
  );
});

// Minimal /authorize and /token to satisfy dev OAuth flows
router.get('/authorize', async (request: Request) => {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? undefined;
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');
  const redirectUri = url.searchParams.get('redirect_uri');
  const scope = url.searchParams.get('scope') ?? undefined;
  if (!redirectUri) {
    return withCors(new Response('invalid_request: redirect_uri', { status: 400 }));
  }
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return withCors(new Response('invalid_request: pkce', { status: 400 }));
  }
  const txnId = crypto.randomUUID();
  await saveTransaction(txnId, {
    codeChallenge,
    state,
    scope,
    createdAt: Date.now(),
  });
  // If upstream OAuth is configured, redirect to upstream (e.g., Linear/GitHub)
  const cfg = loadConfig();
  if (cfg.OAUTH_AUTHORIZATION_URL && cfg.OAUTH_CLIENT_ID) {
    const here = new URL(request.url);
    const base = here.origin;
    const cb = new URL('/linear/callback', base);
    const authUrl = new URL(cfg.OAUTH_AUTHORIZATION_URL);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', cfg.OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', cb.toString());
    const oauthScopes = (cfg.OAUTH_SCOPES || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ');
    const scopeToUse = oauthScopes || scope || '';
    if (scopeToUse) {
      authUrl.searchParams.set('scope', scopeToUse);
    }
    // base64url encode composite state: txn + original client state + client redirect
    const composite = btoa(JSON.stringify({ tid: txnId, cs: state, cr: redirectUri }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    authUrl.searchParams.set('state', composite || txnId);
    return withCors(Response.redirect(authUrl.toString(), 302));
  }
  const code = crypto.randomUUID();
  await saveCode(code, txnId);
  const target = isAllowedRedirectUri(redirectUri)
    ? redirectUri
    : cfg.OAUTH_REDIRECT_URI;
  const redirect = new URL(target);
  redirect.searchParams.set('code', code);
  if (state) {
    redirect.searchParams.set('state', state);
  }
  return withCors(Response.redirect(redirect.toString(), 302));
});

// Dynamic Client Registration (minimal, public client)
router.post('/register', async (request: Request) => {
  const base = new URL(request.url).origin;
  const now = Math.floor(Date.now() / 1000);
  const client_id = crypto.randomUUID();
  const ct = request.headers.get('content-type') || '';
  let body: Record<string, unknown> = {};
  try {
    if (ct.includes('application/json')) {
      body = (await request.json()) as Record<string, unknown>;
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const form = new URLSearchParams(await request.text());
      body = Object.fromEntries(form.entries());
    }
  } catch {}
  const redirect_urisRaw = (body.redirect_uris as unknown) ?? [];
  const redirect_uris = Array.isArray(redirect_urisRaw)
    ? redirect_urisRaw.filter((u) => typeof u === 'string')
    : typeof redirect_urisRaw === 'string'
      ? [redirect_urisRaw]
      : [];
  const _token_endpoint_auth_method =
    (body.token_endpoint_auth_method as string) || 'none';
  const grant_typesRaw = (body.grant_types as unknown) ?? undefined;
  const grant_types = Array.isArray(grant_typesRaw)
    ? (grant_typesRaw as unknown[]).filter((v) => typeof v === 'string')
    : ['authorization_code', 'refresh_token'];
  const response_typesRaw = (body.response_types as unknown) ?? undefined;
  const response_types = Array.isArray(response_typesRaw)
    ? (response_typesRaw as unknown[]).filter((v) => typeof v === 'string')
    : ['code'];
  const client_name =
    typeof body.client_name === 'string' ? (body.client_name as string) : undefined;

  return withCors(
    new Response(
      JSON.stringify({
        client_id,
        client_id_issued_at: now,
        client_secret_expires_at: 0,
        token_endpoint_auth_method: 'none',
        registration_client_uri: `${base}/register/${client_id}`,
        registration_access_token: crypto.randomUUID(),
        redirect_uris,
        grant_types,
        response_types,
        ...(client_name ? { client_name } : {}),
      }),
      { headers: { 'content-type': 'application/json; charset=utf-8' } },
    ),
  );
});

// Upstream callback: exchange code → upstream tokens, then issue AS code back to client
router.get('/linear/callback', async (request: Request) => {
  try {
    const here = new URL(request.url);
    const code = here.searchParams.get('code');
    const state = here.searchParams.get('state');
    if (!code || !state) {
      return withCors(new Response('invalid_callback', { status: 400 }));
    }
    let decoded: { tid?: string; cs?: string; cr?: string } = {};
    try {
      const padded = state.replace(/-/g, '+').replace(/_/g, '/');
      decoded = JSON.parse(atob(padded)) as typeof decoded;
    } catch {}
    const txnId = decoded.tid || state;
    const txn = await getTransaction(txnId);
    if (!txn) {
      return withCors(new Response('unknown_txn', { status: 400 }));
    }
    // Exchange with upstream provider if configured
    const cfg = loadConfig();
    const tokenUrl = cfg.OAUTH_TOKEN_URL || 'https://api.linear.app/oauth/token';
    const cbBase = here.origin;
    const callbackRedirect = new URL('/linear/callback', cbBase).toString();
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackRedirect,
      client_id: cfg.OAUTH_CLIENT_ID || '',
      client_secret: cfg.OAUTH_CLIENT_SECRET || '',
    });
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return withCors(
        new Response(`linear_token_error: ${resp.status} ${t}`.trim(), {
          status: 500,
        }),
      );
    }
    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number | string;
      scope?: string | string[];
      token_type?: string;
    };
    const access_token = String(data.access_token || '');
    if (!access_token) {
      return withCors(new Response('linear_no_token', { status: 500 }));
    }
    const scopes = Array.isArray(data.scope)
      ? data.scope
      : String(data.scope || '')
          .split(/[\s,]+/)
          .filter(Boolean);
    (txn as unknown as { linear?: unknown }).linear = {
      access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000,
      scopes,
    };
    const asCode = crypto.randomUUID();
    await Promise.all([saveCode(asCode, txnId), saveTransaction(txnId, txn)]);
    const cfg2 = loadConfig();
    const clientRedirect = decoded.cr || cfg2.OAUTH_REDIRECT_URI;
    const safe = isAllowedRedirectUri(clientRedirect)
      ? clientRedirect
      : cfg2.OAUTH_REDIRECT_URI;
    if (!safe || String(safe).trim() === '') {
      return withCors(new Response('redirect_not_allowed', { status: 400 }));
    }
    const redirect = new URL(safe);
    redirect.searchParams.set('code', asCode);
    if (decoded.cs) {
      redirect.searchParams.set('state', decoded.cs);
    }
    return withCors(Response.redirect(redirect.toString(), 302));
  } catch {
    return withCors(new Response('linear_callback_error', { status: 500 }));
  }
});

router.post('/token', async (request: Request) => {
  const contentType = request.headers.get('content-type') || '';
  const params = contentType.includes('application/x-www-form-urlencoded')
    ? new URLSearchParams(await request.text())
    : new URLSearchParams(
        (await request.json().catch(() => ({}))) as Record<string, string>,
      );
  const grant = params.get('grant_type');
  if (grant === 'refresh_token') {
    const rsRefresh = params.get('refresh_token') || '';
    const rec = await getRecordByRsRefreshToken(rsRefresh);
    if (!rec) {
      return withCors(
        new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
        }),
      );
    }
    const newAccess = crypto.randomUUID();
    const updated = await updateLinearTokensByRsRefreshToken(
      rsRefresh,
      rec.linear,
      newAccess,
    );
    return withCors(
      new Response(
        JSON.stringify({
          access_token: newAccess,
          refresh_token: rsRefresh,
          token_type: 'bearer',
          expires_in: 3600,
          scope: (updated?.linear.scopes || []).join(' '),
        }),
        { headers: { 'content-type': 'application/json; charset=utf-8' } },
      ),
    );
  }
  if (grant !== 'authorization_code') {
    return withCors(
      new Response(JSON.stringify({ error: 'unsupported_grant_type' }), {
        status: 400,
      }),
    );
  }
  const code = params.get('code') || '';
  const codeVerifier = params.get('code_verifier') || '';
  const txnId = await getTxnIdByCode(code);
  if (!txnId) {
    return withCors(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
  }
  const txn = await getTransaction(txnId);
  if (!txn) {
    return withCors(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
  }
  const expected = txn.codeChallenge;
  const actual = await (async () => {
    // Only accept PKCE S256; incoming value is S256(code_verifier)
    return sha256B64Url(codeVerifier);
  })();
  if (expected !== actual) {
    return withCors(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
  }
  // If upstream tokens are attached to txn, map RS tokens; else dev-only tokens
  const rsAccess = crypto.randomUUID();
  const rsRefresh = crypto.randomUUID();
  const linearTokens = (
    txn as unknown as {
      linear?: {
        access_token: string;
        refresh_token?: string;
        expires_at?: number;
        scopes?: string[];
      };
    }
  ).linear as
    | {
        access_token: string;
        refresh_token?: string;
        expires_at?: number;
        scopes?: string[];
      }
    | undefined;
  if (linearTokens?.access_token) {
    await storeRsTokenMapping(rsAccess, linearTokens, rsRefresh);
  }
  await Promise.all([deleteTransaction(txnId), deleteCode(code)]);
  return withCors(
    new Response(
      JSON.stringify({
        access_token: rsAccess,
        refresh_token: rsRefresh,
        token_type: 'bearer',
        expires_in: 3600,
        scope:
          (linearTokens?.scopes || []).join(' ') ||
          txn.scope ||
          (loadConfig().OAUTH_SCOPES || '').trim(),
      }),
      { headers: { 'content-type': 'application/json; charset=utf-8' } },
    ),
  );
});
router.all('*', () => withCors(new Response('Not Found', { status: 404 })));

export default {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response> | Response {
    if (env) {
      const g = globalThis as unknown as {
        process?: { env?: Record<string, unknown> };
      };
      const existingEnv = (g.process?.env ?? {}) as Record<string, unknown>;
      g.process = g.process || {};
      g.process.env = { ...existingEnv, ...(env as Record<string, unknown>) };
      setAuthStoreEnv(env);
    }
    const url = new URL(request.url);
    // If clients are configured with the base URL without "/mcp", forward POSTs to the MCP endpoint
    if (url.pathname === '/' && request.method.toUpperCase() === 'POST') {
      const forwarded = new Request(
        new URL(MCP_ENDPOINT_PATH, url).toString(),
        request,
      );
      return router.handle(forwarded);
    }
    if (url.pathname === '/') {
      return withCors(
        new Response(
          JSON.stringify({
            message: 'Linear MCP Worker',
            endpoint: MCP_ENDPOINT_PATH,
            protocolVersion: getProtocolVersion(),
          }),
          { headers: { 'content-type': 'application/json; charset=utf-8' } },
        ),
      );
    }
    return router.handle(request);
  },
};
