import { describe, expect, test } from 'bun:test';
import { MemoryTokenStore, TokenStoreUnavailableError } from '../../src/oauth/token-store';
import { createProxyVerifier } from '../../src/oauth/verifier';
import { linearOAuth } from '../../src/services/linear-oauth';
import { LINEAR_CLIENT, type LogEntry, memoryLogger, PUBLIC_URL } from '../helpers';
import { linearTokens, SCOPE } from './fixture';

function verifierWith(
  tokens: MemoryTokenStore,
  linear = linearTokens(),
  logs: LogEntry[] = [],
  credentials = LINEAR_CLIENT,
) {
  return createProxyVerifier({
    tokens,
    provider: linearOAuth,
    credentials,
    resource: new URL(PUBLIC_URL),
    logger: memoryLogger(logs),
    fetch: linear,
  });
}

async function storeGrant(
  tokens: MemoryTokenStore,
  expiresAt: number,
  options: { refresh?: string; scopes?: string[]; bound?: boolean } = {},
) {
  await tokens.storeRsMapping(
    'mcp-token',
    {
      access_token: 'linear-old',
      ...(options.refresh !== undefined && { refresh_token: options.refresh }),
      expires_at: expiresAt,
      ...(options.scopes && { scopes: options.scopes }),
    },
    'mcp-refresh',
    options.bound === false ? undefined : { clientId: 'client-1', resource: PUBLIC_URL },
  );
}

describe('the proxy verifier', () => {
  test('gives tools the Linear token, and nothing that could refresh it', async () => {
    const tokens = new MemoryTokenStore();
    await storeGrant(tokens, Date.now() + 3_600_000, { refresh: 'linear-refresh', scopes: ['a'] });
    const caller = await verifierWith(tokens).verifyAccessToken('mcp-token');

    expect(caller).toMatchObject({
      token: 'mcp-token',
      clientId: 'client-1',
      scopes: ['a'],
      resource: new URL(PUBLIC_URL),
      expiresAt: expect.any(Number),
    });
    expect(caller.extra).toEqual({ providerAccessToken: 'linear-old' });
    expect(JSON.stringify(caller)).not.toContain('linear-refresh');
  });

  test('refreshes a Linear token that expires within a minute, once per cooldown', async () => {
    const tokens = new MemoryTokenStore();
    const linear = linearTokens();
    await storeGrant(tokens, Date.now() + 30_000, { refresh: 'linear-refresh', scopes: ['a'] });
    const verifier = verifierWith(tokens, linear);

    const [first, second] = await Promise.all([
      verifier.verifyAccessToken('mcp-token'),
      verifier.verifyAccessToken('mcp-token'),
    ]);
    expect([first.extra, second.extra]).toContainEqual({ providerAccessToken: 'linear-fresh' });
    const stored = await tokens.getByRsAccess('mcp-token');
    expect(stored?.provider).toMatchObject({
      access_token: 'linear-fresh',
      scopes: [SCOPE.split(' ')].flat(),
    });
    // The access token never changes here; only /token rotates it.
    expect(stored?.rs_access_token).toBe('mcp-token');

    // Expiring again within the cooldown: no second refresh.
    await tokens.updateByRsRefresh('mcp-refresh', {
      ...(stored?.provider ?? { access_token: '' }),
      expires_at: Date.now() + 30_000,
    });
    const calls = linear.forms.length;
    await verifier.verifyAccessToken('mcp-token');
    expect(linear.forms.length).toBe(calls);
  });

  test('a refresh Linear refuses keeps the current token while it is valid', async () => {
    const tokens = new MemoryTokenStore();
    const logs: LogEntry[] = [];
    const linear = linearTokens(() => new Response('{"error":"invalid_grant"}', { status: 400 }));
    await storeGrant(tokens, Date.now() + 30_000, { refresh: 'linear-refresh' });
    const caller = await verifierWith(tokens, linear, logs).verifyAccessToken('mcp-token');

    expect(caller.extra).toEqual({ providerAccessToken: 'linear-old' });
    expect(logs.map((entry) => entry.message)).toContain(
      'Linear token refresh failed; using the current token',
    );
    expect(JSON.stringify(logs)).not.toContain('invalid_grant');
  });

  test('an expired Linear token that cannot be refreshed is an invalid token', async () => {
    const tokens = new MemoryTokenStore();
    await storeGrant(tokens, Date.now() - 1_000);
    await expect(verifierWith(tokens).verifyAccessToken('mcp-token')).rejects.toMatchObject({
      code: 'invalid_token',
    });

    const withoutClient = new MemoryTokenStore();
    await storeGrant(withoutClient, Date.now() - 1_000, { refresh: 'linear-refresh' });
    const linear = linearTokens();
    await expect(
      verifierWith(withoutClient, linear, [], { clientId: '', clientSecret: '' }).verifyAccessToken(
        'mcp-token',
      ),
    ).rejects.toMatchObject({ code: 'invalid_token' });
    expect(linear.forms).toHaveLength(0);
  });

  test('records from before provenance get the configured scopes and a stable caller ID', async () => {
    const tokens = new MemoryTokenStore();
    await storeGrant(tokens, Date.now() + 3_600_000, { scopes: [], bound: false });
    const verifier = verifierWith(tokens);
    const caller = await verifier.verifyAccessToken('mcp-token');

    expect(caller.scopes).toEqual(SCOPE.split(' '));
    expect(caller.clientId).toMatch(/^rs:[0-9a-f]{64}$/);
    expect((await verifier.verifyAccessToken('mcp-token')).clientId).toBe(caller.clientId);
    expect(caller.clientId).not.toContain('mcp-token');
    expect(caller.resource?.href).toBe(PUBLIC_URL);
  });

  test('a token store that cannot be reached: 500, so the client keeps its token', async () => {
    const failing = Object.assign(new MemoryTokenStore(), {
      getByRsAccess: async () => {
        throw new TokenStoreUnavailableError('KV read failed (access record)');
      },
    });
    const logs: LogEntry[] = [];
    const serverError = verifierWith(failing, linearTokens(), logs);
    const rejection = await serverError.verifyAccessToken('mcp-token').catch((error) => error);
    // Not an OAuthError, so the SDK's bearer gate answers 500 and the client keeps its token.
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).not.toHaveProperty('code');
    expect(logs.map((entry) => [entry.level, entry.message])).toEqual([
      ['error', 'Could not check an access token'],
    ]);
  });

  test('any other failure reading the record is an invalid token', async () => {
    const broken = Object.assign(new MemoryTokenStore(), {
      getByRsAccess: async () => {
        throw new Error('Invalid ciphertext: too short');
      },
    });
    await expect(verifierWith(broken).verifyAccessToken('mcp-token')).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });
});
