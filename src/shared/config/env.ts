// Deployment configuration shared by Bun and Cloudflare Workers.

export type RuntimeEnvironment = 'development' | 'production' | 'test';
export type LegacyMode = 'stateless' | 'reject';
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';
export type AuthStrategyType = 'oauth' | 'bearer' | 'api_key' | 'custom' | 'none';

export type UnifiedConfig = {
  // Server
  HOST: string;
  PORT: number;
  NODE_ENV: RuntimeEnvironment;
  LOG_LEVEL: LogLevel;

  // MCP
  MCP_NAME: string;
  MCP_TITLE: string;
  MCP_INSTRUCTIONS: string;
  MCP_VERSION: string;
  MCP_PUBLIC_URL: URL;
  MCP_ALLOWED_HOSTS: string[];
  MCP_ALLOWED_ORIGIN_HOSTNAMES: string[];
  MCP_LEGACY_MODE: LegacyMode;
  MCP_MAX_REQUEST_BYTES: number;

  // MCP caller authentication
  AUTH_STRATEGY: AuthStrategyType;
  AUTH_ENABLED: boolean;
  AUTH_DISCOVERY_URL?: string;
  OAUTH_REQUIRED_SCOPES: string[];
  OAUTH_PROXY_BASE_URL?: URL;

  // Static Linear provider authorization (local/non-OAuth modes)
  API_KEY?: string;
  API_KEY_HEADER: string;
  BEARER_TOKEN?: string;
  CUSTOM_HEADERS?: string;
  LINEAR_ACCESS_TOKEN?: string;

  // Active Linear OAuth proxy
  OAUTH_CLIENT_ID?: string;
  OAUTH_CLIENT_SECRET?: string;
  OAUTH_SCOPES: string;
  OAUTH_AUTHORIZATION_URL?: string;
  OAUTH_TOKEN_URL?: string;
  OAUTH_REVOCATION_URL?: string;
  OAUTH_REDIRECT_URI: string;
  OAUTH_REDIRECT_ALLOWLIST: string[];
  OAUTH_REDIRECT_ALLOW_ALL: boolean;
  OAUTH_EXTRA_AUTH_PARAMS?: string;
  PROVIDER_CLIENT_ID?: string;
  PROVIDER_CLIENT_SECRET?: string;
  PROVIDER_API_URL?: string;
  PROVIDER_ACCOUNTS_URL?: string;

  // Tool behavior and storage
  LINEAR_MCP_INCLUDE_JSON_IN_CONTENT: boolean;
  RS_TOKENS_FILE?: string;
  RS_TOKENS_ENC_KEY?: string;
  RPS_LIMIT: number;
  CONCURRENCY_LIMIT: number;
};

function stringValue(env: Record<string, unknown>, key: string, fallback = ''): string {
  const value = env[key];
  return value === undefined || value === null || value === ''
    ? fallback
    : String(value).trim();
}

function optionalString(env: Record<string, unknown>, key: string): string | undefined {
  const value = stringValue(env, key);
  return value || undefined;
}

function booleanValue(
  env: Record<string, unknown>,
  key: string,
  fallback = false,
): boolean {
  const value = stringValue(env, key, String(fallback)).toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  throw new Error(`${key} must be true or false`);
}

