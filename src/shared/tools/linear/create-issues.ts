/**
 * Create Issues tool - batch create issues in Linear.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import { CreateIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { makeConcurrencyGate } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { summarizeBatch } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';
import { createTeamSettingsCache, validateEstimate, validatePriority } from './shared/index.js';

const IssueCreateItem = z.object({
  teamId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  stateId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  assigneeId: z.string().optional(),
  projectId: z.string().optional(),
  priority: z.number().optional(),
  estimate: z.number().optional(),
  dueDate: z.string().optional(),
  parentId: z.string().optional(),
});

const InputSchema = z.object({
  items: z.array(IssueCreateItem).min(1).max(50),
  parallel: z.boolean().optional(),
});

export const createIssuesTool = defineTool({
  name: toolsMetadata.create_issues.name,
  title: toolsMetadata.create_issues.title,
  description: toolsMetadata.create_issues.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);
    const { items } = args;
    const teamAllowZeroCache = createTeamSettingsCache();

    const results: {
      index: number;
      ok: boolean;
      id?: string;
      identifier?: string;
      error?: string;
      code?: string;
    }[] = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i] as (typeof items)[number];
      try {
        const payloadInput: Record<string, unknown> = {
          teamId: it.teamId,
          title: it.title,
        };

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
        } else {
          // Default to current user
          try {
            const me = await client.viewer;
            const meId = (me as unknown as { id?: string })?.id;
            if (meId) {
              payloadInput.assigneeId = meId;
            }
          } catch {}
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
        const estimate = await validateEstimate(
          it.estimate,
          it.teamId,
          teamAllowZeroCache,
          client,
          undefined,
        );
        if (estimate !== undefined) {
          payloadInput.estimate = estimate;
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

        const call = () =>
          client.createIssue(
            payloadInput as unknown as {
              teamId: string;
              title: string;
              description?: string;
              stateId?: string;
              labelIds?: string[];
              assigneeId?: string;
              projectId?: string;
              priority?: number;
              estimate?: number;
              dueDate?: string;
              parentId?: string;
            },
          );

        const payload = args.parallel === true ? await call() : await gate(call);

        results.push({
          index: i,
          ok: payload.success ?? true,
          id: (payload.issue as unknown as { id?: string })?.id,
          identifier: (payload.issue as unknown as { identifier?: string })?.identifier,
        });
      } catch (error) {
        await logger.error('create_issues', {
          message: 'Failed to create issue',
          index: i,
          error: (error as Error).message,
        });
        results.push({
          index: i,
          ok: false,
          error: (error as Error).message,
          code: 'LINEAR_CREATE_ERROR',
        });
      }
    }

    const summary = {
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };

    const structured = CreateIssuesOutputSchema.parse({ results, summary });

    const okIds = results
      .filter((r) => r.ok)
      .map((r) => r.identifier ?? r.id ?? `item[${String(r.index)}]`) as string[];

    const failures = results
      .filter((r) => !r.ok)
      .map((r) => ({ index: r.index, error: r.error ?? '', code: undefined }));

    // Compose a richer message with links for created items
    const failureHints: string[] = [];
    if (summary.failed > 0) {
      failureHints.push(
        "If 'assigneeId' was invalid, fetch viewer id via 'workspace_metadata' (include: ['profile']) and use it to assign to yourself.",
      );
      failureHints.push(
        "Alternatively use 'list_users' to find the correct user id, or omit 'assigneeId' and assign later with 'update_issues'.",
      );
    }

    const summaryText = summarizeBatch({
      action: 'Created issues',
      ok: summary.ok,
      total: items.length,
      okIdentifiers: okIds,
      failures,
      nextSteps: [
        'Use list_issues (filter by id or by number+team.key/team.id, limit=1) to verify details, or update_issues to modify.',
        ...failureHints,
      ],
    });

    const detailLines: string[] = [];
    for (const r of results.filter((r) => r.ok)) {
      try {
        const issue = await client.issue(r.id ?? (r.identifier as string));
        const idf = (issue as unknown as { identifier?: string })?.identifier ?? issue.id;
        const url = (issue as unknown as { url?: string })?.url as string | undefined;
        const title = issue.title;

        let stateName: string | undefined;
        let projectName: string | undefined;
        let assigneeName: string | undefined;
        try {
          const s = await (issue as unknown as { state?: Promise<{ name?: string }> }).state;
          stateName = s?.name ?? undefined;
        } catch {}
        try {
          const p = await (issue as unknown as { project?: Promise<{ name?: string }> }).project;
          projectName = p?.name ?? undefined;
        } catch {}
        try {
          const a = await (issue as unknown as { assignee?: Promise<{ name?: string }> }).assignee;
          assigneeName = a?.name ?? undefined;
        } catch {}

        let labelsList = '';
        try {
          labelsList = (await issue.labels()).nodes
            .map((l) => l.name)
            .slice(0, 5)
            .join(', ');
        } catch {}

        const dueDate = (issue as unknown as { dueDate?: string })?.dueDate;
        const priorityVal = (issue as unknown as { priority?: number })?.priority;

        const header = url ? `[${idf} — ${title}](${url})` : `${idf} — ${title}`;

        const partsLine: string[] = [];
        if (stateName) partsLine.push(`state ${stateName}`);
        if (projectName) partsLine.push(`project ${projectName}`);
        if (labelsList) partsLine.push(`labels ${labelsList}`);
        if (typeof priorityVal === 'number') partsLine.push(`priority ${priorityVal}`);
        if (dueDate) partsLine.push(`due ${dueDate}`);
        if (assigneeName) partsLine.push(`assignee ${assigneeName}`);

        const line = partsLine.length > 0 ? `${header} — ${partsLine.join('; ')}` : header;
        detailLines.push(`- ${line}`);
      } catch {}
    }

    const text =
      detailLines.length > 0
        ? `${summaryText}\n\n${detailLines.join('\n')}`
        : summaryText;

    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});


