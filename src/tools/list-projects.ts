import { z } from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { withLinear } from './shared/linear';
import { mapProjectNodeToListItem } from './shared/mappers';
import { previewLinesFromItems, summarizeList } from './shared/messages';
import { ListProjectsOutputSchema } from './shared/outputs';

// List Projects
const ListProjectsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().describe('Max results. Default: 20.'),
  cursor: z.string().optional().describe('Pagination cursor from previous response.'),
  filter: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      'GraphQL-style ProjectFilter. Structure: { field: { comparator: value } }. ' +
        "Examples: { id: { eq: 'PROJECT_UUID' } } for single project, " +
        "{ state: { eq: 'started' } }, " +
        "{ team: { id: { eq: 'TEAM_UUID' } } }, " +
        "{ lead: { id: { eq: 'USER_UUID' } } }, " +
        "{ targetDate: { lt: '2025-01-01', gt: '2024-01-01' } }.",
    ),
  includeArchived: z.boolean().optional().describe('Include archived projects. Default: false.'),
});

export const listProjects = defineTool(
  'list_projects',
  {
    title: 'List Projects',
    description:
      "List projects with filtering and pagination. Inputs: filter? (ProjectFilter: id/state/team/lead/targetDate), includeArchived?, limit?, cursor?. For a single project, set filter.id.eq and limit=1.\nReturns: { items[], cursor?, nextCursor?, limit? } where items include id, name, state, leadId?, teamId?, targetDate?, description?. Next: Use 'update_projects' to modify or 'list_issues' with projectId to find issues.",
    inputSchema: ListProjectsInputSchema,
    outputSchema: ListProjectsOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  (args, ctx, deps) =>
    withLinear(ctx, deps, async (context) => {
      const client = context.client();
      const first = args.limit ?? 20;
      const after = args.cursor;
      const filter = args.filter as Record<string, unknown> | undefined;

      const conn = await client.projects({
        first,
        after,
        filter: filter as Record<string, unknown> | undefined,
        includeArchived: args.includeArchived,
      } as Parameters<typeof client.projects>[0]);

      const items = conn.nodes.map((p) => mapProjectNodeToListItem(p));

      const pageInfo = conn.pageInfo;
      const hasMore = pageInfo?.hasNextPage ?? false;
      const nextCursor = hasMore ? (pageInfo?.endCursor ?? undefined) : undefined;

      // Build query echo
      const query = {
        filter: args.filter ? (filter as Record<string, unknown>) : undefined,
        includeArchived: args.includeArchived,
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
          'Use update_projects to modify state or details.',
          'Use list_issues with projectId to see project issues.',
        ],
        relatedTools: ['update_projects', 'list_issues', 'create_projects'],
      };

      const structured = ListProjectsOutputSchema.parse({
        query,
        items,
        pagination,
        meta,
        // Legacy
        cursor: args.cursor,
        nextCursor,
        limit: first,
      });

      const preview = previewLinesFromItems(
        items as unknown as Record<string, unknown>[],
        (p) =>
          `${String((p.name as string) ?? '')} (${p.id}) — state ${String((p.state as string) ?? '')}`,
      );

      const message = summarizeList({
        subject: 'Projects',
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
