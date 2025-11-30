/**
 * List Teams tool.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { ListTeamsOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { mapTeamNodeToListItem } from '../../../utils/mappers.js';
import { summarizeList } from '../../../utils/messages.js';
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

    const structured = ListTeamsOutputSchema.parse({
      items,
      cursor: args.cursor,
      nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : undefined,
      limit,
    });

    const text = summarizeList({
      subject: 'Teams',
      count: items.length,
      limit,
      nextCursor: structured.nextCursor,
    });

    return {
      content: [{ type: 'text', text }],
      structuredContent: structured,
    };
  },
});


