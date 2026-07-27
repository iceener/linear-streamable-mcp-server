import {
  addCommentsTool,
  createIssuesTool,
  createProjectsTool,
  getIssuesTool,
  listCommentsTool,
  listCyclesTool,
  listIssuesTool,
  listProjectsTool,
  listTeamsTool,
  listUsersTool,
  showIssuesUITool,
  updateCommentsTool,
  updateIssuesTool,
  updateProjectsTool,
  workspaceMetadataTool,
} from './linear/index.js';
import type { SharedToolDefinition, ToolContext, ToolResult } from './types.js';

export type { SharedToolDefinition, ToolContext, ToolResult } from './types.js';
export { defineTool } from './types.js';

/** Linear tools in the stable discovery order captured before migration. */
export const sharedTools = [
  workspaceMetadataTool,
  listIssuesTool,
  getIssuesTool,
  createIssuesTool,
  updateIssuesTool,
  listTeamsTool,
  listUsersTool,
  listCommentsTool,
  addCommentsTool,
  updateCommentsTool,
  listCyclesTool,
  listProjectsTool,
  createProjectsTool,
  updateProjectsTool,
  showIssuesUITool,
] as const satisfies readonly SharedToolDefinition[];

export type RegisteredTool = (typeof sharedTools)[number];

export function getSharedTool(name: string): RegisteredTool | undefined {
  return sharedTools.find((tool) => tool.name === name);
}

export function getSharedToolNames(): string[] {
  return sharedTools.map((tool) => tool.name);
}

async function executeRegisteredTool<T extends SharedToolDefinition>(
  tool: T,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    return {
      content: [{ type: 'text', text: `Invalid input: ${details}` }],
      isError: true,
    };
  }

  const result = await tool.handler(parsed.data, context);
  if (tool.outputSchema && !result.isError) {
    if (!result.structuredContent) {
      return {
        content: [
          {
            type: 'text',
            text: 'Tool with outputSchema must return structuredContent',
          },
        ],
        isError: true,
      };
    }
    const output = tool.outputSchema.safeParse(result.structuredContent);
    if (!output.success) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool returned invalid structured output: ${output.error.message}`,
          },
        ],
        isError: true,
      };
    }
    result.structuredContent = output.data;
  }
  return result;
}

export async function executeSharedTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = getSharedTool(name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    if (context.signal?.aborted) {
      return {
        content: [{ type: 'text', text: 'Operation was cancelled' }],
        isError: true,
      };
    }
    return await executeRegisteredTool(tool, args, context);
  } catch (error) {
    const message = context.signal?.aborted
      ? 'Operation was cancelled'
      : `Tool error: ${error instanceof Error ? error.message : String(error)}`;
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}
