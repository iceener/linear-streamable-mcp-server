import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type ZodRawShape, type ZodTypeAny, z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { accountTool } from './account.tool.ts';
import { addCommentsTool, listCommentsTool } from './comments.tool.ts';
import { listCyclesTool } from './cycles.tool.ts';
import {
  createIssuesTool,
  listIssuesTool,
  listMyIssuesTool,
  updateIssuesTool,
} from './issues.tool.ts';
import {
  createProjectsTool,
  listProjectsTool,
  updateProjectsTool,
} from './projects.tool.ts';
import { listTeamsTool, listUsersTool } from './teams-users.tool.ts';

export function registerTools(server: McpServer): void {
  function toJsonSchema(input: unknown): Record<string, unknown> {
    try {
      if (
        input &&
        typeof input === 'object' &&
        ('$schema' in (input as Record<string, unknown>) ||
          'type' in (input as Record<string, unknown>))
      ) {
        return input as Record<string, unknown>;
      }
      const isZodType =
        typeof input === 'object' &&
        input !== null &&
        '_def' in (input as Record<string, unknown>);
      if (isZodType) {
        const json = zodToJsonSchema(input as ZodTypeAny, {
          $refStrategy: 'none',
        });
        return json as unknown as Record<string, unknown>;
      }
      if (input && typeof input === 'object') {
        const values = Object.values(input as Record<string, unknown>);
        const looksLikeShape =
          values.length > 0 &&
          values.every(
            (v) =>
              v && typeof v === 'object' && '_def' in (v as Record<string, unknown>),
          );
        if (looksLikeShape) {
          const obj = z.object(input as Record<string, ZodTypeAny>);
          const json = zodToJsonSchema(obj, { $refStrategy: 'none' });
          return json as unknown as Record<string, unknown>;
        }
      }
    } catch {}
    return (input ?? {}) as Record<string, unknown>;
  }
  const tools = [
    // Registered as workspace_metadata for clarity to LLMs
    {
      ...accountTool,
      name: 'workspace_metadata',
      title: 'Workspace Metadata & IDs',
    },

    listIssuesTool,
    listMyIssuesTool,
    createIssuesTool,
    updateIssuesTool,
    listProjectsTool,
    createProjectsTool,
    updateProjectsTool,
    listTeamsTool,
    listUsersTool,
    listCyclesTool,
    listCommentsTool,
    addCommentsTool,
  ];

  for (const t of tools) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: toJsonSchema(t.inputSchema) as unknown as ZodRawShape,
        annotations: { title: t.title },
      },
      (args: unknown) => t.handler(args as unknown),
    );
  }
}
