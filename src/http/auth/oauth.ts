import { createHash, randomBytes } from 'node:crypto';
import type { HttpBindings } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from '../../config/env.ts';
import {
  generateOpaqueToken as genOpaque,
  getRecordByRsRefreshToken,
  storeRsTokenMapping,
  updateLinearTokensByRsRefreshToken,
} from '../../core/tokens.ts';

type Txn = {
  codeVerifierHash: string; // PKCE S256(challenge)
  state?: string;
  createdAt: number;
  scope?: string;
};

const transactions = new Map<string, Txn>();
const codes = new Map<string, string>(); // code -> txnId

function b64url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlEncodeJson(obj: unknown): string {
  try {
    const json = JSON.stringify(obj);
    return b64url(Buffer.from(json, 'utf8'));
  } catch {
    return '';
  }
}

function b64urlDecodeJson<T = unknown>(value: string): T | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const buf = Buffer.from(padded, 'base64');
    return JSON.parse(buf.toString('utf8')) as T;
  } catch {
    return null;
  }
}

function sha256B64Url(input: string): string {
  const hash = createHash('sha256').update(input).digest();
  return b64url(hash);
}

function generateOpaqueToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

// Periodic cleanup of old transactions
setInterval(() => {
  const now = Date.now();
  for (const [tid, txn] of transactions) {
    if (now - txn.createdAt > 10 * 60_000) {
      transactions.delete(tid);
    }
  }
}, 60_000).unref?.();

