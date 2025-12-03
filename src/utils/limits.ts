export type TokenBucket = {
  take: (n?: number) => boolean;
  refill: (tokens?: number) => void;
};

export const makeTokenBucket = (
  capacity: number,
  refillPerSec: number,
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
      if (next) next();
    }
  };
};

/** Delay helper */
export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Check if error is a rate limit error */
export const isRateLimitError = (error: unknown): boolean => {
  const message = (error as Error)?.message ?? '';
  return (
    message.includes('Too many subrequests') ||
    message.includes('rate limit') ||
    message.includes('Rate limit') ||
    message.includes('429')
  );
};

/** Retry with exponential backoff for rate-limited requests */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {},
): Promise<T> => {
  const { maxRetries = 3, baseDelayMs = 500, maxDelayMs = 5000 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === maxRetries) {
        throw error;
      }
      const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      await delay(delayMs);
    }
  }

  throw lastError;
};
