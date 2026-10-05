/**
 * Get Issues tool - fetch multiple issues by ID in batch.
 */

import { z } from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { makeConcurrencyGate } from './shared/limits';
import { withLinear } from './shared/linear';
import { summarizeBatch } from './shared/messages';
import { GetIssueOutputSchema, GetIssuesOutputSchema } from './shared/outputs';

const InputSchema = z.object({
  ids: z
    .array(z.string())
    .min(1)
    .max(50)
    .describe('Issue IDs to fetch. Accepts UUIDs or short identifiers like ENG-123.'),
});

export const getIssues = defineTool(
  'get_issues',
  {
    title: 'Get Issues (Batch)',
    description:
      "Fetch detailed issues in batch by ids (UUIDs or short ids like ENG-123). Inputs: { ids: string[] }.\nReturns: { results: Array<{ index, ok, id?, identifier?, issue? }>, summary }. Each issue includes assignee, state, project, labels, attachments, and branchName when available. Next: Call 'update_issues' to modify fields or 'list_issues' to discover more.",
    inputSchema: InputSchema,
    outputSchema: GetIssuesOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  },
  (args, ctx, deps) =>
    withLinear(ctx, deps, async (context) => {
      const client = context.client();
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
          context.logger.error('Failed to fetch issue', {
            tool: 'get_issues',
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

      // Build summary without next steps (tips go at the end)
      const summaryLine = summarizeBatch({
        action: 'Fetched issues',
        ok: succeeded,
        total: ids.length,
        okIdentifiers: okIds as string[],
        failures: results
          .filter((r) => !r.success)
          .map((r, idx) => ({
            index: idx,
            id: r.requestedId,
            error: r.error?.message ?? '',
          })),
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
            : (it.identifier ?? it.id);
          return `${prefix} '${it.title}'${
            stateNm ? ` — state ${stateNm}` : ''
          }${assNm ? `, assignee ${assNm}` : ''}`;
        });

      // Compose: summary → preview → tip
      const textParts = [summaryLine];
      if (previewLines.length > 0) {
        textParts.push(`Preview:\n${previewLines.map((l) => `- ${l}`).join('\n')}`);
      }
      textParts.push('Tip: Use update_issues to modify, or list_issues to discover more.');
      const fullMessage = textParts.join('\n\n');

      const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: fullMessage }];

      if (context.includeJsonInContent) {
        parts.push({ type: 'text', text: JSON.stringify(structuredBatch) });
      }

      return { content: parts, structuredContent: structuredBatch };
    }),
);
