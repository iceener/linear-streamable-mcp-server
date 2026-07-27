// Cloudflare KV storage with encryption support
// Provider-agnostic version from Spotify MCP

import type { ProviderTokens, RsRecord, TokenStore, Transaction } from './interface.js';
import { MemoryTokenStore } from './memory.js';

// Cloudflare KV namespace type
type KVNamespace = {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
};

type EncryptFn = (plaintext: string) => Promise<string> | string;
type DecryptFn = (ciphertext: string) => Promise<string> | string;

function ttl(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function fromJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export class KvTokenStore implements TokenStore {
  private kv: KVNamespace;
  private encrypt: EncryptFn;
  private decrypt: DecryptFn;
  private fallback: MemoryTokenStore;

  constructor(
    kv: KVNamespace,
    options?: {
      encrypt?: EncryptFn;
      decrypt?: DecryptFn;
      fallback?: MemoryTokenStore;
    },
  ) {
    this.kv = kv;
    this.encrypt = options?.encrypt ?? ((s) => s);
    this.decrypt = options?.decrypt ?? ((s) => s);
    this.fallback = options?.fallback ?? new MemoryTokenStore();
  }

  private async putJson(
    key: string,
    value: unknown,
    options?: { expiration?: number; expirationTtl?: number },
  ): Promise<void> {
    try {
      const raw = await this.encrypt(toJson(value));
      await this.kv.put(key, raw, options);
    } catch (error) {
      console.error('[KV] ❌ Write failed:', key, (error as Error).message);
      throw error;
    }
  }

  private async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.kv.get(key);
    if (!raw) {
      return null;
    }
    const plain = await this.decrypt(raw);
    return fromJson<T>(plain);
  }

  async storeRsMapping(
    rsAccess: string,
    provider: ProviderTokens,
    rsRefresh?: string,
  ): Promise<RsRecord> {
    const rec: RsRecord = {
      rs_access_token: rsAccess,
      rs_refresh_token: rsRefresh ?? crypto.randomUUID(),
      provider: { ...provider },
      created_at: Date.now(),
    };

    // CRITICAL: Store in memory fallback FIRST
    // If KV fails (quota/network), memory still has it
    await this.fallback.storeRsMapping(rsAccess, provider, rsRefresh);

    // Then try KV (may fail due to quota)
    try {
      await Promise.all([
        this.putJson(`rs:access:${rec.rs_access_token}`, rec),
        this.putJson(`rs:refresh:${rec.rs_refresh_token}`, rec),
      ]);
    } catch (error) {
      console.warn('[KV] storeRsMapping failed:', (error as Error).message);
    }

    return rec;
  }

  async getByRsAccess(rsAccess: string): Promise<RsRecord | null> {
    const rec = await this.getJson<RsRecord>(`rs:access:${rsAccess}`);
    return rec ?? (await this.fallback.getByRsAccess(rsAccess));
  }

  async getByRsRefresh(rsRefresh: string): Promise<RsRecord | null> {
    const rec = await this.getJson<RsRecord>(`rs:refresh:${rsRefresh}`);
    return rec ?? (await this.fallback.getByRsRefresh(rsRefresh));
  }

  async updateByRsRefresh(
    rsRefresh: string,
    provider: ProviderTokens,
    maybeNewRsAccess?: string,
  ): Promise<RsRecord | null> {
    const existing = await this.getJson<RsRecord>(`rs:refresh:${rsRefresh}`);
    if (!existing) {
      return this.fallback.updateByRsRefresh(rsRefresh, provider, maybeNewRsAccess);
    }

    const rsAccessChanged =
      maybeNewRsAccess && maybeNewRsAccess !== existing.rs_access_token;
    const providerChanged =
      provider.access_token !== existing.provider.access_token ||
      provider.refresh_token !== existing.provider.refresh_token;

    // Skip KV writes if nothing changed
    if (!rsAccessChanged && !providerChanged) {
      return existing;
    }

    const next: RsRecord = {
      rs_access_token: maybeNewRsAccess || existing.rs_access_token,
      rs_refresh_token: rsRefresh,
      provider: { ...provider },
      created_at: Date.now(),
    };

    // Update memory fallback first
    await this.fallback.updateByRsRefresh(rsRefresh, provider, maybeNewRsAccess);

    try {
      if (rsAccessChanged) {
        await Promise.all([
          this.kv.delete(`rs:access:${existing.rs_access_token}`),
          this.putJson(`rs:access:${next.rs_access_token}`, next),
          this.putJson(`rs:refresh:${rsRefresh}`, next),
        ]);
      } else {
        await Promise.all([
          this.putJson(`rs:access:${existing.rs_access_token}`, next),
          this.putJson(`rs:refresh:${rsRefresh}`, next),
        ]);
      }
    } catch {
      // Memory fallback has it
    }

    return next;
  }

  async saveTransaction(
    txnId: string,
    txn: Transaction,
    ttlSeconds = 600,
  ): Promise<void> {
    await this.fallback.saveTransaction(txnId, txn);
    try {
      await this.putJson(`txn:${txnId}`, txn, { expiration: ttl(ttlSeconds) });
    } catch {
      // Memory fallback has it
    }
  }

  async getTransaction(txnId: string): Promise<Transaction | null> {
    const txn = await this.getJson<Transaction>(`txn:${txnId}`);
    return txn ?? (await this.fallback.getTransaction(txnId));
  }

  async deleteTransaction(txnId: string): Promise<void> {
    // Skip KV delete - TTL auto-expires
    await this.fallback.deleteTransaction(txnId);
  }

  async saveCode(code: string, txnId: string, ttlSeconds = 600): Promise<void> {
    await this.fallback.saveCode(code, txnId);
    try {
      await this.putJson(`code:${code}`, { v: txnId }, { expiration: ttl(ttlSeconds) });
    } catch {
      // Memory fallback has it
    }
  }

  async getTxnIdByCode(code: string): Promise<string | null> {
    const obj = await this.getJson<{ v: string }>(`code:${code}`);
    return obj?.v ?? (await this.fallback.getTxnIdByCode(code));
  }

  async deleteCode(code: string): Promise<void> {
    // Skip KV delete - TTL auto-expires
    await this.fallback.deleteCode(code);
  }
}
