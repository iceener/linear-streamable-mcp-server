import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import type { UnifiedConfig } from '../config/env.js';
import { buildProviderRefreshConfig, ensureFreshToken } from '../oauth/refresh.js';
import type { TokenStore } from '../storage/interface.js';

export const LINEAR_PROVIDER_ACCESS_TOKEN_EXTRA_KEY =
  'linearProviderAccessToken' as const;

async function principalId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `linear-rs:${hex.slice(0, 24)}`;
}

function invalidToken(): OAuthError {
  return new OAuthError(
    OAuthErrorCode.InvalidToken,
    'The MCP access token is invalid or expired',
  );
}

/**
 * Validate an opaque MCP Resource Server token against the existing
 * RS-token-to-Linear-token mapping. Only the Linear access token is copied to
 * AuthInfo.extra; provider refresh tokens never cross the storage boundary.
 */
export function createOpaqueLinearTokenVerifier(
  config: UnifiedConfig,
  store: TokenStore,
): OAuthTokenVerifier {
  const providerConfig = buildProviderRefreshConfig(config);

  return {
    async verifyAccessToken(mcpAccessToken): Promise<AuthInfo> {
      const refreshed = await ensureFreshToken(mcpAccessToken, store, providerConfig);
      const record = await store.getByRsAccess(mcpAccessToken);
      const linearAccessToken = refreshed.accessToken || record?.provider.access_token;
      if (!record || !linearAccessToken) throw invalidToken();

      const expiresAtMs = record.provider.expires_at;
      if (expiresAtMs !== undefined && expiresAtMs <= Date.now()) {
        throw invalidToken();
      }

      return {
        token: mcpAccessToken,
        clientId: await principalId(mcpAccessToken),
        scopes: record.provider.scopes ?? [],
        expiresAt: expiresAtMs
          ? Math.floor(expiresAtMs / 1_000)
          : Math.floor(Date.now() / 1_000) + 3_600,
        resource: new URL(config.MCP_PUBLIC_URL.href),
        extra: {
          [LINEAR_PROVIDER_ACCESS_TOKEN_EXTRA_KEY]: linearAccessToken,
        },
      };
    },
  };
}
