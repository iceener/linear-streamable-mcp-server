import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOAuthAuthority } from '../../src/oauth/authority-file';
import { createEncryptor, pkceChallenge } from '../../src/oauth/crypto';
import type { RsRecord } from '../../src/oauth/token-store';
import { FileTokenStore } from '../../src/oauth/token-store-file';
import { type KvLike, KvTokenStore } from '../../src/oauth/token-store-kv';
import { createLogger } from '../../src/platform/logger';
import before from '../fixtures/storage-before.json';
import { cleanup, type LogEntry, memoryLogger, message, post } from '../helpers';
import { CALLBACK, handleFor, linearTokens, ORIGIN, proxyFixture, VERIFIER } from './fixture';

/**
 * Stored tokens must survive the migration: records the checkpoint code (2f723fd) wrote through
 * its own routes, in `fixtures/storage-before.json`, are read, verified and refreshed here, and
 * new writes are checked against the old layouts with an independent implementation of each
 * codec.
 */
const KEY = before.key;
const RECORDS = before.records;
const directories: string[] = [];

afterEach(async () => {
  await cleanup();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'linear-storage-'));
  directories.push(directory);
  return directory;
}

class FakeKv implements KvLike {
  readonly values = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
}

/** The KV and grant layout, independently: base64url(iv[12] || ciphertext || tag[16]). */
function openKvValue(value: string, key = KEY): unknown {
  const bytes = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64url'),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(12, bytes.length - 16)),
      decipher.final(),
    ]).toString(),
  );
}

/** The token file layout, independently: base64url(iv[12] || tag[16] || ciphertext). */
function openFile(value: string, key = KEY): unknown {
  const bytes = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64url'),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
  );
}

function kvStore(kv: KvLike, key: string | null = KEY, logs: LogEntry[] = []): KvTokenStore {
  return new KvTokenStore(kv, {
    encryptor: key ? createEncryptor(key) : undefined,
    logger: memoryLogger(logs),
  });
}

/** Linear's refresh answer, as in the recording: a new token, and no `scope`. */
const refreshWithoutScope = () =>
  linearTokens(() =>
    Response.json({
      access_token: 'linear-access-refreshed-now',
      refresh_token: 'linear-refresh-rotated-now',
      expires_in: 86_399,
      token_type: 'Bearer',
    }),
  );

