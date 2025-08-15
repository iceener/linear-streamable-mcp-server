import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config/env.ts';
import { toolsMetadata } from '../config/metadata.ts';
import { ListTeamsInputSchema, ListUsersInputSchema } from '../schemas/inputs.ts';
import { ListTeamsOutputSchema, ListUsersOutputSchema } from '../schemas/outputs.ts';
import { getLinearClient } from '../services/linear-client.ts';
import { mapTeamNodeToListItem, mapUserNodeToListItem } from '../utils/mappers.ts';
import { previewLinesFromItems, summarizeList } from '../utils/messages.ts';

export const listTeamsTool = {
  name: toolsMetadata.list_teams.name,
  title: toolsMetadata.list_teams.title,
  description: toolsMetadata.list_teams.description,
  inputSchema: ListTeamsInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = ListTeamsInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: parsed.error.message }],
      };
    }
    const first = parsed.data.limit ?? 20;
    const after =
      parsed.data.cursor && parsed.data.cursor.trim() !== ''
        ? parsed.data.cursor
        : undefined;
    const client = getLinearClient();
    let conn:
      | {
          nodes: Array<{ id: string; key?: string | null; name: string }>;
          pageInfo?: { endCursor?: string | null } | null;
        }
      | undefined;
    try {
      conn = await client.teams({ first, after });
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Failed to list teams: ${(error as Error).message}`,
          },
        ],
      };
    }
    const items = conn.nodes.map((t) => mapTeamNodeToListItem(t));
    const structured = ListTeamsOutputSchema.parse({
      items,
      cursor: parsed.data.cursor,
      nextCursor: conn.pageInfo?.endCursor ?? undefined,
      limit: first,
    });
    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (t) =>
        `${(t.key as string | undefined) ?? ''}${t.key ? ' — ' : ''}${
          (t.name as string) ?? t.id
        } (${t.id})`.trim(),
    );
    const message = summarizeList({
      subject: 'Teams',
      count: items.length,
      limit: first,
      nextCursor: structured.nextCursor,
      previewLines: preview,
      nextSteps: ['Use team ids to list issues or workflow states.'],
    });
    const parts: Array<{ type: 'text'; text: string }> = [
      { type: 'text', text: message },
    ];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    return { content: parts, structuredContent: structured };
  },
};

export const listUsersTool = {
  name: toolsMetadata.list_users.name,
  title: toolsMetadata.list_users.title,
  description: `${toolsMetadata.list_users.description}\nTip: Use this to find a valid 'assigneeId' when creating or updating issues. Your own id is available via 'workspace_metadata' (include: ['profile']).`,
  inputSchema: ListUsersInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = ListUsersInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: parsed.error.message }],
      };
    }
    const first = parsed.data.limit ?? 20;
    const after =
      parsed.data.cursor && parsed.data.cursor.trim() !== ''
        ? parsed.data.cursor
        : undefined;
    const client = getLinearClient();
    let conn:
      | {
          nodes: Array<{
            id: string;
            name?: string | null;
            email?: string | null;
            displayName?: string | null;
            avatarUrl?: string | null;
          }>;
          pageInfo?: { endCursor?: string | null } | null;
        }
      | undefined;
    try {
      conn = await client.users({ first, after });
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Failed to list users: ${(error as Error).message}`,
          },
        ],
      };
    }
    const items = conn.nodes.map((u) => mapUserNodeToListItem(u));
    const structured = ListUsersOutputSchema.parse({
      items,
      cursor: parsed.data.cursor,
      nextCursor: conn.pageInfo?.endCursor ?? undefined,
      limit: first,
    });
    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (u) =>
        `${
          (u.displayName as string | undefined) ??
          (u.name as string | undefined) ??
          u.id
        } (${u.id})`,
    );
    const message = summarizeList({
      subject: 'Users',
      count: items.length,
      limit: first,
      nextCursor: structured.nextCursor,
      previewLines: preview,
      nextSteps: ['Use user ids to filter issues or assign owners (update_issues).'],
    });
    const parts: Array<{ type: 'text'; text: string }> = [
      { type: 'text', text: message },
    ];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    return { content: parts, structuredContent: structured };
  },
};
