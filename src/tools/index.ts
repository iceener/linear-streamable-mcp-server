import type { LinearClient } from '@linear/sdk';
import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import { LINEAR_PROVIDER_ACCESS_TOKEN_EXTRA_KEY } from '../shared/auth/opaque-verifier.js';
import type { UnifiedConfig } from '../shared/config/env.js';
import {
  executeSharedTool,
  sharedTools,
  type ToolContext,
} from '../shared/tools/registry.js';

export interface ToolRegistrationOptions {
  linearClientFactory?: (
    linearProviderAccessToken: string | undefined,
    mcpClientId: string | undefined,
  ) => LinearClient;
  onToolContext?: (context: ToolContext) => void;
}

function staticLinearAccessToken(config: UnifiedConfig): string | undefined {
  if (config.AUTH_ENABLED) return undefined;
  if (config.LINEAR_ACCESS_TOKEN) return config.LINEAR_ACCESS_TOKEN;
  if (config.AUTH_STRATEGY === 'bearer') return config.BEARER_TOKEN;
  if (config.AUTH_STRATEGY === 'api_key') return config.API_KEY;
  return undefined;
}

function providerAccessToken(context: ServerContext): string | undefined {
  const value = context.http?.authInfo?.extra?.[LINEAR_PROVIDER_ACCESS_TOKEN_EXTRA_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toolContext(
  config: UnifiedConfig,
  context: ServerContext,
  options: ToolRegistrationOptions,
): ToolContext {
  const linearProviderAccessToken = providerAccessToken(context);
  const mcpClientId = context.http?.authInfo?.clientId;
  const result: ToolContext = {
    sessionId: context.sessionId ?? String(context.mcpReq.id),
    signal: context.mcpReq.signal,
    meta: {
      requestId: String(context.mcpReq.id),
      progressToken: context.mcpReq._meta?.progressToken,
    },
    authStrategy: config.AUTH_STRATEGY,
    mcpClientId,
    linearProviderAccessToken,
    configuredLinearAccessToken: staticLinearAccessToken(config),
    concurrencyLimit: config.CONCURRENCY_LIMIT,
    includeJsonInContent: config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT,
    ...(options.linearClientFactory
      ? {
          linearClient: options.linearClientFactory(
            linearProviderAccessToken,
            mcpClientId,
          ),
        }
      : {}),
  };
  options.onToolContext?.(result);
  return result;
}

/** Register all 15 Linear tools in their pre-migration order. */
export function registerTools(
  server: McpServer,
  config: UnifiedConfig,
  options: ToolRegistrationOptions = {},
): void {
  for (const tool of sharedTools) {
    const inputSchema: z.ZodObject = tool.inputSchema;
    const outputSchema: z.ZodObject | undefined = tool.outputSchema;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema,
        outputSchema,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>, context: ServerContext) =>
        executeSharedTool(tool.name, args, toolContext(config, context, options)),
    );
  }
}
