export type TokenBucket = {
  take: (n?: number) => boolean;
  refill: (tokens?: number) => void;
};

export const makeTokenBucket = (
  capacity: number,
  refillPerSec: number
): TokenBucket => {
  let tokens = capacity;
  let last = Date.now();

  const refillLoop = () => {
    const now = Date.now();
    const delta = (now - last) / 1000;
    last = now;
    tokens = Math.min(capacity, tokens + delta * refillPerSec);
  };

  return {
    take(n = 1) {
      refillLoop();
      if (tokens >= n) {
        tokens -= n;
        return true;
      }
      return false;
    },
    refill(n = capacity) {
      tokens = Math.min(capacity, tokens + n);
    },
  };
};

export const makeConcurrencyGate = (max: number) => {
  let active = 0;
  const queue: (() => void)[] = [];

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) {
        next();
      }
    }
  };
};

// Linear-specific rate limiting types and utilities
export interface LinearRateLimits {
  requestsPerHour: number;
  complexityPerHour: number;
  maxComplexityPerQuery: number;
}

export interface LinearRateLimitState {
  requestTokens: number;
  complexityTokens: number;
  lastRefill: number;
  requestLimit: number;
  complexityLimit: number;
  requestReset?: number;
  complexityReset?: number;
}

export interface LinearRateLimitHeaders {
  "x-ratelimit-requests-limit"?: string;
  "x-ratelimit-requests-remaining"?: string;
  "x-ratelimit-requests-reset"?: string;
  "x-ratelimit-complexity-limit"?: string;
  "x-ratelimit-complexity-remaining"?: string;
  "x-ratelimit-complexity-reset"?: string;
  "x-complexity"?: string;
}

export interface LinearRateLimiter {
  canMakeRequest: (complexity?: number) => boolean;
  recordRequest: (complexity: number, headers?: LinearRateLimitHeaders) => void;
  waitForTokens: (complexity?: number) => Promise<void>;
  getBackoffDelay: (attempt: number, resetTime?: number) => number;
}

export function parseLinearRateLimitHeaders(
  headers: Headers
): LinearRateLimitHeaders {
  return {
    "x-ratelimit-requests-limit":
      headers.get("x-ratelimit-requests-limit") || undefined,
    "x-ratelimit-requests-remaining":
      headers.get("x-ratelimit-requests-remaining") || undefined,
    "x-ratelimit-requests-reset":
      headers.get("x-ratelimit-requests-reset") || undefined,
    "x-ratelimit-complexity-limit":
      headers.get("x-ratelimit-complexity-limit") || undefined,
    "x-ratelimit-complexity-remaining":
      headers.get("x-ratelimit-complexity-remaining") || undefined,
    "x-ratelimit-complexity-reset":
      headers.get("x-ratelimit-complexity-reset") || undefined,
    "x-complexity": headers.get("x-complexity") || undefined,
  };
}

export function getLinearRateLimits(
  authType: "api_key" | "oauth" | "unauthenticated" = "api_key"
): LinearRateLimits {
  switch (authType) {
    case "api_key":
      return {
        requestsPerHour: 1500,
        complexityPerHour: 250000,
        maxComplexityPerQuery: 10000,
      };
    case "oauth":
      return {
        requestsPerHour: 1200,
        complexityPerHour: 200000,
        maxComplexityPerQuery: 10000,
      };
    case "unauthenticated":
      return {
        requestsPerHour: 60,
        complexityPerHour: 10000,
        maxComplexityPerQuery: 10000,
      };
    default:
      return getLinearRateLimits("api_key");
  }
}