describe('records written before the migration', () => {
  test('KV records are read as they were written, without a client binding', async () => {
    const store = kvStore(new FakeKv(before.kv));
    for (const [name, record] of Object.entries(RECORDS)) {
      const stored = await store.getByRsAccess(record.accessToken);
      expect(stored, name).toMatchObject({
        rs_access_token: record.accessToken,
        rs_refresh_token: record.refreshToken,
      });
      expect(stored?.oauth, name).toBeUndefined();
      expect(stored?.provider.scopes ?? null, name).toEqual(record.storedScopes);
      expect(await store.getByRsRefresh(record.refreshToken), name).toEqual(stored);
    }
  });

  /**
   * Production requires "read write" on every request. The checkpoint reported the stored
   * scopes as they were, so every record without exactly ["read","write"] got 403. The proxy
   * now reports the requested Linear scopes for a record that stored none, as gmail-mcp does
   * for its records without a binding, and keeps the stored scopes when Linear omits them on
   * refresh. A stored "read,write" stays refused, as before; signing in again fixes it.
   */
  test('each checkpoint record at the MCP gate: before and after', async () => {
    const after = {
      spaced: 200,
      array: 403,
      comma: 403,
      unscoped: 200,
      expiring: 200,
      refreshed: 200,
      missing: 200,
    } as const;
    const before403 = Object.entries(RECORDS)
      .filter(([, record]) => JSON.stringify(record.checkpointMcp).includes('403'))
      .map(([name]) => name);
    expect(before403).toEqual(['array', 'comma', 'unscoped', 'refreshed', 'missing']);

    const kv = new FakeKv(before.kv);
    const f = proxyFixture({ tokens: kvStore(kv), linear: refreshWithoutScope() });
    for (const [name, record] of Object.entries(RECORDS)) {
      const response = await post(f.app, message('tools/list'), {
        Authorization: `Bearer ${record.accessToken}`,
      });
      expect([name, response.status]).toEqual([name, after[name as keyof typeof after]]);
      if (response.status === 403) {
        expect(response.headers.get('WWW-Authenticate')).toContain('insufficient_scope');
      }
    }
    // Only the expired record was refreshed at Linear.
    expect(f.linear.forms.map((form) => Object.fromEntries(form))).toEqual([
      { grant_type: 'refresh_token', refresh_token: 'linear-refresh-expiring' },
    ]);
  });

  test('an expired Linear token is refreshed on use, in the same format, keeping its scopes', async () => {
    const kv = new FakeKv(before.kv);
    const linear = refreshWithoutScope();
    const f = proxyFixture({ tokens: kvStore(kv), linear });
    const { accessToken, refreshToken } = RECORDS.expiring;

    const caller = await f.proxy.verifier.verifyAccessToken(accessToken);
    expect(caller.extra).toEqual({ providerAccessToken: 'linear-access-refreshed-now' });
    // No binding: the caller is a hash of the token; Linear's answer had no scope.
    expect(caller.clientId).toMatch(/^rs:[0-9a-f]{64}$/);
    expect(caller.scopes).toEqual(['read', 'write']);

    // Both keys were rewritten in the old layout, readable by the old codec. The MCP access
    // token is kept although Linear rotated its refresh token: only /token rotates it.
    for (const key of [`rs:access:${accessToken}`, `rs:refresh:${refreshToken}`]) {
      const record = openKvValue(kv.values.get(key) as string) as RsRecord;
      expect(Object.keys(record)).toEqual([
        'rs_access_token',
        'rs_refresh_token',
        'provider',
        'created_at',
      ]);
      expect(record).toMatchObject({
        rs_access_token: accessToken,
        rs_refresh_token: refreshToken,
        provider: {
          access_token: 'linear-access-refreshed-now',
          refresh_token: 'linear-refresh-rotated-now',
          scopes: ['read', 'write'],
        },
      });
    }
  });

  test('a checkpoint refresh token refreshes at /token without a client ID', async () => {
    const f = proxyFixture({ tokens: kvStore(new FakeKv(before.kv)) });
    const { accessToken, refreshToken } = RECORDS.spaced;
    const response = await f.request(
      '/token',
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      scope: 'read write',
    });
    // The Linear token is good for years: nothing was asked of Linear.
    expect(f.linear.forms).toHaveLength(0);
  });

  test('the encrypted token file opens', async () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'tokens.json');
    writeFileSync(path, before.file);
    const store = new FileTokenStore(path, KEY, memoryLogger());
    const record = await store.getByRsAccess('file-rs-access');
    expect(record).toMatchObject({
      rs_refresh_token: 'file-rs-refresh',
      provider: { access_token: 'linear-access-file', scopes: ['read', 'write'] },
    });
    expect(record?.oauth).toBeUndefined();
  });

  test('a code issued before the migration, still within its two minutes, is redeemed', async () => {
    const directory = temporaryDirectory();
    const clientDocument = JSON.parse(before.authorityDocument) as {
      client: { client_id: string; redirect_uris: string[] };
    };
    const clientId = clientDocument.client.client_id;
    const redirectUri = clientDocument.client.redirect_uris[0] as string;
    const code = handleFor(clientId);
    writeFileSync(
      join(directory, `${clientId}.json`),
      JSON.stringify({
        ...clientDocument,
        codes: {
          [code]: {
            clientId,
            redirectUri,
            resource: `${ORIGIN}/mcp`,
            codeChallenge: await pkceChallenge(VERIFIER),
            providerCallbackUri: CALLBACK,
            expiresAt: Date.now() + 60_000,
            providerMaterial: before.grantProviderMaterial,
          },
        },
      }),
    );
    const f = proxyFixture({ authority: new FileOAuthAuthority(directory), encryptionKey: KEY });
    const response = await f.request(
      '/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: VERIFIER,
      }),
    );
    expect(response.status).toBe(200);
    const pair = (await response.json()) as { access_token: string; scope: string };
    expect(pair.scope).toBe('read write');
    expect(await f.tokens.getByRsAccess(pair.access_token)).toMatchObject({
      provider: { access_token: 'linear-access-grant', scopes: ['read', 'write'] },
    });
  });

  test('a client registered before the migration can still sign in', async () => {
    const directory = temporaryDirectory();
    const document = JSON.parse(before.authorityDocument) as {
      client: { client_id: string; redirect_uris: string[] };
    };
    expect(document.client.client_id).toBe(before.clientId);
    writeFileSync(join(directory, `${document.client.client_id}.json`), before.authorityDocument);
    const f = proxyFixture({ authority: new FileOAuthAuthority(directory) });
    const response = await f.request(
      `/authorize?${new URLSearchParams({
        client_id: document.client.client_id,
        response_type: 'code',
        // Native clients may pick another port at sign-in.
        redirect_uri: 'http://127.0.0.1:50000/oauth/callback',
        code_challenge: await pkceChallenge(VERIFIER),
        code_challenge_method: 'S256',
      })}`,
    );
    expect(response.status).toBe(302);
  });
});

