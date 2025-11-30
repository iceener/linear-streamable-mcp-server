import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/logger.js';

/**
 * Register resources with the MCP server.
 * 
 * Add Linear-specific resources here, e.g.:
 * - linear://teams/{id} - Team data
 * - linear://projects/{id} - Project metadata
 * - linear://me - Current user profile
 */
export function registerResources(server: McpServer): void {
  // TODO: Add Linear-specific resources here
  // Example:
  // server.registerResource('linear-team', 'linear://teams/{id}', { ... }, handler);

  logger.debug('resources', { message: 'No resources registered (placeholder)' });
}

/**
 * Emit resource update notification.
 */
export function emitResourceUpdated(server: McpServer, uri: string): void {
  try {
    (server as any).sendResourceUpdated?.({ uri });
  } catch {
    // Non-fatal
  }
  logger.debug('resources', { message: 'Resource updated notification sent', uri });
}

/**
 * Emit listChanged when resources are updated.
 */
export function emitResourcesListChanged(server: McpServer): void {
  server.sendResourceListChanged();
  logger.debug('resources', { message: 'Resources list changed notification sent' });
}
