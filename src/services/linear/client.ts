import { LinearClient } from '@linear/sdk';
import { config } from '../../config/env.js';
import type { ToolContext } from '../../shared/tools/types.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';

const clientCache = new Map<string, LinearClient>();

function createClient(token: string): LinearClient {
  return token.startsWith('lin_')
    ? new LinearClient({ apiKey: token })
    : new LinearClient({ accessToken: token });
}

function configuredToken(context?: ToolContext): string | undefined {
  return (
    context?.linearProviderAccessToken ??
    context?.configuredLinearAccessToken ??
    config.LINEAR_ACCESS_TOKEN
  );
}

/**
 * Return a Linear client using only provider authorization supplied by the
 * request adapter or deployment configuration. The inbound MCP bearer token
 * is intentionally unavailable at this boundary.
 */
export async function getLinearClient(context?: ToolContext): Promise<LinearClient> {
  if (context?.linearClient) return context.linearClient;

  const token = configuredToken(context);
  if (!token) {
    throw new Error(
      'Linear OAuth required: complete the OAuth flow to get an access token',
    );
  }

  const cached = clientCache.get(token);
  if (cached) return cached;

  const client = createClient(token);
  clientCache.set(token, client);
  logger.debug('linear_client', {
    message: context?.linearProviderAccessToken
      ? 'Created client from validated Linear provider token'
      : 'Created client from deployment provider token',
    sessionId: context?.sessionId,
  });
  return client;
}

export function getLinearClientSync(context?: ToolContext): LinearClient {
  if (context?.linearClient) return context.linearClient;

  const token = configuredToken(context);
  if (!token) {
    throw new Error(
      'Linear OAuth required: complete the OAuth flow to get an access token',
    );
  }

  const cached = clientCache.get(token);
  if (cached) return cached;

  const client = createClient(token);
  clientCache.set(token, client);
  return client;
}

export function clearClientCache(): void {
  clientCache.clear();
}
