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
      const msg = `Cycles are disabled for team ${args.teamId}. Use 'workspace_metadata' to inspect teams and avoid cycle tools for teams with cyclesEnabled=false.`;
      return { isError: true, content: [{ type: 'text', text: msg }] };
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
    
    const structured = ListCyclesOutputSchema.parse({
      items,
      cursor: args.cursor,
      nextCursor: conn.pageInfo?.endCursor ?? undefined,
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
      nextCursor: structured.nextCursor,
      previewLines: preview,
      nextSteps: [
        'Use cycle number/name to coordinate planning. Filter list_issues by team and state to gather work for cycles.',
      ],
    });
    
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: message }];
    
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    
    return { content: parts, structuredContent: structured };
  },
});