export function createLinearRateLimiter(
  authType: "api_key" | "oauth" | "unauthenticated" = "api_key"
): LinearRateLimiter {
  const limits = getLinearRateLimits(authType);
  const state: LinearRateLimitState = {
    requestTokens: limits.requestsPerHour,
    complexityTokens: limits.complexityPerHour,
    lastRefill: Date.now(),
    requestLimit: limits.requestsPerHour,
    complexityLimit: limits.complexityPerHour,
  };

  const refillTokens = () => {
    const now = Date.now();
    const hoursElapsed = (now - state.lastRefill) / (1000 * 60 * 60);

    if (hoursElapsed >= 1) {
      state.requestTokens = Math.min(
        state.requestLimit,
        state.requestTokens + limits.requestsPerHour * hoursElapsed
      );
      state.complexityTokens = Math.min(
        state.complexityLimit,
        state.complexityTokens + limits.complexityPerHour * hoursElapsed
      );
      state.lastRefill = now;
    }
  };

  const canMakeRequest = (complexity: number = 1): boolean => {
    refillTokens();
    return (
      state.requestTokens >= 1 &&
      state.complexityTokens >= complexity &&
      complexity <= limits.maxComplexityPerQuery
    );
  };

  const recordRequest = (
    complexity: number,
    headers?: LinearRateLimitHeaders
  ) => {
    state.requestTokens = Math.max(0, state.requestTokens - 1);
    state.complexityTokens = Math.max(0, state.complexityTokens - complexity);

    // Update limits and reset times from headers if provided
    if (headers) {
      if (headers["x-ratelimit-requests-limit"]) {
        state.requestLimit = parseInt(
          headers["x-ratelimit-requests-limit"],
          10
        );
      }
      if (headers["x-ratelimit-complexity-limit"]) {
        state.complexityLimit = parseInt(
          headers["x-ratelimit-complexity-limit"],
          10
        );
      }
      if (headers["x-ratelimit-requests-reset"]) {
        state.requestReset = parseInt(
          headers["x-ratelimit-requests-reset"],
          10
        );
      }
      if (headers["x-ratelimit-complexity-reset"]) {
        state.complexityReset = parseInt(
          headers["x-ratelimit-complexity-reset"],
          10
        );
      }
    }
  };

  const waitForTokens = async (complexity: number = 1): Promise<void> => {
    const maxWait = 60 * 1000; // Max 1 minute wait
    const startTime = Date.now();

    while (!canMakeRequest(complexity)) {
      if (Date.now() - startTime > maxWait) {
        throw new Error("Rate limit wait timeout exceeded");
      }

      // Calculate wait time based on token refill rates
      const requestWait =
        state.requestTokens < 1
          ? (1 - state.requestTokens) / (limits.requestsPerHour / 3600000)
          : 0;
      const complexityWait =
        state.complexityTokens < complexity
          ? (complexity - state.complexityTokens) /
            (limits.complexityPerHour / 3600000)
          : 0;

      const waitTime = Math.max(requestWait, complexityWait, 100); // Minimum 100ms
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(waitTime, 1000))
      ); // Max 1s per wait
    }
  };

  const getBackoffDelay = (attempt: number, resetTime?: number): number => {
    if (resetTime) {
      // If we have a reset time from headers, wait until then with some buffer
      const resetDelay = Math.max(0, resetTime - Date.now());
      return Math.min(resetDelay + 1000, 60000); // Add 1s buffer, max 60s
    }

    // Exponential backoff with jitter: baseDelay * 2^(attempt-1) + random(0, 1000)
    const baseDelay = 1000; // Start with 1 second
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  };

  return {
    canMakeRequest,
    recordRequest,
    waitForTokens,
    getBackoffDelay,
  };
}

// Helper to determine auth type from headers/tokens
export function determineAuthType(
  headers: Record<string, string>,
  hasApiKey: boolean
): "api_key" | "oauth" | "unauthenticated" {
  const authHeader =
    headers.authorization || headers["x-api-key"] || headers["x-auth-token"];

  if (
    hasApiKey ||
    (authHeader && !authHeader.toLowerCase().startsWith("bearer"))
  ) {
    return "api_key";
  }

  if (authHeader && authHeader.toLowerCase().startsWith("bearer")) {
    return "oauth";
  }

  return "unauthenticated";
}
