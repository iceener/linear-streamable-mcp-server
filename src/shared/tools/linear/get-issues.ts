/**
 * Get Issues tool - fetch multiple issues by ID in batch.
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { GetIssueOutputSchema, GetIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { summarizeBatch } from '../../../utils/messages.js';
import { makeConcurrencyGate } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  ids: z.array(z.string()).min(1).max(50),
});

export const getIssuesTool = defineTool({
  name: 'get_issues',
  title: 'Get Issues (Batch)',
  description:
    'Fetch multiple issues by id (UUID or short ID like ENG-123) and return per-item results plus a summary.',
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(3);
    const ids = args.ids;

    const results: Array<{
      index: number;
      ok: boolean;
      id?: string;
      identifier?: string;
      error?: string;
      code?: string;
      issue?: ReturnType<typeof GetIssueOutputSchema.parse>;
    }> = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as string;
      try {
        const issue = await gate(() => client.issue(id));
        const labels = (await issue.labels()).nodes.map((l) => ({
          id: l.id,
          name: l.name,
        }));

        const structured = GetIssueOutputSchema.parse({
          id: issue.id,
          title: issue.title,
          description: issue.description ?? undefined,
          identifier: issue.identifier ?? undefined,
          assignee: issue.assignee
            ? {
                id: (issue.assignee as unknown as { id?: string })?.id ?? undefined,
                name: (issue.assignee as unknown as { name?: string })?.name ?? undefined,
              }
            : undefined,
          state: issue.state
            ? {
                id: (issue.state as unknown as { id?: string })?.id ?? '',
                name: (issue.state as unknown as { name?: string })?.name ?? '',
                type: (issue.state as unknown as { type?: string })?.type,
              }
            : undefined,
          project: issue.project
            ? {
                id: (issue.project as unknown as { id?: string })?.id ?? '',
                name: (issue.project as unknown as { name?: string })?.name ?? undefined,
              }
            : undefined,
          labels,
          branchName: issue.branchName ?? undefined,
          attachments: (await issue.attachments()).nodes,
        });

        results.push({
          index: i,
          ok: true,
          id: structured.id,
          identifier: structured.identifier,
          issue: structured,
        });
      } catch (error) {
        await logger.error('get_issues', {
          message: 'Failed to fetch issue',
          id,
          error: (error as Error).message,
        });
        results.push({
          index: i,
          ok: false,
          error: (error as Error).message,
          code: 'LINEAR_FETCH_ERROR',
        });
      }
    }

    const summary = {
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };

    const structuredBatch = GetIssuesOutputSchema.parse({ results, summary });

    const okIds = results
      .filter((r) => r.ok)
      .map((r) => r.identifier ?? r.id ?? `item[${r.index}]`);

    const messageBase = summarizeBatch({
      action: 'Fetched issues',
      ok: summary.ok,
      total: ids.length,
      okIdentifiers: okIds as string[],
      failures: results
        .filter((r) => !r.ok)
        .map((r) => ({ index: r.index, id: undefined, error: r.error ?? '' })),
      nextSteps: [
        'Call update_issues to modify fields, or list_issues to discover more.',
      ],
    });

    const previewLines = results
      .filter((r) => r.ok && r.issue)
      .slice(0, 5)
      .map((r) => {
        const it = r.issue as unknown as {
          identifier?: string;
          id: string;
          state?: { name?: string };
          assignee?: { name?: string };
          title: string;
        };
        const stateNm = it.state?.name as string | undefined;
        const assNm = it.assignee?.name as string | undefined;
        return `${it.identifier ?? it.id} '${it.title}'${
          stateNm ? ` — state ${stateNm}` : ''
        }${assNm ? `, assignee ${assNm}` : ''}`;
      });

    const fullMessage =
      previewLines.length > 0
        ? `${messageBase} Preview:\n${previewLines.map((l) => `- ${l}`).join('\n')}`
        : messageBase;

    const parts: Array<{ type: 'text'; text: string }> = [
      { type: 'text', text: fullMessage },
    ];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structuredBatch) });
    }

    return { content: parts, structuredContent: structuredBatch };
  },
});