describe('new writes keep the old layouts', () => {
  test('KV: both keys hold the same record, encrypted as before, without a binding', async () => {
    const kv = new FakeKv();
    const f = proxyFixture({ tokens: kvStore(kv) });
    const uri = 'http://127.0.0.1:43210/oauth/callback';
    const registered = await f.request('/register', {
      application_type: 'native',
      redirect_uris: [uri],
    });
    const { client_id: clientId } = (await registered.json()) as { client_id: string };
    const authorized = await f.request(
      `/authorize?${new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: uri,
        code_challenge: await pkceChallenge(VERIFIER),
        code_challenge_method: 'S256',
      })}`,
    );
    const state = new URL(authorized.headers.get('location') as string).searchParams.get('state');
    const back = await f.request(`/oauth/callback?code=c&state=${state}`);
    const code = new URL(back.headers.get('location') as string).searchParams.get('code') as string;
    const issued = (await (
      await f.request(
        '/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          redirect_uri: uri,
          code_verifier: VERIFIER,
        }),
      )
    ).json()) as { access_token: string; refresh_token: string };

    const byAccess = openKvValue(kv.values.get(`rs:access:${issued.access_token}`) as string);
    expect(openKvValue(kv.values.get(`rs:refresh:${issued.refresh_token}`) as string)).toEqual(
      byAccess,
    );
    expect(Object.keys(byAccess as object)).toEqual([
      'rs_access_token',
      'rs_refresh_token',
      'provider',
      'created_at',
    ]);
    expect([...kv.values.keys()].sort()).toEqual(
      [`rs:access:${issued.access_token}`, `rs:refresh:${issued.refresh_token}`].sort(),
    );
  });

  test('KV without a key stores plain JSON, and reads it back', async () => {
    const kv = new FakeKv();
    const store = kvStore(kv, null);
    await store.storeRsMapping('plain-access', { access_token: 'l' }, 'plain-refresh');
    expect(JSON.parse(kv.values.get('rs:access:plain-access') as string)).toMatchObject({
      provider: { access_token: 'l' },
    });
    expect(await store.getByRsRefresh('plain-refresh')).toMatchObject({
      rs_access_token: 'plain-access',
    });
  });

  test('KV: a failed write still works in this isolate', async () => {
    const kv: KvLike = {
      get: async () => null,
      put: async () => {
        throw new Error('KV quota exceeded');
      },
      delete: async () => {},
    };
    const logs: LogEntry[] = [];
    const store = kvStore(kv, null, logs);
    await store.storeRsMapping('a', { access_token: 'l' }, 'r');
    expect((await store.getByRsAccess('a'))?.provider.access_token).toBe('l');
    expect(logs.map((entry) => entry.level)).toEqual(['warning']);
  });

  // Kept from the checkpoint's audit fix: KV keys contain the tokens, and KV's own errors may
  // repeat the key, so diagnostics name the kind of record and nothing else.
  test('KV failure diagnostics never contain credential keys or error messages', async () => {
    const kv: KvLike = {
      get: async (key) => {
        throw new Error(`failed sensitive key ${key}`);
      },
      put: async (key) => {
        throw new Error(`failed sensitive key ${key}`);
      },
      delete: async (key) => {
        throw new Error(`failed sensitive key ${key}`);
      },
    };
    // The real logger, so the test sees the JSON lines production writes.
    const lines: string[] = [];
    const warn = spyOn(console, 'warn').mockImplementation((line: string) => {
      lines.push(line);
    });
    const store = new KvTokenStore(kv, {
      encryptor: createEncryptor(KEY),
      logger: createLogger('debug'),
    });
    await store.storeRsMapping(
      'synthetic-access-secret',
      { access_token: 'synthetic-provider-secret' },
      'synthetic-refresh-secret',
    );
    warn.mockRestore();
    const read = await store.getByRsAccess('synthetic-access-secret').catch((error) => error);
    const written = lines.join('\n');
    const thrown = JSON.stringify({ message: read.message, name: read.name });

    expect(lines).toHaveLength(1);
    for (const secret of [
      'synthetic-access-secret',
      'synthetic-refresh-secret',
      'synthetic-provider-secret',
      'failed sensitive key',
    ]) {
      expect(written).not.toContain(secret);
      expect(thrown).not.toContain(secret);
    }
    expect(written).toContain('KV write failed (access record)');
    expect(written).toContain('KV write failed (refresh record)');
    expect(read.message).toBe('KV read failed (access record)');
  });

  test('file: version 1, encrypted whole, readable with the old codec and after a restart', async () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'tokens.json');
    const writer = new FileTokenStore(path, KEY, memoryLogger());
    await writer.storeRsMapping(
      'new-access',
      { access_token: 'l', refresh_token: 'r', expires_at: Date.now() + 3_600_000 },
      'new-refresh',
    );
    writer.flush();

    const file = readFileSync(path, 'utf8');
    expect(file).toMatch(/^[A-Za-z0-9_-]+$/);
    const saved = openFile(file) as { version: number; encrypted: boolean; records: RsRecord[] };
    expect(saved.version).toBe(1);
    expect(saved.records[0]).toMatchObject({ rs_access_token: 'new-access' });
    expect(
      (await new FileTokenStore(path, KEY, memoryLogger()).getByRsAccess('new-access'))?.provider,
    ).toMatchObject({ access_token: 'l' });
  });

  test('file: a plaintext version 1 file is read and written back unchanged', async () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'tokens.json');
    const record: RsRecord = {
      rs_access_token: 'old-mcp-access',
      rs_refresh_token: 'old-mcp-refresh',
      provider: {
        access_token: 'old-linear-access',
        refresh_token: 'old-linear-refresh',
        expires_at: Date.now() + 300_000,
        scopes: ['read', 'write'],
      },
      created_at: Date.now() - 1_000,
    };
    writeFileSync(path, JSON.stringify({ version: 1, encrypted: false, records: [record] }));
    const store = new FileTokenStore(path, undefined, memoryLogger());
    expect(await store.getByRsAccess('old-mcp-access')).toMatchObject(record);
    await store.storeRsMapping(
      'new-mcp-access',
      { access_token: 'new-linear-access', expires_at: Date.now() + 300_000 },
      'new-mcp-refresh',
    );
    store.flush();
    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    expect(persisted).toMatchObject({ version: 1, encrypted: false });
    expect(persisted.records).toHaveLength(2);
    expect(persisted.records[0]).toMatchObject(record);
  });

  test('the authority grant layout is the KV layout, prefixed with enc:', async () => {
    const material = before.grantProviderMaterial;
    expect(material.startsWith('enc:')).toBe(true);
    expect(openKvValue(material.slice(4))).toMatchObject({
      access_token: 'linear-access-grant',
      scopes: ['read', 'write'],
    });
    const sealed = await createEncryptor(KEY).encrypt('{"a":1}');
    expect(openKvValue(sealed)).toEqual({ a: 1 });
    // And the new code opens what the old layout produces.
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(KEY, 'base64url'), iv);
    const body = Buffer.concat([cipher.update('{"b":2}'), cipher.final()]);
    const old = Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
    expect(JSON.parse(await createEncryptor(KEY).decrypt(old))).toEqual({ b: 2 });
  });
});
