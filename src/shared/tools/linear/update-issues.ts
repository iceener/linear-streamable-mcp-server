/**
 * Update Issues tool - batch update issues in Linear.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import { UpdateIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { makeConcurrencyGate } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { summarizeBatch } from '../../../utils/messages.js';
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
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  stateId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  addLabelIds: z.array(z.string()).optional(),
  removeLabelIds: z.array(z.string()).optional(),
  assigneeId: z.string().optional(),
  projectId: z.string().optional(),
  priority: z.number().optional(),
  estimate: z.number().optional(),
  dueDate: z.string().optional(),
  parentId: z.string().optional(),
  archived: z.boolean().optional(),
});

const InputSchema = z.object({
  items: z.array(IssueUpdateItem).min(1).max(50),
  parallel: z.boolean().optional(),
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

        if (typeof it.assigneeId === 'string' && it.assigneeId) {
          payloadInput.assigneeId = it.assigneeId;
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
            undefined,
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

        const payload =
          args.parallel === true
            ? await client.updateIssue(it.id, payloadInput)
            : await gate(() => client.updateIssue(it.id, payloadInput));

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

        results.push({ index: i, ok: payload.success ?? true, id: it.id });

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
          index: i,
          ok: false,
          id: it.id,
          error: (error as Error).message,
          code: 'LINEAR_UPDATE_ERROR',
        });
      }
    }

    const summary = {
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };

    const structured = UpdateIssuesOutputSchema.parse({ results, summary });

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


