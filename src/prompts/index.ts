import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/logger.js';

/**
 * Register prompts with the MCP server.
 * 
 * Add Linear-specific prompts here, e.g.:
 * - Sprint summary prompt
 * - Issue triage prompt
 * - Weekly status report prompt
 */
export function registerPrompts(server: McpServer): void {
  // TODO: Add Linear-specific prompts here
  // Example:
  // server.registerPrompt('sprint_summary', { ... }, handler);

  logger.debug('prompts', { message: 'No prompts registered (placeholder)' });
}

/**
 * Emit listChanged when prompts are updated.
 */
export function emitPromptsListChanged(server: McpServer): void {
  server.sendPromptListChanged();
  logger.debug('prompts', { message: 'Prompts list changed notification sent' });
}
