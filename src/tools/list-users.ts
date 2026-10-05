/**
 * List Users tool.
 */

import { z } from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { withLinear } from './shared/linear';
import { mapUserNodeToListItem } from './shared/mappers';
import { previewLinesFromItems, summarizeList } from './shared/messages';
import { ListUsersOutputSchema } from './shared/outputs';

const InputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const listUsers = defineTool(
  'list_users',
  {
    title: 'List Users',
    description:
      "List users in the workspace. Inputs: limit?, cursor?.\nReturns: { items: Array<{ id, name?, email?, displayName?, avatarUrl? }>, cursor?, nextCursor?, limit? }. Next: Use user ids in 'update_issues' (assigneeId).",
    inputSchema: InputSchema,
    outputSchema: ListUsersOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  (args, ctx, deps) =>
    withLinear(ctx, deps, async (context) => {
      const client = context.client();
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

      const preview = previewLinesFromItems(items as unknown as Record<string, unknown>[], (u) => {
        const name = (u.displayName as string) ?? (u.name as string) ?? (u.id as string);
        const email = u.email as string | undefined;
        return `${name}${email ? ` <${email}>` : ''} → ${u.id as string}`;
      });

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
    }),
);
