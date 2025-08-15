export type RequestContext = {
  sessionId?: string;
  authHeaders?: Record<string, string>;
  abortSignal?: AbortSignal;
};

// Use AsyncLocalStorage to reliably carry context across async boundaries
import { AsyncLocalStorage } from 'node:async_hooks';

const contextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return contextStorage.run(context, fn);
}

function getRequestContext(): RequestContext {
  return contextStorage.getStore() ?? {};
}

export function getCurrentSessionId(): string | undefined {
  return getRequestContext().sessionId;
}

export function getCurrentAuthHeaders(): Record<string, string> | undefined {
  return getRequestContext().authHeaders;
}

export function getAuthorizationBearerToken(): string | undefined {
  const headers = getCurrentAuthHeaders();
  if (!headers) {
    return undefined;
  }
  // headers are normalized to lower-case by our middleware; but be defensive
  const entries = Object.entries(headers);
  const authEntry = entries.find(([k]) => k.toLowerCase() === 'authorization');
  if (!authEntry) {
    return undefined;
  }
  const value = authEntry[1];
  if (!value) {
    return undefined;
  }
  // Expect formats like: "Bearer TOKEN" (case-insensitive)
  const match = /^\s*Bearer\s+(.+)$/i.exec(value);
  return match ? match[1] : undefined;
}

export function getCurrentAbortSignal(): AbortSignal | undefined {
  return getRequestContext().abortSignal;
}
