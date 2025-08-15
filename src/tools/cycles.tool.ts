import { LinearDocument } from '@linear/sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config/env.ts';
import { toolsMetadata } from '../config/metadata.ts';
import { ListCyclesInputSchema } from '../schemas/inputs.ts';
import { ListCyclesOutputSchema } from '../schemas/outputs.ts';
import { getLinearClient } from '../services/linear-client.ts';
import { previewLinesFromItems, summarizeList } from '../utils/messages.ts';

export const listCyclesTool = {
  name: toolsMetadata.list_cycles.name,
  title: toolsMetadata.list_cycles.title,
  description: toolsMetadata.list_cycles.description,
  inputSchema: ListCyclesInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = ListCyclesInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: parsed.error.message }],
      };
    }
    const client = getLinearClient();
    const team = await client.team(parsed.data.teamId);
    const cyclesEnabled =
      ((team as unknown as { cyclesEnabled?: boolean } | null)?.cyclesEnabled ??
        false) === true;
    if (!cyclesEnabled) {
      const msg = `Cycles are disabled for team ${parsed.data.teamId}. Use 'workspace_metadata' to inspect teams and avoid cycle tools for teams with cyclesEnabled=false.`;
      return { isError: true, content: [{ type: 'text', text: msg }] };
    }
    const first = parsed.data.limit ?? 20;
    const after = parsed.data.cursor;
    const orderBy =
      parsed.data.orderBy === 'updatedAt'
        ? LinearDocument.PaginationOrderBy.UpdatedAt
        : parsed.data.orderBy === 'createdAt'
          ? LinearDocument.PaginationOrderBy.CreatedAt
          : undefined;
    const conn = await team.cycles({
      first,
      after,
      includeArchived: parsed.data.includeArchived,
      orderBy,
    });
    const items = conn.nodes.map((c) => ({
      id: c.id,
      name: (c as unknown as { name?: string })?.name ?? undefined,
      number: (c as unknown as { number?: number })?.number ?? undefined,
      startsAt: c.startsAt?.toString() ?? undefined,
      endsAt: c.endsAt?.toString() ?? undefined,
      completedAt: c.completedAt?.toString() ?? undefined,
      teamId: parsed.data.teamId,
      status: (c as unknown as { status?: string })?.status ?? undefined,
    }));
    const structured = ListCyclesOutputSchema.parse({
      items,
      cursor: parsed.data.cursor,
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
    const parts: Array<{ type: 'text'; text: string }> = [
      { type: 'text', text: message },
    ];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    return { content: parts, structuredContent: structured };
  },
};
