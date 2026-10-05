import { type LinearClient, LinearError } from '@linear/sdk';
import type { ServerContext } from '@modelcontextprotocol/server';
import { providerToken } from '../../oauth/verifier';
import type { Logger } from '../../platform/logger';
import { type ToolErrorResult, toolError } from '../../platform/primitives';
import type { Deps } from '../../server';

/** How many Linear calls a batch tool runs at once. */
export const CONCURRENCY_LIMIT = 5;

/** What a Linear tool works with during one call. */
export interface LinearContext {
  /** A Linear client acting as the signed-in user. Fails the call when there is none. */
  client(): LinearClient;
  signal: AbortSignal;
  logger: Logger;
  /** `LINEAR_MCP_INCLUDE_JSON_IN_CONTENT`: also give the model the structured result as JSON. */
  includeJsonInContent: boolean;
}

/** No Linear token for this request, for example when authentication is off. */
class SignInRequired extends Error {}

/**
 * Run a tool body with the Linear client for this request. Failures that Linear reports (a
 * missing entity, invalid input, rate limits, an outage) and a missing sign-in become tool
 * errors the model can read, worded as before. Anything else is a bug and goes to the
 * platform's error policy.
 */
export async function withLinear<Result>(
  ctx: ServerContext,
  deps: Deps,
  run: (linear: LinearContext) => Promise<Result>,
): Promise<Result | ToolErrorResult> {
  const token = providerToken(ctx.http?.authInfo);
  try {
    return await run({
      client: () => {
        if (!token) throw new SignInRequired();
        return deps.linear(token);
      },
      signal: ctx.mcpReq.signal,
      logger: deps.logger,
      includeJsonInContent: deps.config.settings.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT,
    });
  } catch (error) {
    if (ctx.mcpReq.signal.aborted) throw error;
    if (error instanceof SignInRequired) {
      return toolError(
        'Tool error: Linear OAuth required: complete the OAuth flow to get an access token',
      );
    }
    if (error instanceof LinearError) return toolError(`Tool error: ${error.message}`);
    throw error;
  }
}

/**
 * A tool error that also carries structured details. `list_issues` (invalid filter) and
 * `list_cycles` (cycles disabled) answered this way before the migration, and still do. The
 * platform's `toolError` has text only, so its type is widened here on purpose.
 */
export function toolErrorWithDetails(
  text: string,
  details: Record<string, unknown>,
): ToolErrorResult {
  const result = { content: [{ type: 'text', text }], isError: true, structuredContent: details };
  return result as unknown as ToolErrorResult;
}
