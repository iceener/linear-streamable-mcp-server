/**
 * Create Issues tool - batch create issues in Linear.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import { CreateIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { makeConcurrencyGate, withRetry, delay } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { summarizeBatch } from '../../../utils/messages.js';
import { resolveAssignee } from '../../../utils/user-resolver.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';
import { createTeamSettingsCache, validateEstimate, validatePriority } from './shared/index.js';

const IssueCreateItem = z.object({
  teamId: z.string().describe('Team UUID. Required.'),
  title: z.string().describe('Issue title. Required.'),
  description: z.string().optional().describe('Markdown description.'),
  stateId: z
    .string()
    .optional()
    .describe('Workflow state UUID. Get from workspace_metadata.workflowStatesByTeam.'),
  labelIds: z.array(z.string()).optional().describe('Label UUIDs to attach.'),
  assigneeId: z
    .string()
    .optional()
    .describe('User UUID. If omitted, defaults to current viewer. Use assigneeName or assigneeEmail for name-based lookup.'),
  assigneeName: z
    .string()
    .optional()
    .describe('User name to assign (fuzzy match). Resolved to assigneeId automatically. Example: "John" matches "John Smith".'),
  assigneeEmail: z
    .string()
    .optional()
    .describe('User email to assign (exact match, case-insensitive). Resolved to assigneeId automatically.'),
  projectId: z.string().optional().describe('Project UUID to associate.'),
  priority: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe('Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low.'),
  estimate: z.number().optional().describe('Story points / estimate value.'),
  allowZeroEstimate: z
    .boolean()
    .optional()
    .describe('If true and estimate=0, sends 0. Otherwise zero is omitted to avoid team validation errors.'),
  dueDate: z.string().optional().describe('Due date in ISO format (YYYY-MM-DD).'),
  parentId: z.string().optional().describe('Parent issue UUID for sub-issues.'),
});

const InputSchema = z.object({
  items: z.array(IssueCreateItem).min(1).max(50).describe('Issues to create.'),
  parallel: z.boolean().optional().describe('Run in parallel. Default: sequential.'),
  dry_run: z.boolean().optional().describe('If true, validate but do not create.'),
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
    // Handle dry_run mode
    if (args.dry_run) {
      const validated = args.items.map((it, index) => ({
        index,
        ok: true,
        title: it.title,
        teamId: it.teamId,
        validated: true,
      }));
      return {
        content: [
          {
            type: 'text',
            text: `Dry run: ${args.items.length} issue(s) validated successfully. No changes made.`,
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

        // Resolve assignee from ID, name, or email
        const assigneeResult = await resolveAssignee(client, {
          assigneeId: it.assigneeId,
          assigneeName: it.assigneeName,
          assigneeEmail: it.assigneeEmail,
        });

        if (!assigneeResult.success && assigneeResult.error) {
          // User resolution failed - report error but continue batch
          results.push({
            input: { title: it.title, teamId: it.teamId, assigneeName: it.assigneeName, assigneeEmail: it.assigneeEmail },
            success: false,
            error: {
              code: assigneeResult.error.code,
              message: assigneeResult.error.message,
              suggestions: assigneeResult.error.suggestions,
            },
            // Legacy
            index: i,
            ok: false,
          });
          continue;
        }

        if (assigneeResult.user?.id) {
          payloadInput.assigneeId = assigneeResult.user.id;
        } else {
          // Default to current user when no assignee specified
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
          it.allowZeroEstimate,
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

        // Add small delay between requests to avoid rate limits
        if (i > 0) {
          await delay(100);
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

        const payload = await withRetry(
          () => (args.parallel === true ? call() : gate(call)),
          { maxRetries: 3, baseDelayMs: 500 },
        );

        const issue = await payload.issue;
        const issueUrl = (issue as unknown as { url?: string })?.url;

        results.push({
          // Echo input for context
          input: { title: it.title, teamId: it.teamId, assigneeName: it.assigneeName, assigneeEmail: it.assigneeEmail },
          success: payload.success ?? true,
          id: (issue as unknown as { id?: string })?.id,
          identifier: (issue as unknown as { identifier?: string })?.identifier,
          url: issueUrl,
          // Legacy
          index: i,
          ok: payload.success ?? true,
        });
      } catch (error) {
        await logger.error('create_issues', {
          message: 'Failed to create issue',
          index: i,
          error: (error as Error).message,
        });
        results.push({
          // Echo input for context
          input: { title: it.title, teamId: it.teamId, assigneeName: it.assigneeName, assigneeEmail: it.assigneeEmail },
          success: false,
          error: {
            code: 'LINEAR_CREATE_ERROR',
            message: (error as Error).message,
            suggestions: [
              "Verify teamId with workspace_metadata.",
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
      'Use list_issues or get_issues to verify created issues.',
      'Use update_issues to modify state, assignee, or labels.',
    ];
    if (failed > 0) {
      metaNextSteps.push("Check error.suggestions for recovery hints.");
      metaNextSteps.push("Use workspace_metadata to verify IDs.");
    }

    const meta = {
      nextSteps: metaNextSteps,
      relatedTools: ['list_issues', 'get_issues', 'update_issues', 'add_comments'],
    };

    const structured = CreateIssuesOutputSchema.parse({ results, summary, meta });

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







