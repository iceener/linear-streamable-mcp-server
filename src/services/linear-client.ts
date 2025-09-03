import { LinearClient } from "@linear/sdk";
import { config } from "../config/env.ts";
import { getCurrentAuthHeaders } from "../core/context.ts";
import { getLinearTokensByRsToken } from "../core/tokens.ts";
import { createHttpClient, type HttpClientInput } from "./http-client.ts";
import { determineAuthType } from "../utils/limits.ts";

// Cache clients per token to avoid recreating on every call
const clientCache = new Map<string, LinearClient>();

/**
 * Estimates GraphQL query complexity based on the query structure
 * This is a simplified estimation - Linear's actual complexity calculation is more sophisticated
 */
function estimateGraphQLComplexity(
  query: string,
  variables?: Record<string, unknown>
): number {
  try {
    // Very basic complexity estimation based on query structure
    let complexity = 1; // Base complexity

    // Count object types (nodes, edges, etc.)
    const objectMatches = query.match(/\b\w+\s*{/g) || [];
    complexity += objectMatches.length * 1; // 1 point per object

    // Count property accesses
    const propertyMatches = query.match(/\w+\s*(?=[\n\r\s]*[{}])/g) || [];
    complexity += propertyMatches.length * 0.1; // 0.1 points per property

    // Handle pagination - multiply by first parameter
    const firstMatch = (variables?.first as number) || 50; // Default pagination
    if (firstMatch > 1) {
      // Find nested structures that would be multiplied by pagination
      const nestedObjects = (query.match(/edges\s*{[\s\S]*?node\s*{/g) || [])
        .length;
      const directNodes = (query.match(/nodes\s*{/g) || []).length;
      const multiplier = nestedObjects + directNodes;

      if (multiplier > 0) {
        complexity *= Math.min(firstMatch, 50); // Cap at reasonable limit
      }
    }

    // Cap at Linear's max complexity
    return Math.min(Math.max(Math.ceil(complexity), 1), 10000);
  } catch (error) {
    // Fallback to conservative estimate
    return 10;
  }
}

/**
 * Creates an HTTP client configured for Linear's rate limits
 */
function createLinearHttpClient() {
  const authHeaders = getCurrentAuthHeaders();
  const hasApiKey = Boolean(config.LINEAR_API_KEY);
  const authType = determineAuthType(authHeaders || {}, hasApiKey);

  return createHttpClient({
    baseHeaders: {
      "Content-Type": "application/json",
      "User-Agent": `linear-mcp/${config.MCP_VERSION}`,
    },
    timeout: 30000,
    retries: 5, // More retries for rate limiting
    retryDelay: 1000,
    useLinearRateLimiting: true,
    authType,
    estimateComplexity: (input: HttpClientInput, init?: RequestInit) => {
      // Try to extract GraphQL query from request body
      if (init?.body && typeof init.body === "string") {
        try {
          const body = JSON.parse(init.body);
          if (body.query) {
            return estimateGraphQLComplexity(body.query, body.variables);
          }
        } catch {
          // Ignore parsing errors
        }
      }
      return 1; // Conservative fallback
    },
  });
}

// Rate-limited client cache - separate from regular cache
const rateLimitedClientCache = new Map<string, LinearClient>();

export function getLinearClient(useRateLimiting = true): LinearClient {
  const authHeaders = getCurrentAuthHeaders();
  const authHeaderValue = authHeaders?.authorization;
  const xApiKeyValue =
    authHeaders?.["x-api-key"] ?? authHeaders?.["x-auth-token"];

  if (authHeaderValue || xApiKeyValue) {
    const value = (authHeaderValue ?? xApiKeyValue) as string;
    const bearerMatch = authHeaderValue?.match(/^\s*Bearer\s+(.+)$/i);
    const bearer = bearerMatch?.[1];
    if (typeof bearer === "string" && bearer) {
      // Try RS → Linear mapping first
      // Prefer KV-backed store when available (Workers); fallback to in-memory core mapping
      // Note: KV lookup is async; we cannot await in a sync function.
      // For now, first try in-memory map; if not found, assume bearer is Linear token.
      // Tools that need KV-backed OAuth should pass a Linear bearer after exchanging RS in /token.
      const mapped = getLinearTokensByRsToken(bearer);
      const linearAccess = mapped?.access_token ?? bearer;

      if (useRateLimiting) {
        const key = `ratelimited:hdr:bearer:${linearAccess}`;
        const existing = rateLimitedClientCache.get(key);
        if (existing) {
          return existing;
        }
        // Note: Linear SDK doesn't support custom HTTP clients directly
        // For now, we'll use the standard client but rely on the rate limiting
        // being handled at the tool level. Future improvement could involve
        // creating a proxy or wrapper around the HTTP transport.
        const client = new LinearClient({ accessToken: linearAccess });
        rateLimitedClientCache.set(key, client);
        return client;
      } else {
        const key = `hdr:bearer:${linearAccess}`;
        const existing = clientCache.get(key);
        if (existing) {
          return existing;
        }
        const client = new LinearClient({ accessToken: linearAccess });
        clientCache.set(key, client);
        return client;
      }
    }
    // Treat as API key when not Bearer (Linear supports API Key in Authorization or x-api-key)
    const apiKey = value.trim();
    if (!apiKey) {
      throw new Error("Invalid Authorization header");
    }

    if (useRateLimiting) {
      const key = `ratelimited:hdr:apiKey:${apiKey}`;
      const existing = rateLimitedClientCache.get(key);
      if (existing) {
        return existing;
      }
      const client = new LinearClient({ apiKey });
      rateLimitedClientCache.set(key, client);
      return client;
    } else {
      const key = `hdr:apiKey:${apiKey}`;
      const existing = clientCache.get(key);
      if (existing) {
        return existing;
      }
      const client = new LinearClient({ apiKey });
      clientCache.set(key, client);
      return client;
    }
  }

  const envKey = config.LINEAR_API_KEY;
  const envAccessToken = config.LINEAR_ACCESS_TOKEN;
  if (!envKey && !envAccessToken) {
    throw new Error(
      "Linear credentials missing: pass Authorization: Bearer <token> or set LINEAR_API_KEY/LINEAR_ACCESS_TOKEN"
    );
  }

  if (useRateLimiting) {
    const cacheKey = `ratelimited:env:${envKey ?? ""}:${envAccessToken ?? ""}`;
    const existing = rateLimitedClientCache.get(cacheKey);
    if (existing) {
      return existing;
    }
    const client = new LinearClient({
      apiKey: envKey,
      accessToken: envAccessToken,
    });
    rateLimitedClientCache.set(cacheKey, client);
    return client;
  } else {
    const cacheKey = `env:${envKey ?? ""}:${envAccessToken ?? ""}`;
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
}
