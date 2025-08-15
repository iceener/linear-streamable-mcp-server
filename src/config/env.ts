import { z } from 'zod';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const OptionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    MCP_TITLE: z.string().default('Linear MCP'),
    MCP_INSTRUCTIONS: z
      .string()
      .default(
        'Use these tools responsibly. Prefer minimal scopes and small page sizes.',
      ),
    MCP_VERSION: z.string().default('0.1.0'),
    MCP_PROTOCOL_VERSION: z.string().default('2025-06-18'),
    MCP_ACCEPT_HEADERS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    AUTH_ENABLED: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    // When true, only RS-minted Bearer tokens are accepted at the resource server.
    // Unknown/missing Authorization triggers a WWW-Authenticate challenge for OAuth.
    AUTH_REQUIRE_RS: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    // When RS-only mode is on, optionally allow falling back to treating Bearer as
    // a Linear personal access token. Defaults to false in RS-only mode.
    AUTH_ALLOW_LINEAR_BEARER: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),
    AUTH_RESOURCE_URI: OptionalUrl,
    AUTH_DISCOVERY_URL: OptionalUrl,

    OAUTH_CLIENT_ID: z.string().optional(),
    OAUTH_CLIENT_SECRET: z.string().optional(),
    OAUTH_SCOPES: z.string().default(''),
    OAUTH_AUTHORIZATION_URL: OptionalUrl,
    OAUTH_TOKEN_URL: OptionalUrl,
    OAUTH_REVOCATION_URL: OptionalUrl,
    OAUTH_REDIRECT_URI: z.string().default(''),
    OAUTH_REDIRECT_ALLOWLIST: z.string().default(''),
    // Dev helper: accept any client redirect URI (DISABLE IN PROD)
    OAUTH_REDIRECT_ALLOW_ALL: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),

    LINEAR_API_KEY: z.string().optional(),
    LINEAR_ACCESS_TOKEN: z.string().optional(),

    LINEAR_MCP_INCLUDE_JSON_IN_CONTENT: z
      .string()
      .default('false')
      .transform((v) => v.toLowerCase() === 'true'),

    // Optional: persist RS↔Linear token mappings to a file (Node runtime only)
    RS_TOKENS_FILE: z.string().optional(),

    RPS_LIMIT: z.coerce.number().default(10),
    CONCURRENCY_LIMIT: z.coerce.number().default(5),

    LOG_LEVEL: z.enum(['debug', 'info', 'warning', 'error']).default('info'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  })
  .passthrough();

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(): Config {
  // Safe for non-Node runtimes (e.g., Cloudflare Workers) where process/env may be undefined
  const sourceEnv =
    (globalThis as unknown as { process?: { env?: Record<string, string> } }).process
      ?.env ?? {};
  const parsed = EnvSchema.parse(sourceEnv);
  // Even when AUTH_ENABLED=true, the discovery/resource metadata can be inferred at runtime
  // (we serve /.well-known endpoints on PORT+1), so these URLs remain optional.
  return Object.freeze(parsed);
}

export const config = loadConfig();
