import {
  createMcpHandler,
  type McpHttpHandler,
  type ServerEventBus,
} from '@modelcontextprotocol/server';
import type { UnifiedConfig } from '../shared/config/env.js';
import { sharedLogger as logger } from '../shared/utils/logger.js';
import { createMcpServer, type McpServerDependencies } from './mcp.js';

export interface RuntimeDependencies extends McpServerDependencies {
  eventBus?: ServerEventBus;
}

export type McpRuntime = McpHttpHandler;

/** Create one isolate-scoped HTTP handler with a per-request server factory. */
export function createMcpRuntime(
  config: UnifiedConfig,
  dependencies: RuntimeDependencies = {},
): McpRuntime {
  return createMcpHandler((context) => createMcpServer(config, context, dependencies), {
    legacy: config.MCP_LEGACY_MODE,
    responseMode: 'auto',
    ...(dependencies.eventBus ? { bus: dependencies.eventBus } : {}),
    onerror(error) {
      logger.error('mcp', {
        message: 'MCP request failed',
        error: error.message,
      });
    },
  });
}
