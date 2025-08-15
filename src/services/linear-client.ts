import { LinearClient } from '@linear/sdk';
import { config } from '../config/env.ts';
import { getCurrentAuthHeaders } from '../core/context.ts';
import { getLinearTokensByRsToken } from '../core/tokens.ts';

// Cache clients per token to avoid recreating on every call
const clientCache = new Map<string, LinearClient>();

export function getLinearClient(): LinearClient {
  const authHeaders = getCurrentAuthHeaders();
  const authHeaderValue = authHeaders?.authorization;
  const xApiKeyValue = authHeaders?.['x-api-key'] ?? authHeaders?.['x-auth-token'];
  if (authHeaderValue || xApiKeyValue) {
    const value = (authHeaderValue ?? xApiKeyValue) as string;
    const bearerMatch = authHeaderValue?.match(/^\s*Bearer\s+(.+)$/i);
    const bearer = bearerMatch?.[1];
    if (typeof bearer === 'string' && bearer) {
      // Try RS → Linear mapping first
      // Prefer KV-backed store when available (Workers); fallback to in-memory core mapping
      // Note: KV lookup is async; we cannot await in a sync function.
      // For now, first try in-memory map; if not found, assume bearer is Linear token.
      // Tools that need KV-backed OAuth should pass a Linear bearer after exchanging RS in /token.
      const mapped = getLinearTokensByRsToken(bearer);
      const linearAccess = mapped?.access_token ?? bearer;
      const key = `hdr:bearer:${linearAccess}`;
      const existing = clientCache.get(key);
      if (existing) {
        return existing;
      }
      const client = new LinearClient({ accessToken: linearAccess });
      clientCache.set(key, client);
      return client;
    }
    // Treat as API key when not Bearer (Linear supports API Key in Authorization or x-api-key)
    const apiKey = value.trim();
    if (!apiKey) {
      throw new Error('Invalid Authorization header');
    }

    const key = `hdr:apiKey:${apiKey}`;
    const existing = clientCache.get(key);
    if (existing) {
      return existing;
    }
    const client = new LinearClient({ apiKey });
    clientCache.set(key, client);
    return client;
  }

  const envKey = config.LINEAR_API_KEY;
  const envAccessToken = config.LINEAR_ACCESS_TOKEN;
  if (!envKey && !envAccessToken) {
    throw new Error(
      'Linear credentials missing: pass Authorization: Bearer <token> or set LINEAR_API_KEY/LINEAR_ACCESS_TOKEN',
    );
  }

  const cacheKey = `env:${envKey ?? ''}:${envAccessToken ?? ''}`;
  const existing = clientCache.get(cacheKey);
  if (existing) {
    return existing;
  }
  const client = new LinearClient({
    apiKey: envKey,
    accessToken: envAccessToken,
  });
  clientCache.set(cacheKey, client);
  return client;
}
