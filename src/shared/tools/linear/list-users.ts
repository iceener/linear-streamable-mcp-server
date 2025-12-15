/**
 * List Users tool.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { ListUsersOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { mapUserNodeToListItem } from '../../../utils/mappers.js';
import { summarizeList, previewLinesFromItems } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const listUsersTool = defineTool({
  name: toolsMetadata.list_users.name,
  title: toolsMetadata.list_users.title,
  description: toolsMetadata.list_users.description,
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

    const connection = await client.users(queryArgs as Parameters<typeof client.users>[0]);
    const items = connection.nodes.map(mapUserNodeToListItem);
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
        'Use user id as assigneeId in create_issues or update_issues.',
        'Use assigneeName or assigneeEmail in create/update_issues for name-based assignment.',
      ],
      relatedTools: ['create_issues', 'update_issues'],
    };

    const structured = ListUsersOutputSchema.parse({
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
      (u) => {
        const name = (u.displayName as string) ?? (u.name as string) ?? (u.id as string);
        const email = u.email as string | undefined;
        return `${name}${email ? ` <${email}>` : ''} → ${u.id as string}`;
      },
    );

    const text = summarizeList({
      subject: 'Users',
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







