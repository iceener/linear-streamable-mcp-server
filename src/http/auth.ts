import {
  type AuthInfo,
  type AuthMetadataOptions,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  type OAuthTokenVerifier,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { createOpaqueLinearTokenVerifier } from '../shared/auth/opaque-verifier.js';
import type { UnifiedConfig } from '../shared/config/env.js';
import type { TokenStore } from '../shared/storage/interface.js';

export interface AuthServices {
  gate: (request: Request) => Promise<AuthInfo | Response>;
  metadata: AuthMetadataOptions;
  protectedResourceMetadata: ReturnType<typeof buildOAuthProtectedResourceMetadata>;
}

export function defaultOAuthProxyBaseUrl(
  config: UnifiedConfig,
  sameOrigin: boolean,
): URL {
  if (config.OAUTH_PROXY_BASE_URL) {
    return new URL(config.OAUTH_PROXY_BASE_URL.href);
  }
  const result = new URL('/', config.MCP_PUBLIC_URL);
  if (!sameOrigin) result.port = String(config.PORT + 1);
  return result;
}

/** Build the OAuth Resource Server gate for the existing opaque token format. */
export function createAuthServices(
  config: UnifiedConfig,
  store: TokenStore,
  oauthProxyBaseUrl: URL,
  verifier?: OAuthTokenVerifier,
): AuthServices | undefined {
  if (!config.AUTH_ENABLED) return undefined;

  const base = oauthProxyBaseUrl.href.replace(/\/$/, '');
  const metadata: AuthMetadataOptions = {
    oauthMetadata: {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      revocation_endpoint: `${base}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: config.OAUTH_REQUIRED_SCOPES,
    },
    resourceServerUrl: config.MCP_PUBLIC_URL,
    scopesSupported: config.OAUTH_REQUIRED_SCOPES,
    resourceName: config.MCP_TITLE,
    dangerouslyAllowInsecureIssuerUrl: config.NODE_ENV !== 'production',
  };
  const protectedResourceMetadata = buildOAuthProtectedResourceMetadata(metadata);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(
    config.MCP_PUBLIC_URL,
  );

  return {
    metadata,
    protectedResourceMetadata,
    gate: requireBearerAuth({
      verifier: verifier ?? createOpaqueLinearTokenVerifier(config, store),
      requiredScopes: config.OAUTH_REQUIRED_SCOPES,
      resourceMetadataUrl,
    }),
  };
}
