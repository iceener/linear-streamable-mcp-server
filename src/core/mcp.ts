import type { LinearClient } from '@linear/sdk';
import {
  type McpRequestContext,
  McpServer,
  type ServerCapabilities,
} from '@modelcontextprotocol/server';
import { serverMetadata } from '../config/metadata.js';
import { registerPrompts } from '../prompts/index.js';
import { registerResources } from '../resources/index.js';
import type { UnifiedConfig } from '../shared/config/env.js';
import type { ToolContext } from '../shared/tools/types.js';
import { registerTools } from '../tools/index.js';

export interface McpServerDependencies {
  linearClientFactory?: (
    linearProviderAccessToken: string | undefined,
    mcpClientId: string | undefined,
  ) => LinearClient;
  onToolContext?: (context: ToolContext) => void;
}

function capabilitiesFor(context: McpRequestContext): ServerCapabilities {
  const subscriptions = context.era === 'modern';
  return {
    tools: { listChanged: subscriptions },
    prompts: { listChanged: subscriptions },
    resources: {
      listChanged: subscriptions,
      subscribe: subscriptions,
    },
  };
}

/** Build a fresh Linear MCP server for one HTTP request. */
export function createMcpServer(
  config: UnifiedConfig,
  context: McpRequestContext,
  dependencies: McpServerDependencies = {},
): McpServer {
  const server = new McpServer(
    {
      name: config.MCP_NAME,
      title: config.MCP_TITLE,
      version: config.MCP_VERSION,
      description: 'Linear issue and project management for MCP clients.',
    },
    {
      instructions: config.MCP_INSTRUCTIONS || serverMetadata.instructions,
      capabilities: capabilitiesFor(context),
      cacheHints: {
        'server/discover': { ttlMs: 60_000, cacheScope: 'private' },
        'tools/list': { ttlMs: 60_000, cacheScope: 'private' },
        'prompts/list': { ttlMs: 60_000, cacheScope: 'private' },
        'resources/list': { ttlMs: 60_000, cacheScope: 'private' },
        'resources/templates/list': {
          ttlMs: 60_000,
          cacheScope: 'private',
        },
        'resources/read': { ttlMs: 0, cacheScope: 'private' },
      },
    },
  );

  registerTools(server, config, dependencies);
  registerPrompts(server);
  registerResources(server);
  return server;
}
