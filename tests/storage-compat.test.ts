import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { FileTokenStore } from '../src/shared/storage/file.js';
import { KvTokenStore } from '../src/shared/storage/kv.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('OAuth storage rollback compatibility', () => {
  test('reads and writes the existing version-1 file record format', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'linear-mcp-storage-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'tokens.json');
    const oldRecord = {
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
    writeFileSync(
      path,
      JSON.stringify({ version: 1, encrypted: false, records: [oldRecord] }),
      'utf8',
    );

    const store = new FileTokenStore(path);
    expect(await store.getByRsAccess('old-mcp-access')).toMatchObject(oldRecord);
    await store.storeRsMapping(
      'new-mcp-access',
      {
        access_token: 'new-linear-access',
        expires_at: Date.now() + 300_000,
        scopes: ['read', 'write'],
      },
      'new-mcp-refresh',
    );
    store.flush();
    store.stopCleanup();

    const persisted = JSON.parse(readFileSync(path, 'utf8')) as {
      version: number;
      encrypted: boolean;
      records: Array<Record<string, unknown>>;
    };
    expect(persisted.version).toBe(1);
    expect(persisted.encrypted).toBe(false);
    expect(persisted.records).toHaveLength(2);
    expect(persisted.records[0]).toMatchObject(oldRecord);
  });

  test('keeps the existing KV key names and JSON record shape', async () => {
    const oldRecord = {
      rs_access_token: 'old-mcp-access',
      rs_refresh_token: 'old-mcp-refresh',
      provider: {
        access_token: 'old-linear-access',
        expires_at: Date.now() + 300_000,
        scopes: ['read'],
      },
      created_at: Date.now(),
    };
    const values = new Map<string, string>([
      ['rs:access:old-mcp-access', JSON.stringify(oldRecord)],
      ['rs:refresh:old-mcp-refresh', JSON.stringify(oldRecord)],
    ]);
    const kv = {
      async get(key: string) {
        return values.get(key) ?? null;
      },
      async put(key: string, value: string) {
        values.set(key, value);
      },
      async delete(key: string) {
        values.delete(key);
      },
    };
    const store = new KvTokenStore(kv);

    expect(await store.getByRsAccess('old-mcp-access')).toEqual(oldRecord);
    await store.storeRsMapping(
      'new-mcp-access',
      { access_token: 'new-linear-access', scopes: ['read'] },
      'new-mcp-refresh',
    );
    expect(values.has('rs:access:new-mcp-access')).toBe(true);
    expect(values.has('rs:refresh:new-mcp-refresh')).toBe(true);
    expect(JSON.parse(values.get('rs:access:new-mcp-access') ?? '{}')).toMatchObject({
      rs_access_token: 'new-mcp-access',
      rs_refresh_token: 'new-mcp-refresh',
      provider: { access_token: 'new-linear-access' },
    });
  });
});