function integerValue(
  env: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(stringValue(env, key, String(fallback)));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function listValue(
  env: Record<string, unknown>,
  key: string,
  separator: RegExp,
  fallback: string[] = [],
): string[] {
  const value = stringValue(env, key);
  if (!value) return [...fallback];
  return [
    ...new Set(
      value
        .split(separator)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

function enumValue<T extends string>(
  env: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = stringValue(env, key, fallback) as T;
  if (!values.includes(value)) {
    throw new Error(`${key} must be one of: ${values.join(', ')}`);
  }
  return value;
}

function absoluteUrl(
  env: Record<string, unknown>,
  key: string,
  fallback?: string,
): URL | undefined {
  const value = stringValue(env, key, fallback);
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    throw new Error(`${key} must be an absolute URL`);
  }
}

function absoluteUrlString(
  env: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = optionalString(env, key);
  if (!value) return undefined;
  try {
    new URL(value);
    return value;
  } catch {
    throw new Error(`${key} must be an absolute URL`);
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function requireSecureUrl(
  url: URL,
  key: string,
  environment: RuntimeEnvironment,
): void {
  if (
    environment === 'production' &&
    url.protocol !== 'https:' &&
    !isLoopback(url.hostname)
  ) {
    throw new Error(`${key} must use HTTPS in production`);
  }
}

function parseAuthStrategy(env: Record<string, unknown>): AuthStrategyType {
  const explicit = optionalString(env, 'AUTH_STRATEGY')?.toLowerCase();
  if (explicit) {
    if (!['oauth', 'bearer', 'api_key', 'custom', 'none'].includes(explicit)) {
      throw new Error(
        'AUTH_STRATEGY must be one of: oauth, bearer, api_key, custom, none',
      );
    }
    return explicit as AuthStrategyType;
  }
  return booleanValue(env, 'AUTH_ENABLED') ? 'oauth' : 'none';
}

/** Parse deployment-scoped configuration for Bun or Cloudflare Workers. */
export function parseConfig(env: Record<string, unknown>): UnifiedConfig {
  const port = integerValue(env, 'PORT', 3000, 1, 65_535);
  const environment = enumValue(
    env,
    'NODE_ENV',
    ['development', 'production', 'test'] as const,
    'development',
  );
  const publicUrl = absoluteUrl(
    env,
    'MCP_PUBLIC_URL',
    `http://localhost:${port}/mcp`,
  ) as URL;
  if (publicUrl.search || publicUrl.hash) {
    throw new Error('MCP_PUBLIC_URL must not include a query string or fragment');
  }
  requireSecureUrl(publicUrl, 'MCP_PUBLIC_URL', environment);

  const defaultHosts = [publicUrl.hostname];
  if (environment !== 'production') {
    defaultHosts.push('localhost', '127.0.0.1', '[::1]');
  }
  const allowedHosts = listValue(env, 'MCP_ALLOWED_HOSTS', /[ ,]+/, defaultHosts);
  const allowedOrigins = listValue(
    env,
    'MCP_ALLOWED_ORIGIN_HOSTNAMES',
    /[ ,]+/,
    defaultHosts,
  );
  if (allowedHosts.length === 0 || allowedOrigins.length === 0) {
    throw new Error('MCP Host and Origin allowlists must not be empty');
  }

  const authStrategy = parseAuthStrategy(env);
  const authEnabled = booleanValue(env, 'AUTH_ENABLED') || authStrategy === 'oauth';
  if (authEnabled && authStrategy !== 'oauth') {
    throw new Error(
      'MCP caller authentication uses the OAuth RS-token flow; static Linear provider credentials cannot authenticate MCP callers',
    );
  }

  const providerScopes = stringValue(env, 'OAUTH_SCOPES', 'read write');
  const requiredScopes = listValue(
    env,
    'OAUTH_REQUIRED_SCOPES',
    /[ ,]+/,
    providerScopes.split(/\s+/).filter(Boolean),
  );
  const proxyBaseUrl = absoluteUrl(env, 'OAUTH_PROXY_BASE_URL');
  if (proxyBaseUrl) {
    requireSecureUrl(proxyBaseUrl, 'OAUTH_PROXY_BASE_URL', environment);
  }

  const providerAccountsUrl = absoluteUrlString(env, 'PROVIDER_ACCOUNTS_URL');
  const authorizationUrl = absoluteUrlString(env, 'OAUTH_AUTHORIZATION_URL');
  const tokenUrl = absoluteUrlString(env, 'OAUTH_TOKEN_URL');
  const revocationUrl = absoluteUrlString(env, 'OAUTH_REVOCATION_URL');
  for (const [key, value] of [
    ['PROVIDER_ACCOUNTS_URL', providerAccountsUrl],
    ['OAUTH_AUTHORIZATION_URL', authorizationUrl],
    ['OAUTH_TOKEN_URL', tokenUrl],
    ['OAUTH_REVOCATION_URL', revocationUrl],
  ] as const) {
    if (value) requireSecureUrl(new URL(value), key, environment);
  }

  return {
    HOST: stringValue(env, 'HOST', '127.0.0.1'),
    PORT: port,
    NODE_ENV: environment,
    LOG_LEVEL: enumValue(
      env,
      'LOG_LEVEL',
      ['debug', 'info', 'warning', 'error'] as const,
      'info',
    ),

    MCP_NAME: stringValue(env, 'MCP_NAME', 'linear-mcp'),
    MCP_TITLE: stringValue(env, 'MCP_TITLE', 'Linear'),
    MCP_INSTRUCTIONS: stringValue(env, 'MCP_INSTRUCTIONS'),
    MCP_VERSION: stringValue(env, 'MCP_VERSION', '1.0.0'),
    MCP_PUBLIC_URL: publicUrl,
    MCP_ALLOWED_HOSTS: allowedHosts,
    MCP_ALLOWED_ORIGIN_HOSTNAMES: allowedOrigins,
    MCP_LEGACY_MODE: enumValue(
      env,
      'MCP_LEGACY_MODE',
      ['stateless', 'reject'] as const,
      'stateless',
    ),
    MCP_MAX_REQUEST_BYTES: integerValue(
      env,
      'MCP_MAX_REQUEST_BYTES',
      1_048_576,
      1_024,
      10_485_760,
    ),

    AUTH_STRATEGY: authStrategy,
    AUTH_ENABLED: authEnabled,
    AUTH_DISCOVERY_URL: optionalString(env, 'AUTH_DISCOVERY_URL'),
    OAUTH_REQUIRED_SCOPES: requiredScopes,
    OAUTH_PROXY_BASE_URL: proxyBaseUrl,

    API_KEY: optionalString(env, 'API_KEY'),
    API_KEY_HEADER: stringValue(env, 'API_KEY_HEADER', 'x-api-key'),
    BEARER_TOKEN: optionalString(env, 'BEARER_TOKEN'),
    CUSTOM_HEADERS: optionalString(env, 'CUSTOM_HEADERS'),
    LINEAR_ACCESS_TOKEN: optionalString(env, 'LINEAR_ACCESS_TOKEN'),

    OAUTH_CLIENT_ID: optionalString(env, 'OAUTH_CLIENT_ID'),
    OAUTH_CLIENT_SECRET: optionalString(env, 'OAUTH_CLIENT_SECRET'),
    OAUTH_SCOPES: providerScopes,
    OAUTH_AUTHORIZATION_URL: authorizationUrl,
    OAUTH_TOKEN_URL: tokenUrl,
    OAUTH_REVOCATION_URL: revocationUrl,
    OAUTH_REDIRECT_URI: stringValue(
      env,
      'OAUTH_REDIRECT_URI',
      'http://127.0.0.1:3001/oauth/callback',
    ),
    OAUTH_REDIRECT_ALLOWLIST: listValue(env, 'OAUTH_REDIRECT_ALLOWLIST', /,+/),
    OAUTH_REDIRECT_ALLOW_ALL: booleanValue(env, 'OAUTH_REDIRECT_ALLOW_ALL'),
    OAUTH_EXTRA_AUTH_PARAMS: optionalString(env, 'OAUTH_EXTRA_AUTH_PARAMS'),
    PROVIDER_CLIENT_ID: optionalString(env, 'PROVIDER_CLIENT_ID'),
    PROVIDER_CLIENT_SECRET: optionalString(env, 'PROVIDER_CLIENT_SECRET'),
    PROVIDER_API_URL: optionalString(env, 'PROVIDER_API_URL'),
    PROVIDER_ACCOUNTS_URL: providerAccountsUrl,

    LINEAR_MCP_INCLUDE_JSON_IN_CONTENT: booleanValue(
      env,
      'LINEAR_MCP_INCLUDE_JSON_IN_CONTENT',
    ),
    RS_TOKENS_FILE: optionalString(env, 'RS_TOKENS_FILE'),
    RS_TOKENS_ENC_KEY: optionalString(env, 'RS_TOKENS_ENC_KEY'),
    RPS_LIMIT: integerValue(env, 'RPS_LIMIT', 10, 1, 10_000),
    CONCURRENCY_LIMIT: integerValue(env, 'CONCURRENCY_LIMIT', 5, 1, 1_000),
  };
}

export function resolveConfig(): UnifiedConfig {
  return parseConfig(process.env as Record<string, unknown>);
}
