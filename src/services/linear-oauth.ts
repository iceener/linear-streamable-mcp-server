import {
  type OAuthProvider,
  type ProviderTokenResponse,
  readStandardTokenResponse,
} from '../oauth/provider';

/** What the server may do in the user's Linear workspace. Users grant both at sign-in. */
export const LINEAR_SCOPES = ['read', 'write'] as const;

/**
 * Linear as the proxy's provider. The client ID and secret are the server's own Linear OAuth
 * application (secrets `PROVIDER_CLIENT_ID` and `PROVIDER_CLIENT_SECRET`), whose callback URL is
 * `<server origin>/oauth/callback`. The client authenticates with HTTP Basic, as before.
 */
export const linearOAuth: OAuthProvider = {
  name: 'Linear',
  authorizationUrl: 'https://linear.app/oauth/authorize',
  tokenUrl: 'https://api.linear.app/oauth/token',
  scopes: LINEAR_SCOPES,
  authorizationParams: {},
  readTokens: readLinearTokenResponse,
};

/**
 * Linear answers RFC 6749 token responses, except that `scope` may be a list or a
 * comma-separated string. Both are read as separate scopes. A response without
 * `refresh_token` gives a token that the proxy can't refresh; it is used until it expires.
 */
export function readLinearTokenResponse(body: unknown): ProviderTokenResponse {
  const tokens = readStandardTokenResponse(body);
  const scope = (body as { scope?: unknown }).scope;
  const granted = Array.isArray(scope) ? scope.map(String) : [String(scope ?? '')];
  return {
    ...tokens,
    scopes: [...new Set(granted.flatMap((entry) => entry.split(/[\s,]+/)).filter(Boolean))],
  };
}
