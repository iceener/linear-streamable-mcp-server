import { config } from "../config/env.ts";
import {
  makeConcurrencyGate,
  makeTokenBucket,
  createLinearRateLimiter,
  parseLinearRateLimitHeaders,
  determineAuthType,
  type LinearRateLimiter,
  type LinearRateLimitHeaders,
} from "../utils/limits.ts";
import { logger } from "../utils/logger.ts";

export type HttpClientInput = string | URL | Request;
export type HttpClient = (
  input: HttpClientInput,
  init?: RequestInit
) => Promise<Response>;

export interface HttpClientOptions {
  baseHeaders?: Record<string, string>;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  rateLimit?: { rps: number; burst: number };
  concurrency?: number;
  // Linear-specific options
  useLinearRateLimiting?: boolean;
  authType?: "api_key" | "oauth" | "unauthenticated";
  estimateComplexity?: (input: HttpClientInput, init?: RequestInit) => number;
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const {
    baseHeaders = {},
    timeout = 30000,
    retries = 3,
    retryDelay = 1000,
    rateLimit = { rps: config.RPS_LIMIT, burst: config.RPS_LIMIT * 2 },
    concurrency = config.CONCURRENCY_LIMIT,
    useLinearRateLimiting = false,
    authType = "api_key",
    estimateComplexity = () => 1, // Default complexity estimate
  } = options;

  // Use Linear-specific rate limiter if requested
  const linearRateLimiter = useLinearRateLimiting
    ? createLinearRateLimiter(authType)
    : null;
  const simpleRateLimiter = makeTokenBucket(rateLimit.burst, rateLimit.rps);
  const gate = makeConcurrencyGate(concurrency);

  return async (
    input: HttpClientInput,
    init?: RequestInit
  ): Promise<Response> => {
    return gate(async () => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : (input as Request).url;
      const method = init?.method || "GET";

      await logger.debug("http_client", {
        message: "HTTP request start",
        url,
        method,
      });

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          // Estimate complexity for Linear rate limiting
          const complexity = estimateComplexity(input, init);

          // Check rate limits
          if (linearRateLimiter) {
            if (!linearRateLimiter.canMakeRequest(complexity)) {
              await logger.warning("http_client", {
                message: "Linear rate limit exceeded, waiting",
                complexity,
                attempt,
              });
              await linearRateLimiter.waitForTokens(complexity);
            }
          } else if (!simpleRateLimiter.take()) {
            await logger.warning("http_client", {
              message: "Rate limit exceeded",
            });
            throw new Error("Rate limit exceeded");
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          const response = await fetch(url, {
            ...init,
            headers: { ...baseHeaders, ...init?.headers },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // Parse rate limit headers
          const rateLimitHeaders = parseLinearRateLimitHeaders(
            response.headers
          );

          // Record the request with Linear rate limiter
          if (linearRateLimiter) {
            const actualComplexity = parseInt(
              rateLimitHeaders["x-complexity"] || "1",
              10
            );
            linearRateLimiter.recordRequest(actualComplexity, rateLimitHeaders);
          }

          // Check for RATELIMITED error in GraphQL response
          if (
            response.ok &&
            response.headers.get("content-type")?.includes("application/json")
          ) {
            try {
              const responseClone = response.clone();
              const body = (await responseClone.json()) as {
                errors?: Array<{
                  extensions?: { code?: string };
                  message?: string;
                }>;
              };

              // Check for Linear's RATELIMITED error
              if (
                body.errors?.some(
                  (error: any) => error.extensions?.code === "RATELIMITED"
                )
              ) {
                const rateLimitedError = body.errors.find(
                  (error: any) => error.extensions?.code === "RATELIMITED"
                );

                await logger.warning("http_client", {
                  message: "Linear RATELIMITED error received",
                  error: rateLimitedError?.message,
                  attempt,
                });

                // Calculate backoff delay based on reset times or exponential backoff
                const resetTime = linearRateLimiter
                  ? Math.min(
                      parseInt(
                        rateLimitHeaders["x-ratelimit-requests-reset"] || "0",
                        10
                      ),
                      parseInt(
                        rateLimitHeaders["x-ratelimit-complexity-reset"] || "0",
                        10
                      )
                    ) || undefined
                  : undefined;

                const delay = linearRateLimiter
                  ? linearRateLimiter.getBackoffDelay(attempt, resetTime)
                  : retryDelay * 2 ** (attempt - 1) + Math.random() * 1000;

                if (attempt < retries) {
                  await logger.info("http_client", {
                    message: "Retrying after RATELIMITED error",
                    delay: Math.round(delay),
                    attempt,
                  });
                  await new Promise((r) => setTimeout(r, delay));
                  continue;
                }
              }
            } catch (parseError) {
              // Ignore JSON parsing errors for rate limit detection
              await logger.debug("http_client", {
                message: "Could not parse response for rate limit detection",
                error: (parseError as Error).message,
              });
            }
          }

          if (response.ok || attempt === retries) {
            await logger.info("http_client", {
              message: "HTTP request completed",
              url,
              method,
              status: response.status,
              attempt,
              complexity: rateLimitHeaders["x-complexity"],
              requestsRemaining:
                rateLimitHeaders["x-ratelimit-requests-remaining"],
              complexityRemaining:
                rateLimitHeaders["x-ratelimit-complexity-remaining"],
            });
            return response;
          }

          await logger.warning("http_client", {
            message: "HTTP request failed, retrying",
            url,
            method,
            status: response.status,
            attempt,
          });

          const delay = linearRateLimiter
            ? linearRateLimiter.getBackoffDelay(attempt)
            : retryDelay * 2 ** (attempt - 1) + Math.random() * 1000;
          await new Promise((r) => setTimeout(r, delay));
        } catch (error) {
          if (attempt === retries) {
            await logger.error("http_client", {
              message: "HTTP request failed after retries",
              url,
              method,
              error: (error as Error).message,
              attempts: retries,
            });
            throw error;
          }
          await logger.warning("http_client", {
            message: "HTTP error, retrying",
            url,
            method,
            error: (error as Error).message,
            attempt,
          });
          const delay = linearRateLimiter
            ? linearRateLimiter.getBackoffDelay(attempt)
            : retryDelay * 2 ** (attempt - 1) + Math.random() * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      throw new Error("Unexpected end of retry loop");
    });
  };
}
