/**
 * List Teams tool.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { ListTeamsOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { mapTeamNodeToListItem } from '../../../utils/mappers.js';
import { summarizeList, previewLinesFromItems } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const listTeamsTool = defineTool({
  name: toolsMetadata.list_teams.name,
  title: toolsMetadata.list_teams.title,
  description: toolsMetadata.list_teams.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const limit = args.limit ?? 50;

    const queryArgs: Record<string, unknown> = { first: limit };
    if (args.cursor) {
      queryArgs.after = args.cursor;
    }

    const connection = await client.teams(queryArgs as Parameters<typeof client.teams>[0]);
    const items = connection.nodes.map(mapTeamNodeToListItem);
    const pageInfo = connection.pageInfo;

    const hasMore = pageInfo.hasNextPage;
    const nextCursor = hasMore ? pageInfo.endCursor : undefined;

    // Build pagination
    const pagination = {
      hasMore,
      nextCursor,
      itemsReturned: items.length,
      limit,
    };

    // Build meta
    const meta = {
      nextSteps: [
        ...(hasMore ? [`Call again with cursor="${nextCursor}" for more.`] : []),
        'Use team id as teamId in list_issues or create_issues.',
        'Use workspace_metadata with teamIds to get workflow states and labels.',
      ],
      relatedTools: ['workspace_metadata', 'list_issues', 'create_issues'],
    };

    const structured = ListTeamsOutputSchema.parse({
      items,
      pagination,
      meta,
      // Legacy
      cursor: args.cursor,
      nextCursor,
      limit,
    });

    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (t) => {
        const key = t.key as string | undefined;
        const name = t.name as string;
        return `${key ? `${key} — ` : ''}${name} → ${t.id as string}`;
      },
    );

    const text = summarizeList({
      subject: 'Teams',
      count: items.length,
      limit,
      nextCursor,
      previewLines: preview,
      nextSteps: meta.nextSteps,
    });

    return {
      content: [{ type: 'text', text }],
      structuredContent: structured,
    };
  },
});







