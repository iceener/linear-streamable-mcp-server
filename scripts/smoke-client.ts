import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
// Node runs this file too (smoke-worker.ts), so the import names the .ts file.
import { MOCK_TEAM } from './mock-linear.ts';

export const NATIVE_REDIRECT = 'http://127.0.0.1:43210/oauth/callback';
export const VERIFIER = 'smoke-verifier-'.padEnd(64, 'x');

/** The steps of a native client's sign-in, over real sockets. Runs under Bun and Node. */
export function oauthSteps(origin: URL) {
  assert.equal(origin.hostname, '127.0.0.1', 'smoke traffic stays on loopback');
  const at = (path: string) => new URL(path, origin);

  return {
    async register(): Promise<string> {
      const metadata = (await (
        await fetch(at('/.well-known/oauth-authorization-server'))
      ).json()) as {
        issuer: string;
        registration_endpoint: string;
      };
      assert.equal(metadata.issuer, origin.origin);
      const registered = await fetch(metadata.registration_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_type: 'native', redirect_uris: [NATIVE_REDIRECT] }),
      });
      assert.equal(registered.status, 201);
      return ((await registered.json()) as { client_id: string }).client_id;
    },

    /** Returns the handle Linear gets as `state`. */
    async authorize(clientId: string): Promise<string> {
      const challenge = Buffer.from(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VERIFIER)),
      ).toString('base64url');
      const authorized = await fetch(
        at(
          `/authorize?${new URLSearchParams({
            client_id: clientId,
            response_type: 'code',
            redirect_uri: NATIVE_REDIRECT,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state: 'smoke-state',
          })}`,
        ),
        { redirect: 'manual' },
      );
      assert.equal(authorized.status, 302);
      const linear = new URL(authorized.headers.get('location') ?? '');
      assert.equal(`${linear.origin}${linear.pathname}`, 'https://linear.app/oauth/authorize');
      assert.equal(linear.searchParams.get('redirect_uri'), at('/oauth/callback').href);
      assert.equal(linear.searchParams.get('scope'), 'read write');
      return linear.searchParams.get('state') ?? '';
    },

    /** Linear sends the browser back. Returns the answer, without following it. */
    callback(state: string, code = 'linear-code'): Promise<Response> {
      return fetch(at(`/oauth/callback?code=${code}&state=${state}`), { redirect: 'manual' });
    },

    /** The client's code from a callback answer. */
    codeFrom(callback: Response): string {
      assert.equal(callback.status, 302);
      const back = new URL(callback.headers.get('location') ?? '');
      assert.equal(`${back.origin}${back.pathname}`, NATIVE_REDIRECT);
      assert.equal(back.searchParams.get('state'), 'smoke-state');
      return back.searchParams.get('code') ?? '';
    },

    redeem(
      clientId: string,
      code: string,
      overrides: Record<string, string> = {},
    ): Promise<Response> {
      return fetch(at('/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          redirect_uri: NATIVE_REDIRECT,
          code_verifier: VERIFIER,
          ...overrides,
        }),
      });
    },

    refresh(refreshToken: string): Promise<Response> {
      return fetch(at('/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      });
    },
  };
}

/**
 * Sign in through the OAuth proxy over real sockets, as a native client does: register,
 * authorize, come back from Linear (mocked on loopback), redeem the code with PKCE, and
 * refresh without a client ID, as before. Returns the access token the proxy issued.
 */
export async function signIn(origin: URL, label: string): Promise<string> {
  const steps = oauthSteps(origin);
  const clientId = await steps.register();
  const state = await steps.authorize(clientId);
  const code = steps.codeFrom(await steps.callback(state));

  const issued = await steps.redeem(clientId, code);
  assert.equal(issued.status, 200);
  const pair = (await issued.json()) as { access_token: string; refresh_token: string };
  assert.notEqual(pair.access_token, 'linear-access', 'the client gets the proxy’s token');

  const refreshed = await steps.refresh(pair.refresh_token);
  assert.equal(refreshed.status, 200);
  assert.equal(
    ((await refreshed.json()) as { access_token: string }).access_token,
    pair.access_token,
  );
  console.info(`${label}: OAuth round trip through the mocked Linear passed`);
  return pair.access_token;
}

/**
 * Drive a running server over real sockets with the official client, in both protocol
 * eras. Shared by the Bun and Workers smoke tests; it needs no network beyond loopback.
 * With a token, the server must be in OAuth mode: requests without it are refused, requests
 * with it get through, and Linear (mocked) sees the user's Linear token.
 */
export async function smoke(endpoint: URL, label: string, token?: string): Promise<void> {
  assert.equal(endpoint.hostname, '127.0.0.1', 'smoke traffic stays on loopback');
  const authorization = token ? { Authorization: `Bearer ${token}` } : undefined;

  const health = await fetch(new URL('/health', endpoint));
  assert.equal(health.status, 200);

  if (token) {
    const anonymous = await fetch(endpoint, { method: 'POST' });
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('WWW-Authenticate') ?? '', /resource_metadata=/);
  }

  for (const era of ['modern', 'legacy'] as const) {
    const client = new Client(
      { name: 'smoke', version: '1.0.0' },
      { versionNegotiation: { mode: era === 'modern' ? 'auto' : 'legacy' } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers);
          if (token) headers.set('Authorization', `Bearer ${token}`);
          const response = await fetch(url, { ...init, headers, redirect: 'error' });
          assert.equal(response.headers.has('Mcp-Session-Id'), false, 'the server is stateless');
          return response;
        },
      }),
    );
    try {
      assert.equal(client.getProtocolEra(), era);
      const { tools } = await client.listTools();
      assert.equal(tools[0]?.name, 'workspace_metadata');
      assert.equal(tools.length, 15);

      const teams = await client.callTool({ name: 'list_teams', arguments: {} });
      if (token) {
        assert.equal(teams.isError, undefined, JSON.stringify(teams));
        assert.deepEqual((teams.structuredContent as { items: unknown[] }).items, [MOCK_TEAM]);
      } else {
        assert.equal(teams.isError, true);
      }

      const ui = await client.readResource({ uri: 'ui://linear/issues' });
      assert.equal(ui.contents.length, 1);
    } finally {
      await client.close();
    }
    console.info(`${label}: ${era} client passed`);
  }

  const foreignOrigin = await fetch(endpoint, {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(foreignOrigin.status, 403);

  const oversized = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authorization },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(700));
        controller.close();
      },
    }),
    // Node's fetch needs this for a streamed body; Bun ignores it.
    ...({ duplex: 'half' } as object),
  });
  assert.equal(oversized.status, 413);
  console.info(`${label}: Origin guard and streamed body limit passed`);
}

if (import.meta.main) {
  const [endpoint, label = 'server', token] = process.argv.slice(2);
  assert.ok(
    endpoint,
    'usage: bun scripts/smoke-client.ts <loopback MCP URL> [label] [token | --sign-in]',
  );
  const url = new URL(endpoint);
  await smoke(url, label, token === '--sign-in' ? await signIn(new URL(url.origin), label) : token);
}
