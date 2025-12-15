/**
 * Update Issues tool - batch update issues in Linear.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import { UpdateIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { makeConcurrencyGate, withRetry, delay } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { summarizeBatch } from '../../../utils/messages.js';
import { resolveAssignee } from '../../../utils/user-resolver.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';
import {
  createTeamSettingsCache,
  validateEstimate,
  validatePriority,
  captureIssueSnapshot,
  computeFieldChanges,
  formatDiffLine,
} from './shared/index.js';

const IssueUpdateItem = z.object({
  id: z.string().describe('Issue UUID or identifier (e.g. ENG-123). Required.'),
  title: z.string().optional().describe('New title.'),
  description: z.string().optional().describe('New markdown description.'),
  stateId: z
    .string()
    .optional()
    .describe('New workflow state UUID. Get from workspace_metadata.workflowStatesByTeam.'),
  labelIds: z.array(z.string()).optional().describe('Replace all labels with these UUIDs.'),
  addLabelIds: z.array(z.string()).optional().describe('Add these label UUIDs (incremental).'),
  removeLabelIds: z.array(z.string()).optional().describe('Remove these label UUIDs (incremental).'),
  assigneeId: z.string().optional().describe('New assignee user UUID. Use assigneeName or assigneeEmail for name-based lookup.'),
  assigneeName: z
    .string()
    .optional()
    .describe('User name to assign (fuzzy match). Resolved to assigneeId automatically. Example: "John" matches "John Smith".'),
  assigneeEmail: z
    .string()
    .optional()
    .describe('User email to assign (exact match, case-insensitive). Resolved to assigneeId automatically.'),
  projectId: z.string().optional().describe('New project UUID.'),
  priority: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe('Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low.'),
  estimate: z.number().optional().describe('New estimate / story points.'),
  allowZeroEstimate: z
    .boolean()
    .optional()
    .describe('If true and estimate=0, sends 0. Otherwise zero is omitted.'),
  dueDate: z.string().optional().describe('New due date (YYYY-MM-DD) or empty string to clear.'),
  parentId: z.string().optional().describe('New parent issue UUID.'),
  archived: z.boolean().optional().describe('Set true to archive, false to unarchive.'),
});

const InputSchema = z.object({
  items: z.array(IssueUpdateItem).min(1).max(50).describe('Issues to update. Batch up to 50.'),
  parallel: z.boolean().optional().describe('Run in parallel. Default: sequential.'),
  dry_run: z.boolean().optional().describe('If true, validate but do not update.'),
});

export const updateIssuesTool = defineTool({
  name: toolsMetadata.update_issues.name,
  title: toolsMetadata.update_issues.title,
  description: toolsMetadata.update_issues.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    // Handle dry_run mode
    if (args.dry_run) {
      const validated = args.items.map((it, index) => ({
        index,
        ok: true,
        id: it.id,
        validated: true,
      }));
      return {
        content: [
          {
            type: 'text',
            text: `Dry run: ${args.items.length} update(s) validated successfully. No changes made.`,
          },
        ],
        structuredContent: {
          results: validated,
          summary: { ok: args.items.length, failed: 0 },
          dry_run: true,
        },
      };
    }

    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);
    const { items } = args;

    const results: {
      index: number;
      ok: boolean;
      id?: string;
      error?: string;
      code?: string;
    }[] = [];

    const teamAllowZeroCache = createTeamSettingsCache();
    const diffLines: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i] as (typeof items)[number];
      try {
        // Capture BEFORE snapshot using shared utility
        const beforeSnapshot = await gate(() => captureIssueSnapshot(client, it.id));

        const payloadInput: Record<string, unknown> = {};

        if (typeof it.title === 'string' && it.title.trim() !== '') {
          payloadInput.title = it.title;
        }

        if (typeof it.description === 'string' && it.description.trim() !== '') {
          payloadInput.description = it.description;
        }

        if (typeof it.stateId === 'string' && it.stateId) {
          payloadInput.stateId = it.stateId;
        }

        if (Array.isArray(it.labelIds) && it.labelIds.length > 0) {
          payloadInput.labelIds = it.labelIds;
        }

        // Resolve assignee from ID, name, or email
        if (it.assigneeId || it.assigneeName || it.assigneeEmail) {
          const assigneeResult = await resolveAssignee(client, {
            assigneeId: it.assigneeId,
            assigneeName: it.assigneeName,
            assigneeEmail: it.assigneeEmail,
          });

          if (!assigneeResult.success && assigneeResult.error) {
            // User resolution failed - report error but continue batch
            results.push({
              index: i,
              ok: false,
              error: assigneeResult.error.message,
              code: assigneeResult.error.code,
            });
            continue;
          }

          if (assigneeResult.user?.id) {
            payloadInput.assigneeId = assigneeResult.user.id;
          }
        }

        if (typeof it.projectId === 'string' && it.projectId) {
          payloadInput.projectId = it.projectId;
        }

        // Use shared validation
        const priority = validatePriority(it.priority);
        if (priority !== undefined) {
          payloadInput.priority = priority;
        }

        // Use shared validation for estimate
        if (typeof it.estimate === 'number') {
          // Try to get team ID from the issue
          let teamId: string | undefined;
          try {
            const issue = await client.issue(it.id);
            teamId = (issue as unknown as { teamId?: string })?.teamId;
          } catch {}

          const estimate = await validateEstimate(
            it.estimate,
            teamId,
            teamAllowZeroCache,
            client,
            it.allowZeroEstimate,
          );
          if (estimate !== undefined) {
            payloadInput.estimate = estimate;
          }
        }

        if (typeof it.dueDate === 'string' && it.dueDate.trim() !== '') {
          payloadInput.dueDate = it.dueDate;
        }

        if (typeof it.parentId === 'string' && it.parentId) {
          payloadInput.parentId = it.parentId;
        }

        if (context.signal?.aborted) {
          throw new Error('Operation aborted');
        }

        // Add small delay between requests to avoid rate limits
        if (i > 0) {
          await delay(100);
        }

        const payload = await withRetry(
          () =>
            args.parallel === true
              ? client.updateIssue(it.id, payloadInput)
              : gate(() => client.updateIssue(it.id, payloadInput)),
          { maxRetries: 3, baseDelayMs: 500 },
        );

        // Handle incremental label updates
        if (it.addLabelIds?.length || it.removeLabelIds?.length) {
          const issue = await gate(() => client.issue(it.id));
          const current = new Set((await issue.labels()).nodes.map((l) => l.id));
          it.addLabelIds?.forEach((id) => current.add(id));
          it.removeLabelIds?.forEach((id) => current.delete(id));
          await (args.parallel === true
            ? client.updateIssue(it.id, { labelIds: Array.from(current) })
            : gate(() => client.updateIssue(it.id, { labelIds: Array.from(current) })));
        }

        // Handle archive/unarchive
        if (typeof it.archived === 'boolean') {
          try {
            const targetArchived = it.archived === true;
            if (targetArchived) {
              const anyClient = client as unknown as {
                archiveIssue?: (id: string) => Promise<unknown>;
              };
              if (typeof anyClient.archiveIssue === 'function') {
                await (args.parallel === true
                  ? anyClient.archiveIssue?.(it.id)
                  : gate(() => anyClient.archiveIssue?.(it.id) as Promise<unknown>));
              }
            } else {
              const anyClient = client as unknown as {
                unarchiveIssue?: (id: string) => Promise<unknown>;
              };
              if (typeof anyClient.unarchiveIssue === 'function') {
                await (args.parallel === true
                  ? anyClient.unarchiveIssue?.(it.id)
                  : gate(() => anyClient.unarchiveIssue?.(it.id) as Promise<unknown>));
              }
            }
          } catch {
            // Ignore archive errors to preserve other updates
          }
        }

        // Build input echo (only include provided fields)
        const inputEcho: Record<string, unknown> = { id: it.id };
        if (it.title) inputEcho.title = it.title;
        if (it.stateId) inputEcho.stateId = it.stateId;
        if (it.assigneeId) inputEcho.assigneeId = it.assigneeId;
        if (it.assigneeName) inputEcho.assigneeName = it.assigneeName;
        if (it.assigneeEmail) inputEcho.assigneeEmail = it.assigneeEmail;
        if (it.projectId) inputEcho.projectId = it.projectId;
        if (it.addLabelIds) inputEcho.addLabelIds = it.addLabelIds;
        if (it.removeLabelIds) inputEcho.removeLabelIds = it.removeLabelIds;

        results.push({
          input: inputEcho,
          success: payload.success ?? true,
          id: it.id,
          // Legacy
          index: i,
          ok: payload.success ?? true,
        });

        // Capture AFTER snapshot using shared utility
        const afterSnapshot = await gate(() => captureIssueSnapshot(client, it.id));

        // Compute changes using shared utility
        if (afterSnapshot) {
          const requestedFields = new Set(Object.keys(it));
          const changes = computeFieldChanges(beforeSnapshot, afterSnapshot, requestedFields);

          // Format diff using shared utility
          if (Object.keys(changes).length > 0) {
            const diffLine = formatDiffLine(afterSnapshot, changes);
            diffLines.push(diffLine);
          } else if (beforeSnapshot) {
            // No changes detected, just show header
            const idf = afterSnapshot.identifier ?? afterSnapshot.id;
            const title = afterSnapshot.url
              ? `[${idf} — ${afterSnapshot.title}](${afterSnapshot.url})`
              : `${idf} — ${afterSnapshot.title}`;
            diffLines.push(`- ${title} (id ${afterSnapshot.id})`);
          }
        }
      } catch (error) {
        await logger.error('update_issues', {
          message: 'Failed to update issue',
          id: it.id,
          error: (error as Error).message,
        });
        results.push({
          input: { id: it.id },
          success: false,
          id: it.id,
          error: {
            code: 'LINEAR_UPDATE_ERROR',
            message: (error as Error).message,
            suggestions: [
              "Verify the issue ID exists with list_issues or get_issues.",
              "Check that stateId exists in workflowStatesByTeam.",
              "Use list_users to find valid assigneeId.",
            ],
            retryable: false,
          },
          // Legacy
          index: i,
          ok: false,
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    const summary = {
      total: items.length,
      succeeded,
      failed,
      // Legacy
      ok: succeeded,
    };

    // Build meta with next steps
    const metaNextSteps: string[] = [
      'Use list_issues or get_issues to verify changes.',
    ];
    if (failed > 0) {
      metaNextSteps.push("Check error.suggestions for recovery hints.");
    }

    const meta = {
      nextSteps: metaNextSteps,
      relatedTools: ['list_issues', 'get_issues', 'add_comments'],
    };

    const structured = UpdateIssuesOutputSchema.parse({ results, summary, meta });

    const okIds = results
      .filter((r) => r.ok)
      .map((r) => r.id ?? `item[${String(r.index)}]`) as string[];

    const failures = results
      .filter((r) => !r.ok)
      .map((r) => ({
        index: r.index,
        id: r.id,
        error: r.error ?? '',
        code: undefined,
      }));

    const archivedRequested = items.some((x) => typeof x.archived === 'boolean');

    const base = summarizeBatch({
      action: 'Updated issues',
      ok: summary.ok,
      total: items.length,
      okIdentifiers: okIds,
      failures,
      nextSteps: [
        archivedRequested
          ? 'Use list_issues (filter by id or by number+team.key/team.id, includeArchived: true, limit=1) for verification.'
          : 'Use list_issues (filter by id or by number+team.key/team.id, limit=1) for verification.',
      ],
    });

    const text = diffLines.length > 0 ? `${base}\n\n${diffLines.join('\n')}` : base;

    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});







