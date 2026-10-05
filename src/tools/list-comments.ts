import { z } from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { withLinear } from './shared/linear';
import { mapCommentNodeToListItem } from './shared/mappers';
import { previewLinesFromItems, summarizeList } from './shared/messages';
import { ListCommentsOutputSchema } from './shared/outputs';

// List Comments
const ListCommentsInputSchema = z.object({
  issueId: z.string(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const listComments = defineTool(
  'list_comments',
  {
    title: 'List Comments',
    description:
      'List comments for an issue. Inputs: { issueId, limit?, cursor? }.\nReturns: { items[], cursor?, nextCursor?, limit? } where items include id, body, url?, createdAt, updatedAt?, user{id,name?}. Next: Use add_comments to add context or mention teammates.',
    inputSchema: ListCommentsInputSchema,
    outputSchema: ListCommentsOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  (args, ctx, deps) =>
    withLinear(ctx, deps, async (context) => {
      const client = context.client();
      const issue = await client.issue(args.issueId);
      const first = args.limit ?? 20;
      const after = args.cursor;
      const conn = await issue.comments({ first, after } as Parameters<typeof issue.comments>[0]);
      const items = await Promise.all(conn.nodes.map((c) => mapCommentNodeToListItem(c)));

      const pageInfo = conn.pageInfo;
      const hasMore = pageInfo?.hasNextPage ?? false;
      const nextCursor = hasMore ? (pageInfo?.endCursor ?? undefined) : undefined;

      // Build query echo
      const query = {
        issueId: args.issueId,
        limit: first,
      };

      // Build pagination
      const pagination = {
        hasMore,
        nextCursor,
        itemsReturned: items.length,
        limit: first,
      };

      // Build meta
      const meta = {
        nextSteps: [
          ...(hasMore ? [`Call again with cursor="${nextCursor}" for more.`] : []),
          'Use add_comments to add context or mention teammates.',
          'Use update_comments to edit existing comments.',
        ],
        relatedTools: ['add_comments', 'update_comments', 'get_issues'],
      };

      const structured = ListCommentsOutputSchema.parse({
        query,
        items,
        pagination,
        meta,
        // Legacy
        cursor: args.cursor,
        nextCursor,
        limit: first,
      });

      const preview = previewLinesFromItems(items as unknown as Record<string, unknown>[], (c) => {
        const user = c.user as unknown as { name?: string; id?: string } | undefined;
        const author = user?.name ?? user?.id ?? 'unknown';
        const body = String((c.body as string | undefined) ?? '').slice(0, 80);
        const url = (c.url as string | undefined) ?? undefined;
        const title = url ? `[${author}](${url})` : author;
        return `${title}: ${body}`;
      });

      const message = summarizeList({
        subject: 'Comments',
        count: items.length,
        limit: first,
        nextCursor,
        previewLines: preview,
        nextSteps: meta.nextSteps,
      });

      const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: message }];

      if (context.includeJsonInContent) {
        parts.push({ type: 'text', text: JSON.stringify(structured) });
      }

      return { content: parts, structuredContent: structured };
    }),
);
