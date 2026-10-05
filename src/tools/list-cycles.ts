/**
 * List Cycles tool - fetch cycles for a team.
 */

import { LinearDocument } from '@linear/sdk';
import { z } from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { toolErrorWithDetails, withLinear } from './shared/linear';
import { previewLinesFromItems, summarizeList } from './shared/messages';
import { ListCyclesOutputSchema } from './shared/outputs';

const InputSchema = z.object({
  teamId: z.string(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  includeArchived: z.boolean().optional(),
  orderBy: z.enum(['updatedAt', 'createdAt']).optional(),
});

export const listCycles = defineTool(
  'list_cycles',
  {
    title: 'List Cycles',
    description:
      "List cycles for a team (only if team.cyclesEnabled=true). Inputs: { teamId, includeArchived?, orderBy?(updatedAt|createdAt), limit?, cursor? }.\nReturns: { items[], cursor?, nextCursor?, limit? } where items include id, name?, number?, startsAt?, endsAt?, completedAt?, teamId, status?. Next: Use teamId from 'workspace_metadata' to target the right team; avoid this tool if cyclesEnabled=false.",
    inputSchema: InputSchema,
    outputSchema: ListCyclesOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  (args, ctx, deps) =>
    withLinear(ctx, deps, async (context) => {
      const client = context.client();
      const team = await client.team(args.teamId);

      const cyclesEnabled =
        ((team as unknown as { cyclesEnabled?: boolean } | null)?.cyclesEnabled ?? false) === true;

      if (!cyclesEnabled) {
        const msg =
          `Cycles are disabled for team ${args.teamId}.\n\n` +
          `Alternatives for organizing work:\n` +
          `- Use list_projects to manage work with milestones and project phases\n` +
          `- Use labels to group issues by sprint/phase (e.g., "Sprint 23", "Q1-2024")\n` +
          `- Use dueDate field on issues to track timelines\n\n` +
          `Next steps: Check workspace_metadata with include=["teams"] to find teams with cyclesEnabled=true, ` +
          `or use list_projects for milestone-based planning.`;
        return toolErrorWithDetails(msg, {
          error: 'CYCLES_DISABLED',
          teamId: args.teamId,
          alternatives: ['list_projects', 'labels', 'dueDate'],
          hint: 'Use workspace_metadata to find teams with cycles enabled.',
        });
      }

      const first = args.limit ?? 20;
      const after = args.cursor;
      const orderBy =
        args.orderBy === 'updatedAt'
          ? LinearDocument.PaginationOrderBy.UpdatedAt
          : args.orderBy === 'createdAt'
            ? LinearDocument.PaginationOrderBy.CreatedAt
            : undefined;

      const conn = await team.cycles({
        first,
        after,
        includeArchived: args.includeArchived,
        orderBy,
      } as Parameters<typeof team.cycles>[0]);

      const items = conn.nodes.map((c) => ({
        id: c.id,
        name: (c as unknown as { name?: string })?.name ?? undefined,
        number: (c as unknown as { number?: number })?.number ?? undefined,
        startsAt: c.startsAt?.toString() ?? undefined,
        endsAt: c.endsAt?.toString() ?? undefined,
        completedAt: c.completedAt?.toString() ?? undefined,
        teamId: args.teamId,
        status: (c as unknown as { status?: string })?.status ?? undefined,
      }));

      const pageInfo = conn.pageInfo;
      const hasMore = pageInfo?.hasNextPage ?? false;
      const nextCursor = hasMore ? (pageInfo?.endCursor ?? undefined) : undefined;

      // Build query echo
      const query = {
        teamId: args.teamId,
        includeArchived: args.includeArchived,
        orderBy: args.orderBy,
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
          'Use cycle number/name to coordinate planning.',
          'Use list_issues with team filter to gather work for cycles.',
        ],
        relatedTools: ['list_issues', 'update_issues'],
      };

      const structured = ListCyclesOutputSchema.parse({
        query,
        items,
        pagination,
        meta,
        // Legacy
        cursor: args.cursor,
        nextCursor,
        limit: first,
      });

      const preview = previewLinesFromItems(items as unknown as Record<string, unknown>[], (c) =>
        `${String((c.name as string) ?? (c.number as number | undefined) ?? 'Cycle')} (${c.id}) ${
          (c.startsAt as string | undefined)
            ? `— ${String(c.startsAt)} → ${String(c.endsAt ?? '')}`
            : ''
        }`.trim(),
      );

      const message = summarizeList({
        subject: 'Cycles',
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
