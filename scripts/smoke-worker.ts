import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { unstable_startWorker } from 'wrangler';
// Node runs this file directly, so the imports name the .ts files.
import { TEST_SETTINGS } from '../tests/settings.ts';
import { startMockLinear, toMock } from './mock-linear.ts';
import { oauthSteps } from './smoke-client.ts';

/**
 * Run the real Worker in local workerd, with the KV namespace and the `NativeOAuthAuthority`
 * Durable Object from wrangler.jsonc: in OAuth mode, signing in through Linear mocked on
 * loopback and driven by the shared smoke client; then the authorization state across Worker
 * restarts and concurrent requests; then misconfigured, to check it fails safely. Every
 * request the Worker makes goes to the mock or is refused. Wrangler's API needs Node, so this
 * file runs under Node; the shared client runs under Bun.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const plain = (value: string) => ({ type: 'plain_text' as const, value });

process.env.WRANGLER_SEND_METRICS = 'false';
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

const linear = await startMockLinear('smoke-client', 'smoke-secret');
const persist = await mkdtemp(join(tmpdir(), 'linear-smoke-'));

function startWorker(
  vars: Record<string, string>,
  port: number,
  options: { logLevel?: 'warn' | 'none'; config?: string; persist?: string | false } = {},
) {
  return unstable_startWorker({
    config: options.config ?? `${root}wrangler.jsonc`,
    bindings: Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, plain(value)])),
    dev: {
      server: { hostname: '127.0.0.1', port },
      inspector: false,
      watch: false,
      logLevel: options.logLevel ?? 'warn',
      persist: options.persist ?? false,
      outboundService: async (request: Request) => fetch(await toMock(request, linear)),
    },
  });
}

/** A port the OS just assigned: the proxy needs its own origin before it starts. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function oauthVars(origin: string): Record<string, string> {
  return {
    ...TEST_SETTINGS,
    NODE_ENV: 'test',
    MCP_PUBLIC_URL: `${origin}/mcp`,
    MCP_MAX_REQUEST_BYTES: '1024',
    AUTH_MODE: 'oauth',
    OAUTH_ISSUER_URL: origin,
    OAUTH_AUTHORIZATION_URL: `${origin}/authorize`,
    OAUTH_TOKEN_URL: `${origin}/token`,
    OAUTH_REGISTRATION_URL: `${origin}/register`,
    OAUTH_SCOPES: 'read write',
    PROVIDER_CLIENT_ID: 'smoke-client',
    PROVIDER_CLIENT_SECRET: 'smoke-secret',
    RS_TOKENS_ENC_KEY: Buffer.alloc(32, 4).toString('base64url'),
  };
}

try {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const vars = oauthVars(origin);

  // 1. The shared smoke client: sign in, both protocol eras, the guards.
  let worker = await startWorker(vars, port, { persist });
  try {
    const endpoint = new URL('/mcp', await worker.url).href;
    assert.equal(new URL(endpoint).origin, origin);
    const { stdout, stderr } = await promisify(execFile)(
      'bun',
      [`${root}scripts/smoke-client.ts`, endpoint, 'workers', '--sign-in'],
      { cwd: root, timeout: 60_000 },
    );
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    assert.deepEqual(linear.grants, ['authorization_code']);
    assert.equal(linear.queries, 2, 'list_teams reached the mocked Linear in both eras');
  } finally {
    await worker.dispose();
  }

  // 2. The authority Durable Object and KV, across Worker restarts and concurrent requests.
  const steps = oauthSteps(new URL(origin));
  const restart = async () => {
    await worker.dispose();
    worker = await startWorker(vars, port, { persist });
    await worker.url;
  };
  worker = await startWorker(vars, port, { persist });
  await worker.url;
  try {
    const clientId = await steps.register();
    const state = await steps.authorize(clientId);
    await restart();

    // Concurrent callbacks: the transaction is claimed once, before Linear is called.
    const grants = linear.grants.length;
    linear.tokenDelayMs = 50;
    const callbacks = await Promise.all(Array.from({ length: 8 }, () => steps.callback(state)));
    linear.tokenDelayMs = 0;
    assert.equal(callbacks.filter((callback) => callback.status === 302).length, 1);
    assert.equal(linear.grants.length - grants, 1);
    const code = steps.codeFrom(callbacks.find((callback) => callback.status === 302) as Response);
    await restart();

    // A wrong binding or verifier leaves the code usable; concurrent redemptions succeed once.
    for (const overrides of [
      { redirect_uri: 'http://127.0.0.1:43210/oauth/callback/' },
      { client_id: 'A'.repeat(32) },
      { code_verifier: 'wrong'.repeat(10) },
      { resource: `${origin}/mcp/` },
    ]) {
      assert.equal((await steps.redeem(clientId, code, overrides)).status, 400);
    }
    const redemptions = await Promise.all(
      Array.from({ length: 10 }, () => steps.redeem(clientId, code)),
    );
    assert.equal(redemptions.filter((response) => response.status === 200).length, 1);
    const winner = redemptions.find((response) => response.status === 200) as Response;
    assert.equal(winner.headers.get('cache-control'), 'no-store');
    const pair = (await winner.json()) as { access_token: string };
    const gated = await fetch(new URL('/mcp', origin), {
      headers: { Authorization: `Bearer ${pair.access_token}` },
    });
    assert.equal(gated.status, 405, 'the issued token passes the gate; GET is not served');

    // Nothing comes back after a restart: the code and the callback are spent.
    await restart();
    assert.equal((await steps.redeem(clientId, code)).status, 400);
    assert.equal((await steps.callback(state, 'replay')).status, 400);

    // A failed exchange at Linear is a 503 without Linear's answer, and can't be replayed.
    const failedState = await steps.authorize(clientId);
    console.info('workers: Linear refuses the next code; one "OAuth request failed" log follows');
    linear.failNextToken = true;
    const before = linear.grants.length;
    const failed = await steps.callback(failedState, 'fails');
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes('mock provider secret'));
    assert.equal((await steps.callback(failedState, 'fails')).status, 400);
    assert.equal(linear.grants.length - before, 1);
    console.info('workers: authority state across restarts, races and a failed exchange passed');
  } finally {
    await worker.dispose();
  }

  // 3. Without the Durable Object binding, the Worker refuses to serve: a generic 500.
  const config = join(persist, 'wrangler.no-authority.jsonc');
  await writeFile(
    config,
    JSON.stringify({
      name: 'linear-mcp-smoke',
      main: `${root}src/worker.ts`,
      compatibility_date: '2026-09-08',
      compatibility_flags: ['nodejs_compat'],
      kv_namespaces: [{ binding: 'TOKENS', id: '00000000000000000000000000000000' }],
    }),
  );
  const unbound = await startWorker(vars, await freePort(), { config, logLevel: 'none' });
  try {
    const response = await fetch(new URL('/register', await unbound.url), { method: 'POST' });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'server_misconfigured' });
    console.info('workers: a missing OAUTH_AUTHORITY binding answers a generic 500');
  } finally {
    await unbound.dispose();
  }

  // 4. Production settings with the auth decision missing: every request gets a generic 500.
  // Its configuration error is the point here, so keep it out of the output.
  const misconfigured = await startWorker(
    { NODE_ENV: 'production', MCP_PUBLIC_URL: 'https://mcp.example.com/mcp', AUTH_MODE: '' },
    await freePort(),
    { logLevel: 'none' },
  );
  try {
    const response = await fetch(new URL('/health', await misconfigured.url));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'server_misconfigured' });
    console.info('workers: invalid configuration answers a generic 500');
  } finally {
    await misconfigured.dispose();
  }
} finally {
  await linear.close();
  await rm(persist, { recursive: true, force: true });
}