export function oauthRoutes() {
  const app = new Hono<{ Bindings: HttpBindings }>();

  app.get('/.well-known/oauth-authorization-server', (c) => {
    const here = new URL(c.req.url);
    const base = `${here.protocol}//${here.host}`;
    const metadata = {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      revocation_endpoint: `${base}/revoke`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: (config.OAUTH_SCOPES || '').split(' ').filter(Boolean),
    } as const;
    return c.json(metadata);
  });

  // Authorization endpoint: if Linear OAuth is configured, redirect user to Linear authorize
  // with a composite state to round-trip the client's redirect/state. Otherwise, issue a dev code.
  app.get('/authorize', (c) => {
    const url = new URL(c.req.url);
    const state = url.searchParams.get('state') ?? undefined;
    const codeChallenge = url.searchParams.get('code_challenge');
    const codeChallengeMethod = url.searchParams.get('code_challenge_method');
    const redirectUri = url.searchParams.get('redirect_uri');
    const requestedScope = url.searchParams.get('scope') ?? undefined;

    if (!redirectUri) {
      return c.text('invalid_request: redirect_uri', 400);
    }
    if (!codeChallenge || codeChallengeMethod !== 'S256') {
      return c.text('invalid_request: pkce', 400);
    }

    const txnId = generateOpaqueToken(16);
    transactions.set(txnId, {
      codeVerifierHash: codeChallenge,
      state,
      createdAt: Date.now(),
      scope: requestedScope,
    });

    if (config.OAUTH_AUTHORIZATION_URL && config.OAUTH_CLIENT_ID) {
      const authUrl = new URL(config.OAUTH_AUTHORIZATION_URL);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', config.OAUTH_CLIENT_ID);
      // callback is this auth-app's /linear/callback
      const here = new URL(c.req.url);
      const asBase = `${here.protocol}//${here.host}`;
      const cb = new URL('/linear/callback', asBase);
      authUrl.searchParams.set('redirect_uri', cb.toString());
      // Linear expects scopes like "read write" (not the RS scope like "mcp").
      // Prefer configured scopes; fall back to requestedScope only if env is empty.
      const oauthScopes = (config.OAUTH_SCOPES || '')
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ');
      const normalizedRequested = String(requestedScope || '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .join(' ');
      const scopeToUse = oauthScopes || normalizedRequested;
      if (scopeToUse) {
        authUrl.searchParams.set('scope', scopeToUse);
      }
      const compositeState = b64urlEncodeJson({
        tid: txnId,
        cs: state,
        cr: redirectUri,
      });
      authUrl.searchParams.set('state', compositeState || txnId);
      return c.redirect(authUrl.toString(), 302);
    }

    // Dev-only shortcut: immediately redirect back with a one-time code
    // Accept client redirect only if allowlisted; otherwise fall back to configured default
    const code = generateOpaqueToken(16);
    codes.set(code, txnId);
    const allowListRaw = config.OAUTH_REDIRECT_ALLOWLIST || '';
    const allowed = new Set(
      allowListRaw
        .split(',')
        .map((value: string) => value.trim())
        .filter(Boolean)
        .concat([config.OAUTH_REDIRECT_URI]),
    );
    const isAllowed = (u: string) => {
      try {
        const parsed = new URL(u);
        if (config.NODE_ENV === 'development') {
          const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
          if (loopbackHosts.has(parsed.hostname)) {
            return true;
          }
        }
        return (
          allowed.has(`${parsed.protocol}//${parsed.host}${parsed.pathname}`) ||
          allowed.has(u)
        );
      } catch {
        return false;
      }
    };
    const clientRedirect = redirectUri;
    const safeRedirect =
      clientRedirect && isAllowed(clientRedirect)
        ? clientRedirect
        : (config.OAUTH_REDIRECT_URI as string);
    const redirect = new URL(safeRedirect);
    redirect.searchParams.set('code', code);
    if (state) {
      redirect.searchParams.set('state', state);
    }
    return c.redirect(redirect.toString(), 302);
  });

  // Exchange Linear OAuth code for tokens, then issue AS code back to client
  app.get('/linear/callback', async (c) => {
    try {
      const here = new URL(c.req.url);
      const code = here.searchParams.get('code');
      const state = here.searchParams.get('state');
      if (!code || !state) {
        return c.text('invalid_callback', 400);
      }
      const decoded =
        b64urlDecodeJson<{ tid?: string; cs?: string; cr?: string }>(state) || {};
      const txnId = decoded.tid || state;
      const txn = transactions.get(txnId);
      if (!txn) {
        return c.text('unknown_txn', 400);
      }

      // Exchange code → Linear tokens
      const tokenUrl = new URL('/oauth/token', 'https://api.linear.app').toString();
      const cbBase = `${here.protocol}//${here.host}`;
      const callbackRedirect = new URL('/linear/callback', cbBase).toString();
      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackRedirect,
        client_id: config.OAUTH_CLIENT_ID || '',
        client_secret: config.OAUTH_CLIENT_SECRET || '',
      });
      const resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        return c.text(`linear_token_error: ${resp.status} ${t}`.trim(), 500);
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
        return c.text('linear_no_token', 500);
      }
      const expires_at = Date.now() + Number(data.expires_in ?? 3600) * 1000;
      const scopes = Array.isArray(data.scope)
        ? data.scope
        : String(data.scope || '')
            .split(/[\s,]+/)
            .filter(Boolean);

      // Store tokens on txn and issue an AS code to be exchanged at /token
      (
        txn as unknown as {
          linear?: {
            access_token: string;
            refresh_token?: string;
            expires_at?: number;
            scopes?: string[];
          };
        }
      ).linear = {
        access_token,
        refresh_token: data.refresh_token,
        expires_at,
        scopes,
      };
      const asCode = genOpaque(24);
      codes.set(asCode, txnId);
      transactions.set(txnId, txn);
      const clientRedirect = (decoded.cr || config.OAUTH_REDIRECT_URI) as string;
      // Enforce allowlist for security (loopback hosts allowed in dev)
      const allowListRaw = config.OAUTH_REDIRECT_ALLOWLIST || '';
      const allowed = new Set(
        allowListRaw
          .split(',')
          .map((value: string) => value.trim())
          .filter(Boolean)
          .concat([config.OAUTH_REDIRECT_URI]),
      );
      const isAllowed = (u: string) => {
        try {
          const url = new URL(u);
          if (config.NODE_ENV === 'development') {
            const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
            if (loopbackHosts.has(url.hostname)) {
              return true;
            }
          }
          return (
            allowed.has(`${url.protocol}//${url.host}${url.pathname}`) || allowed.has(u)
          );
        } catch {
          return false;
        }
      };
      const safeRedirect = isAllowed(clientRedirect)
        ? clientRedirect
        : config.OAUTH_REDIRECT_URI;
      const redirect = new URL(safeRedirect);
      redirect.searchParams.set('code', asCode);
      if (decoded.cs) {
        redirect.searchParams.set('state', decoded.cs);
      }
      return c.redirect(redirect.toString(), 302);
    } catch (_e) {
      return c.text('linear_callback_error', 500);
    }
  });

  // AS /token — exchanges code for RS tokens, verifies PKCE
  app.post('/token', async (c) => {
    const contentType = c.req.header('content-type') || '';
    const asForm = async (): Promise<URLSearchParams> => {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await c.req.text();
        return new URLSearchParams(text);
      }
      const body = (await c.req.json().catch(() => ({}))) as Record<string, string>;
      return new URLSearchParams(body);
    };

    const form = await asForm();
    const grant = form.get('grant_type');

    if (grant === 'refresh_token') {
      const rsRefresh = form.get('refresh_token') || '';
      const rec = getRecordByRsRefreshToken(rsRefresh);
      if (!rec) {
        return c.json({ error: 'invalid_grant' }, 400);
      }
      const newAccess = genOpaque(24);
      const updated = updateLinearTokensByRsRefreshToken(
        rsRefresh,
        rec.linear,
        newAccess,
      );
      return c.json({
        access_token: newAccess,
        refresh_token: rsRefresh,
        token_type: 'bearer',
        expires_in: 3600,
        scope: (updated?.linear.scopes || []).join(' '),
      });
    }

    if (grant !== 'authorization_code') {
      return c.json({ error: 'unsupported_grant_type' }, 400);
    }

    const code = form.get('code') || '';
    const codeVerifier = form.get('code_verifier') || '';
    const txnId = codes.get(code);
    if (!txnId) {
      return c.json({ error: 'invalid_grant' }, 400);
    }
    const txn = transactions.get(txnId);
    if (!txn) {
      return c.json({ error: 'invalid_grant' }, 400);
    }

    const expected = txn.codeVerifierHash;
    const actual = sha256B64Url(codeVerifier);
    if (expected !== actual) {
      return c.json({ error: 'invalid_grant' }, 400);
    }

    // Success — mint RS tokens mapped to Linear tokens (must have been set at /linear/callback)
    const rsAccess = genOpaque(24);
    const rsRefresh = genOpaque(24);
    const linearTokens = (
      txn as unknown as {
        linear?: {
          access_token: string;
          refresh_token?: string;
          expires_at?: number;
          scopes?: string[];
        };
      }
    ).linear;
    if (linearTokens?.access_token) {
      storeRsTokenMapping(rsAccess, linearTokens, rsRefresh);
    }

    // single-use
    transactions.delete(txnId);
    codes.delete(code);

    return c.json({
      access_token: rsAccess,
      refresh_token: rsRefresh,
      token_type: 'bearer',
      expires_in: 3600,
      scope:
        (linearTokens?.scopes || []).join(' ') ||
        txn.scope ||
        (config.OAUTH_SCOPES || '').trim(),
    });
  });

  app.post('/revoke', async (c) => {
    return c.json({ status: 'ok' });
  });

  app.post('/register', async (c) => {
    const here = new URL(c.req.url);
    const base = `${here.protocol}//${here.host}`;
    const requested = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    const client_id = generateOpaqueToken(12);
    return c.json(
      {
        client_id,
        client_id_issued_at: now,
        client_secret_expires_at: 0,
        token_endpoint_auth_method: 'none',
        redirect_uris: Array.isArray(
          (requested as { redirect_uris?: unknown })?.redirect_uris,
        )
          ? (requested as { redirect_uris: string[] }).redirect_uris
          : [config.OAUTH_REDIRECT_URI],
        registration_client_uri: `${base}/register/${client_id}`,
        registration_access_token: generateOpaqueToken(12),
      },
      201,
    );
  });

  return app;
}
