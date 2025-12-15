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
import { resolvePriority, resolveState, resolveLabels, resolveProject, getIssueTeamId } from '../../../utils/resolvers.js';
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
  // State - UUID or human-readable
  stateId: z
    .string()
    .optional()
    .describe('Workflow state UUID. Or use stateName/stateType for name-based lookup.'),
  stateName: z
    .string()
    .optional()
    .describe('State name from issue\'s team. Use workspace_metadata to see available names.'),
  stateType: z
    .enum(['backlog', 'unstarted', 'started', 'completed', 'canceled'])
    .optional()
    .describe('State type. Finds first matching state.'),
  // Labels - UUIDs or names (use workspace_metadata to see available labels)
  labelIds: z.array(z.string()).optional().describe('Replace all labels with these UUIDs.'),
  labelNames: z
    .array(z.string())
    .optional()
    .describe('Replace all labels with these names from your workspace.'),
  addLabelIds: z.array(z.string()).optional().describe('Add these label UUIDs (incremental).'),
  addLabelNames: z.array(z.string()).optional().describe('Add these label names (incremental).'),
  removeLabelIds: z.array(z.string()).optional().describe('Remove these label UUIDs (incremental).'),
  removeLabelNames: z.array(z.string()).optional().describe('Remove these label names (incremental).'),
  // Assignee - UUID, name, or email (use workspace_metadata to list users)
  assigneeId: z.string().optional().describe('New assignee user UUID.'),
  assigneeName: z
    .string()
    .optional()
    .describe('User name (fuzzy match). Partial names work.'),
  assigneeEmail: z
    .string()
    .optional()
    .describe('User email to assign (exact match, case-insensitive).'),
  // Project - UUID or name
  projectId: z.string().optional().describe('New project UUID.'),
  projectName: z.string().optional().describe('Project name. Resolved to projectId.'),
  // Priority - number or string
  priority: z
    .union([
      z.number().int().min(0).max(4),
      z.enum(['None', 'Urgent', 'High', 'Medium', 'Normal', 'Low', 'none', 'urgent', 'high', 'medium', 'normal', 'low']),
    ])
    .optional()
    .describe('Priority: 0-4 or "None"/"Urgent"/"High"/"Medium"/"Low".'),
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

        // Get team ID for resolution (needed for state/labels)
        const teamId = await getIssueTeamId(client, it.id);

        // Resolve state from ID, name, or type
        if (it.stateId) {
          payloadInput.stateId = it.stateId;
        } else if (it.stateName || it.stateType) {
          if (!teamId) {
            results.push({
              index: i,
              ok: false,
              error: 'Cannot resolve state: failed to get issue team',
              code: 'TEAM_RESOLUTION_FAILED',
            });
            continue;
          }
          const stateResult = await resolveState(client, teamId, {
            stateName: it.stateName,
            stateType: it.stateType,
          });
          if (!stateResult.success) {
            results.push({
              index: i,
              ok: false,
              error: stateResult.error,
              code: 'STATE_RESOLUTION_FAILED',
            });
            continue;
          }
          payloadInput.stateId = stateResult.value;
        }

        // Resolve labels from IDs or names
        if (Array.isArray(it.labelIds) && it.labelIds.length > 0) {
          payloadInput.labelIds = it.labelIds;
        } else if (Array.isArray(it.labelNames) && it.labelNames.length > 0) {
          if (!teamId) {
            results.push({ index: i, ok: false, error: 'Cannot resolve labels: failed to get issue team', code: 'TEAM_RESOLUTION_FAILED' });
            continue;
          }
          const labelsResult = await resolveLabels(client, teamId, it.labelNames);
          if (!labelsResult.success) {
            results.push({ index: i, ok: false, error: labelsResult.error, code: 'LABEL_RESOLUTION_FAILED' });
            continue;
          }
          payloadInput.labelIds = labelsResult.value;
        }

        // Resolve addLabelNames
        if (Array.isArray(it.addLabelIds) && it.addLabelIds.length > 0) {
          payloadInput.addedLabelIds = it.addLabelIds;
        } else if (Array.isArray(it.addLabelNames) && it.addLabelNames.length > 0) {
          if (!teamId) {
            results.push({ index: i, ok: false, error: 'Cannot resolve labels: failed to get issue team', code: 'TEAM_RESOLUTION_FAILED' });
            continue;
          }
          const addResult = await resolveLabels(client, teamId, it.addLabelNames);
          if (!addResult.success) {
            results.push({ index: i, ok: false, error: addResult.error, code: 'LABEL_RESOLUTION_FAILED' });
            continue;
          }
          payloadInput.addedLabelIds = addResult.value;
        }

        // Resolve removeLabelNames
        if (Array.isArray(it.removeLabelIds) && it.removeLabelIds.length > 0) {
          payloadInput.removedLabelIds = it.removeLabelIds;
        } else if (Array.isArray(it.removeLabelNames) && it.removeLabelNames.length > 0) {
          if (!teamId) {
            results.push({ index: i, ok: false, error: 'Cannot resolve labels: failed to get issue team', code: 'TEAM_RESOLUTION_FAILED' });
            continue;
          }
          const removeResult = await resolveLabels(client, teamId, it.removeLabelNames);
          if (!removeResult.success) {
            results.push({ index: i, ok: false, error: removeResult.error, code: 'LABEL_RESOLUTION_FAILED' });
            continue;
          }
          payloadInput.removedLabelIds = removeResult.value;
        }

        // Resolve assignee from ID, name, or email
        if (it.assigneeId || it.assigneeName || it.assigneeEmail) {
          const assigneeResult = await resolveAssignee(client, {
            assigneeId: it.assigneeId,
            assigneeName: it.assigneeName,
            assigneeEmail: it.assigneeEmail,
          });

          if (!assigneeResult.success && assigneeResult.error) {
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

        // Resolve project from ID or name
        if (it.projectId) {
          payloadInput.projectId = it.projectId;
        } else if (it.projectName) {
          const projectResult = await resolveProject(client, it.projectName);
          if (!projectResult.success) {
            results.push({ index: i, ok: false, error: projectResult.error, code: 'PROJECT_RESOLUTION_FAILED' });
            continue;
          }
          payloadInput.projectId = projectResult.value;
        }

        // Resolve priority from number or string
        if (it.priority !== undefined) {
          const priorityResult = resolvePriority(it.priority);
          if (!priorityResult.success) {
            results.push({ index: i, ok: false, error: priorityResult.error, code: 'PRIORITY_INVALID' });
            continue;
          }
          const validatedPriority = validatePriority(priorityResult.value);
          if (validatedPriority !== undefined) {
            payloadInput.priority = validatedPriority;
          }
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

    // Build summary without next steps first
    const summaryLine = summarizeBatch({
      action: 'Updated issues',
      ok: summary.ok,
      total: items.length,
      okIdentifiers: okIds,
      failures,
    });

    // Compose: summary → diffs → tips (diffs should come before tips)
    const nextStep = archivedRequested
      ? 'Tip: Use list_issues with includeArchived: true to verify archived issues.'
      : 'Tip: Use list_issues to verify changes.';
    
    const textParts = [summaryLine];
    if (diffLines.length > 0) {
      textParts.push(diffLines.join('\n'));
    }
    textParts.push(nextStep);
    
    const text = textParts.join('\n\n');

    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});







