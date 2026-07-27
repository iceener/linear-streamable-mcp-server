import type { LinearClient } from '@linear/sdk';
import type * as z from 'zod/v4';

export type AuthStrategy = 'oauth' | 'bearer' | 'api_key' | 'custom' | 'none';

/** Request-local context passed to each Linear tool. */
export interface ToolContext {
  sessionId: string;
  signal?: AbortSignal;
  meta?: {
    progressToken?: string | number;
    requestId?: string;
  };
  authStrategy?: AuthStrategy;
  mcpClientId?: string;

  /** Validated Linear access token; never the inbound MCP bearer token. */
  linearProviderAccessToken?: string;
  /** Deployment-scoped local Linear token used only when MCP auth is disabled. */
  configuredLinearAccessToken?: string;

  concurrencyLimit?: number;
  includeJsonInContent?: boolean;

  /** Test seam for provider integration tests; absent in deployed runtimes. */
  linearClient?: LinearClient;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

type ToolHandler<TArgs> = {
  bivarianceHack(args: TArgs, context: ToolContext): Promise<ToolResult>;
}['bivarianceHack'];

/** Framework-independent Linear tool definition. */
export interface SharedToolDefinition<
  TInput extends z.ZodObject = z.ZodObject,
  TOutput extends z.ZodObject | undefined = z.ZodObject | undefined,
> {
  name: string;
  title?: string;
  description: string;
  inputSchema: TInput;
  outputSchema?: TOutput;
  handler: ToolHandler<z.output<TInput>>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export function defineTool<
  TInput extends z.ZodObject,
  TOutput extends z.ZodObject | undefined = undefined,
>(
  definition: SharedToolDefinition<TInput, TOutput>,
): SharedToolDefinition<TInput, TOutput> {
  return definition;
}
