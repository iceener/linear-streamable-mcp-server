import { LinearClient } from '@linear/sdk';

/**
 * A Linear client acting with one user's Linear access token, which the OAuth proxy resolved
 * for this request; never with the client's own MCP token.
 */
export type LinearClientFactory = (accessToken: string) => LinearClient;

export interface LinearClientOptions {
  /** Linear's GraphQL endpoint. The smoke tests point it at a loopback stand-in. */
  apiUrl?: string;
  /** How many clients to keep. The least recently used is dropped first. */
  maxClients?: number;
}

/**
 * Clients are kept per access token, so what a client caches (the user list that assignee names
 * resolve against, in tools/shared/user-resolver.ts) is reused by the same user's next requests
 * and never shared with another user.
 */
export function createLinearClientFactory(options: LinearClientOptions = {}): LinearClientFactory {
  const maxClients = options.maxClients ?? 500;
  const clients = new Map<string, LinearClient>();

  return (accessToken) => {
    const cached = clients.get(accessToken);
    if (cached) {
      clients.delete(accessToken);
      clients.set(accessToken, cached);
      return cached;
    }
    // Tokens that start with `lin_` go as an API key, without the Bearer prefix, as before.
    const credential = accessToken.startsWith('lin_') ? { apiKey: accessToken } : { accessToken };
    const client = new LinearClient({
      ...credential,
      ...(options.apiUrl && { apiUrl: options.apiUrl }),
    });
    clients.set(accessToken, client);
    for (const key of clients.keys()) {
      if (clients.size <= maxClients) break;
      clients.delete(key);
    }
    return client;
  };
}
