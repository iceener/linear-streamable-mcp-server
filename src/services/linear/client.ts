/**
 * Linear SDK client factory.
 * Provides authenticated Linear API clients using the template's auth context.
 */

import { LinearClient } from '@linear/sdk';
import { config } from '../../config/env.js';
import { getTokenStore } from '../../shared/storage/singleton.js';
import type { ToolContext } from '../../shared/tools/types.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';

// Cache clients per token to avoid recreating on every call
const clientCache = new Map<string, LinearClient>();

/**
 * Get a Linear API client for the authenticated user.
 * Uses the provider token from the tool context or falls back to env vars.
 */
export async function getLinearClient(context?: ToolContext): Promise<LinearClient> {
  // 1. Try provider token from context (OAuth flow)
  const providerToken = context?.providerToken || context?.provider?.accessToken;
  
  if (providerToken) {
    const cacheKey = `provider:${providerToken.slice(0, 16)}`;
    const cached = clientCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    const client = new LinearClient({ accessToken: providerToken });
    clientCache.set(cacheKey, client);
    
    logger.debug('linear_client', {
      message: 'Created client from provider token',
      sessionId: context?.sessionId,
    });
    
    return client;
  }

  // 2. Try RS token mapping (if auth headers present)
  const authHeader = context?.authHeaders?.authorization;
  if (authHeader) {
    const bearerMatch = authHeader.match(/^\s*Bearer\s+(.+)$/i);
    const rsToken = bearerMatch?.[1];
    
    if (rsToken) {
      try {
        const store = getTokenStore();
        const record = await store.getByRsAccess(rsToken);
        
        if (record?.provider?.access_token) {
          const cacheKey = `rs:${rsToken.slice(0, 16)}`;
          const cached = clientCache.get(cacheKey);
          if (cached) {
            return cached;
          }
          
          const client = new LinearClient({ accessToken: record.provider.access_token });
          clientCache.set(cacheKey, client);
          
          logger.debug('linear_client', {
            message: 'Created client from RS token mapping',
            sessionId: context?.sessionId,
          });
          
          return client;
        }
      } catch (error) {
        logger.warning('linear_client', {
          message: 'Failed to look up RS token',
          error: (error as Error).message,
        });
      }
      
      // Assume bearer is a Linear token directly (API key mode)
      const cacheKey = `bearer:${rsToken.slice(0, 16)}`;
      const cached = clientCache.get(cacheKey);
      if (cached) {
        return cached;
      }
      
      const client = new LinearClient({ accessToken: rsToken });
      clientCache.set(cacheKey, client);
      
      logger.debug('linear_client', {
        message: 'Created client from direct bearer token',
        sessionId: context?.sessionId,
      });
      
      return client;
    }
    
  }

  // 3. Fall back to environment variable (local dev only)
  const envAccessToken = config.LINEAR_ACCESS_TOKEN;
  
  if (!envAccessToken) {
    throw new Error(
      'Linear OAuth required: complete the OAuth flow to get an access token',
    );
  }

  const cacheKey = `env:${envAccessToken.slice(0, 8)}`;
  const cached = clientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = new LinearClient({ accessToken: envAccessToken });
  clientCache.set(cacheKey, client);

  logger.debug('linear_client', {
    message: 'Created client from environment variable (local dev)',
  });

  return client;
}

/**
 * Synchronous version that throws if async lookup would be needed.
 * Use this only when you're certain context has provider token or env vars are set.
 */
export function getLinearClientSync(context?: ToolContext): LinearClient {
  // 1. Try provider token from context
  const providerToken = context?.providerToken || context?.provider?.accessToken;
  
  if (providerToken) {
    const cacheKey = `provider:${providerToken.slice(0, 16)}`;
    const cached = clientCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    const client = new LinearClient({ accessToken: providerToken });
    clientCache.set(cacheKey, client);
    return client;
  }

  // 2. Try direct bearer token (assume Linear token)
  const authHeader = context?.authHeaders?.authorization;
  if (authHeader) {
    const bearerMatch = authHeader.match(/^\s*Bearer\s+(.+)$/i);
    const token = bearerMatch?.[1];
    
    if (token) {
      const cacheKey = `bearer:${token.slice(0, 16)}`;
      const cached = clientCache.get(cacheKey);
      if (cached) {
        return cached;
      }
      
      const client = new LinearClient({ accessToken: token });
      clientCache.set(cacheKey, client);
      return client;
    }
  }

  // 3. Fall back to environment variable (local dev only)
  const envAccessToken = config.LINEAR_ACCESS_TOKEN;
  
  if (!envAccessToken) {
    throw new Error(
      'Linear OAuth required: complete the OAuth flow to get an access token',
    );
  }

  const cacheKey = `env:${envAccessToken.slice(0, 8)}`;
  const cached = clientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = new LinearClient({ accessToken: envAccessToken });
  clientCache.set(cacheKey, client);

  return client;
}

/**
 * Clear the client cache (useful for testing or token refresh).
 */
export function clearClientCache(): void {
  clientCache.clear();
}

