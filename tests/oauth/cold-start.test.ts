import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pkceChallenge } from '../../src/oauth/crypto';
import { loopback, VERIFIER } from './fixture';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

/**
 * The Bun runtime keeps the whole OAuth state on disk. Every step below runs in a new process
 * (`cold-process.ts`), so nothing survives in memory between them: registration,
 * authorization, Linear's callback, redemption and a refresh.
 */
test('a complete sign-in survives process restarts between every step, with encrypted files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linear-cold-process-'));
  directories.push(directory);
  const key = Buffer.alloc(32, 9).toString('base64url');
  const origin = 'https://linear-mcp.example';
  const request = async (path: string, body?: Record<string, unknown>) => {
    const child = Bun.spawn(
      [process.execPath, new URL('./cold-process.ts', import.meta.url).pathname],
      {
        stdin: new Blob([JSON.stringify({ directory, key, path, body })]),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit, stderr).toBe(0);
    return JSON.parse(stdout) as { status: number; location: string; body: string };
  };

  const uri = loopback();
  const registration = await request('/register', {
    application_type: 'native',
    redirect_uris: [uri],
    token_endpoint_auth_method: 'none',
  });
  expect(registration.status).toBe(201);
  const client = JSON.parse(registration.body) as { client_id: string };
  const auth = await request(
    `/authorize?${new URLSearchParams({
      client_id: client.client_id,
      response_type: 'code',
      redirect_uri: uri,
      code_challenge: await pkceChallenge(VERIFIER),
      code_challenge_method: 'S256',
      state: 'cold exact state',
    })}`,
  );
  expect(auth.status).toBe(302);
  const state = new URL(auth.location).searchParams.get('state');
  const callback = await request(`/oauth/callback?code=mock-code&state=${state}`);
  expect(callback.status).toBe(302);
  const target = new URL(callback.location);
  expect(target.origin + target.pathname).toBe(uri);
  expect(target.searchParams.get('state')).toBe('cold exact state');

  const grant = {
    grant_type: 'authorization_code',
    client_id: client.client_id,
    redirect_uri: uri,
    code: target.searchParams.get('code'),
    code_verifier: VERIFIER,
    resource: `${origin}/mcp`,
  };
  const issued = await request('/token', grant);
  expect(issued.status).toBe(200);
  const pair = JSON.parse(issued.body) as { access_token: string; refresh_token: string };
  expect((await request('/token', grant)).status).toBe(400);
  expect((await request(`/oauth/callback?code=again&state=${state}`)).status).toBe(400);

  // Refresh as before: no client ID needed, and the same access token comes back.
  const refreshed = await request('/token', {
    grant_type: 'refresh_token',
    refresh_token: pair.refresh_token,
  });
  expect(refreshed.status).toBe(200);
  expect(JSON.parse(refreshed.body).access_token).toBe(pair.access_token);

  // The token file is the version-1 envelope, encrypted whole.
  const file = await readFile(join(directory, 'tokens.json'), 'utf8');
  expect(file).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(file).not.toContain('cold-linear-access');
  expect(file).not.toContain(pair.access_token);
}, 30_000);
