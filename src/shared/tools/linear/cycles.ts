/**
 * List Cycles tool - fetch cycles for a team.
 */

import { LinearDocument } from '@linear/sdk';
import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import { ListCyclesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { summarizeList, previewLinesFromItems } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  teamId: z.string(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  includeArchived: z.boolean().optional(),
  orderBy: z.enum(['updatedAt', 'createdAt']).optional(),
});

export const listCyclesTool = defineTool({
  name: toolsMetadata.list_cycles.name,
  title: toolsMetadata.list_cycles.title,
  description: toolsMetadata.list_cycles.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
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
      return {
        isError: true,
        content: [{ type: 'text', text: msg }],
        structuredContent: {
          error: 'CYCLES_DISABLED',
          teamId: args.teamId,
          alternatives: ['list_projects', 'labels', 'dueDate'],
          hint: 'Use workspace_metadata to find teams with cycles enabled.',
        },
      };
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
    });
    
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
    const nextCursor = hasMore ? pageInfo?.endCursor ?? undefined : undefined;

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
    
    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (c) =>
        `${String(
          (c.name as string) ?? (c.number as number | undefined) ?? 'Cycle',
        )} (${c.id}) ${
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
    
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    
    return { content: parts, structuredContent: structured };
  },
});

























