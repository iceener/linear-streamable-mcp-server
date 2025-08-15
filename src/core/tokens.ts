// Avoid Node-only imports in Worker: prefer Web Crypto; fallback to Math.random.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config/env.ts';

export type LinearUserTokens = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  scopes?: string[];
};

export type RsTokenRecord = {
  rs_access_token: string;
  rs_refresh_token: string;
  created_at: number; // epoch ms
  linear: LinearUserTokens;
};

const rsAccessToRecord = new Map<string, RsTokenRecord>();
const rsRefreshToRecord = new Map<string, RsTokenRecord>();

function persistPath(): string | null {
  return config.RS_TOKENS_FILE || null;
}

type PersistShape = {
  records: Array<{
    rs_access_token: string;
    rs_refresh_token: string;
    created_at: number;
    linear: LinearUserTokens;
  }>;
};

function loadPersisted(): void {
  const p = persistPath();
  if (!p) {
    return;
  }
  try {
    if (!existsSync(p)) {
      return;
    }
    const raw = readFileSync(p, 'utf8');
    const data = JSON.parse(raw) as PersistShape;
    if (!data || !Array.isArray(data.records)) {
      return;
    }
    for (const rec of data.records) {
      const record: RsTokenRecord = {
        rs_access_token: rec.rs_access_token,
        rs_refresh_token: rec.rs_refresh_token,
        created_at: rec.created_at,
        linear: rec.linear,
      };
      rsAccessToRecord.set(record.rs_access_token, record);
      rsRefreshToRecord.set(record.rs_refresh_token, record);
    }
  } catch {}
}

function savePersisted(): void {
  const p = persistPath();
  if (!p) {
    return;
  }
  try {
    const dir = dirname(p);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const records = Array.from(rsAccessToRecord.values()).map((r) => ({
      rs_access_token: r.rs_access_token,
      rs_refresh_token: r.rs_refresh_token,
      created_at: r.created_at,
      linear: r.linear,
    }));
    const obj: PersistShape = { records };
    writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  } catch {}
}

loadPersisted();

function webCryptoRandomBase64Url(bytes: number): string | null {
  try {
    const g = (
      globalThis as unknown as {
        crypto?: { getRandomValues?: (arr: Uint8Array) => void };
      }
    ).crypto;
    if (!g || typeof g.getRandomValues !== 'function') {
      return null;
    }
    const arr = new Uint8Array(bytes);
    g.getRandomValues(arr);
    let binary = '';
    for (const byte of arr) {
      binary += String.fromCharCode(byte);
    }
    const base64 = typeof btoa === 'function' ? btoa(binary) : null;
    if (!base64) {
      return null;
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch {
    return null;
  }
}

export function generateOpaqueToken(bytes: number = 32): string {
  const web = webCryptoRandomBase64Url(bytes);
  if (web) {
    return web;
  }
  // Last resort (non-crypto) fallback
  let rand = '';
  for (let i = 0; i < bytes; i++) {
    rand += String.fromCharCode(Math.floor(Math.random() * 256));
  }
  const base64 = typeof btoa === 'function' ? btoa(rand) : rand;
  return String(base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function storeRsTokenMapping(
  rsAccessToken: string,
  linearTokens: LinearUserTokens,
  rsRefreshToken?: string,
): RsTokenRecord {
  if (rsRefreshToken) {
    const existing = rsRefreshToRecord.get(rsRefreshToken);
    if (existing) {
      rsAccessToRecord.delete(existing.rs_access_token);
      existing.rs_access_token = rsAccessToken;
      existing.linear = { ...linearTokens };
      rsAccessToRecord.set(rsAccessToken, existing);
      savePersisted();
      return existing;
    }
  }
  const record: RsTokenRecord = {
    rs_access_token: rsAccessToken,
    rs_refresh_token: rsRefreshToken ?? generateOpaqueToken(),
    created_at: Date.now(),
    linear: { ...linearTokens },
  };
  rsAccessToRecord.set(record.rs_access_token, record);
  rsRefreshToRecord.set(record.rs_refresh_token, record);
  savePersisted();
  return record;
}

export function getLinearTokensByRsToken(rsToken?: string): LinearUserTokens | null {
  if (!rsToken) {
    return null;
  }
  const rec = rsAccessToRecord.get(rsToken);
  return rec ? rec.linear : null;
}

export function getRecordByRsRefreshToken(
  rsRefreshToken?: string,
): RsTokenRecord | null {
  if (!rsRefreshToken) {
    return null;
  }
  return rsRefreshToRecord.get(rsRefreshToken) ?? null;
}

export function updateLinearTokensByRsRefreshToken(
  rsRefreshToken: string,
  newLinear: LinearUserTokens,
  maybeNewRsAccessToken?: string,
): RsTokenRecord | null {
  const rec = rsRefreshToRecord.get(rsRefreshToken);
  if (!rec) {
    return null;
  }
  if (maybeNewRsAccessToken) {
    rsAccessToRecord.delete(rec.rs_access_token);
    rec.rs_access_token = maybeNewRsAccessToken;
    rec.created_at = Date.now();
  }
  rec.linear = { ...newLinear };
  rsAccessToRecord.set(rec.rs_access_token, rec);
  rsRefreshToRecord.set(rsRefreshToken, rec);
  savePersisted();
  return rec;
}
