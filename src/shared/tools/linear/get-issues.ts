/**
 * Get Issues tool - fetch multiple issues by ID in batch.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import { GetIssueOutputSchema, GetIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { summarizeBatch } from '../../../utils/messages.js';
import { makeConcurrencyGate } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  ids: z
    .array(z.string())
    .min(1)
    .max(50)
    .describe('Issue IDs to fetch. Accepts UUIDs or short identifiers like ENG-123.'),
});

export const getIssuesTool = defineTool({
  name: toolsMetadata.get_issues.name,
  title: toolsMetadata.get_issues.title,
  description: toolsMetadata.get_issues.description,
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
      requestedId: string;
      success: boolean;
      issue?: ReturnType<typeof GetIssueOutputSchema.parse>;
      error?: { code: string; message: string; suggestions?: string[] };
    }> = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as string;
      try {
        const issue = await gate(() => client.issue(id));
        const labels = (await issue.labels()).nodes.map((l) => ({
          id: l.id,
          name: l.name,
        }));

        // Await lazy-loaded relations
        const assigneeData = await issue.assignee;
        const stateData = await issue.state;
        const projectData = await issue.project;

        const issueUrl = (issue as unknown as { url?: string })?.url;

        const structured = GetIssueOutputSchema.parse({
          id: issue.id,
          title: issue.title,
          description: issue.description ?? undefined,
          identifier: issue.identifier ?? undefined,
          url: issueUrl,
          assignee: assigneeData
            ? {
                id: assigneeData.id,
                name: assigneeData.name ?? undefined,
              }
            : undefined,
          state: stateData
            ? {
                id: stateData.id,
                name: stateData.name ?? '',
                type: (stateData as unknown as { type?: string })?.type,
              }
            : undefined,
          project: projectData
            ? {
                id: projectData.id,
                name: projectData.name ?? undefined,
              }
            : undefined,
          labels,
          branchName: issue.branchName ?? undefined,
          attachments: (await issue.attachments()).nodes,
        });

        results.push({
          requestedId: id,
          success: true,
          issue: structured,
        });
      } catch (error) {
        await logger.error('get_issues', {
          message: 'Failed to fetch issue',
          id,
          error: (error as Error).message,
        });
        results.push({
          requestedId: id,
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: (error as Error).message,
            suggestions: [
              'Verify the issue ID or identifier is correct.',
              'Use list_issues to find valid issue IDs.',
              'Check if the issue was archived (use includeArchived: true).',
            ],
          },
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    const summary = {
      succeeded,
      failed,
    };

    // Build meta with next steps
    const meta = {
      nextSteps: [
        'Use update_issues to modify state, assignee, or labels.',
        'Use add_comments to add context or updates.',
      ],
      relatedTools: ['update_issues', 'add_comments', 'list_issues'],
    };

    const structuredBatch = GetIssuesOutputSchema.parse({ results, summary, meta });

    const okIds = results
      .filter((r) => r.success)
      .map((r) => r.issue?.identifier ?? r.issue?.id ?? r.requestedId);

    const messageBase = summarizeBatch({
      action: 'Fetched issues',
      ok: succeeded,
      total: ids.length,
      okIdentifiers: okIds as string[],
      failures: results
        .filter((r) => !r.success)
        .map((r, idx) => ({ index: idx, id: r.requestedId, error: r.error?.message ?? '' })),
      nextSteps: [
        'Call update_issues to modify fields, or list_issues to discover more.',
      ],
    });

    const previewLines = results
      .filter((r) => r.success && r.issue)
      .map((r) => {
        const it = r.issue as unknown as {
          identifier?: string;
          id: string;
          url?: string;
          state?: { name?: string };
          assignee?: { name?: string };
          title: string;
        };
        const stateNm = it.state?.name as string | undefined;
        const assNm = it.assignee?.name as string | undefined;
        const prefix = it.url
          ? `[${it.identifier ?? it.id}](${it.url})`
          : it.identifier ?? it.id;
        return `${prefix} '${it.title}'${
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







