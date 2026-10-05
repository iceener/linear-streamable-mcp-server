import { z } from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { delay, makeConcurrencyGate, withRetry } from './shared/limits';
import { CONCURRENCY_LIMIT, withLinear } from './shared/linear';
import { summarizeBatch } from './shared/messages';
import { type BatchResultSchema, UpdateProjectsOutputSchema } from './shared/outputs';

// Update Projects
const UpdateProjectsInputSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().describe('Project UUID. Required.'),
        name: z.string().optional().describe('New project name.'),
        description: z.string().optional().describe('New markdown description.'),
        leadId: z.string().optional().describe('New lead user UUID.'),
        targetDate: z.string().optional().describe('New target date (YYYY-MM-DD).'),
        state: z
          .string()
          .optional()
          .describe("New state: 'planned', 'started', 'paused', 'completed', 'canceled'."),
        archived: z.boolean().optional().describe('Set true to archive, false to unarchive.'),
      }),
    )
    .min(1)
    .max(50)
    .describe('Projects to update.'),
});

export const updateProjects = defineTool(
  'update_projects',
  {
    title: 'Update Projects (Batch)',
    description:
      "Update multiple projects in one call. Inputs: { items: Array<{ id: string; name?: string; description?: string; targetDate?: string; state?: string; leadId?: string; archived?: boolean }> }.\nReturns: per-item results and a summary. Next: verify with 'list_projects' (filter.id.eq, limit=1); discover via 'list_projects'.",
    inputSchema: UpdateProjectsInputSchema,
    outputSchema: UpdateProjectsOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  (args, ctx, deps) =>
    withLinear(ctx, deps, async (context) => {
      const client = context.client();
      const gate = makeConcurrencyGate(CONCURRENCY_LIMIT);

      const results: Array<z.input<typeof BatchResultSchema>> = [];

      for (let i = 0; i < args.items.length; i++) {
        const it = args.items[i] as (typeof args.items)[number];
        try {
          if (context.signal?.aborted) {
            throw new Error('Operation aborted');
          }

          // Add small delay between requests to avoid rate limits
          if (i > 0) {
            await delay(100);
          }

          const updatePayload: Record<string, unknown> = {};
          if (it.name) updatePayload.name = it.name;
          if (it.description) updatePayload.description = it.description;
          if (it.leadId) updatePayload.leadId = it.leadId;
          if (it.targetDate) updatePayload.targetDate = it.targetDate;
          if (it.state) updatePayload.state = it.state;

          const call = () => client.updateProject(it.id, updatePayload);

          const result = await withRetry(() => (args.items.length > 1 ? gate(call) : call()), {
            maxRetries: 3,
            baseDelayMs: 500,
          });

          // Handle archive/unarchive
          if (typeof it.archived === 'boolean') {
            try {
              if (it.archived) {
                await client.archiveProject(it.id);
              } else {
                await client.unarchiveProject(it.id);
              }
            } catch {
              // Ignore archive errors to preserve other updates
            }
          }

          results.push({
            input: { id: it.id, name: it.name, state: it.state },
            success: result.success ?? true,
            id: it.id,
            // Legacy
            index: i,
            ok: result.success ?? true,
          });
        } catch (error) {
          context.logger.error('Failed to update project', {
            tool: 'update_projects',
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
              suggestions: ['Verify project ID with list_projects.'],
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
        total: args.items.length,
        succeeded,
        failed,
        ok: succeeded,
      };

      const meta = {
        nextSteps: ['Use list_projects to verify changes.'],
        relatedTools: ['list_projects', 'list_issues'],
      };

      const structured = UpdateProjectsOutputSchema.parse({ results, summary, meta });

      const okIds = results
        .filter((r) => r.ok)
        .map((r) => r.id ?? `item[${String(r.index)}]`) as string[];

      const failures = results
        .filter((r) => !r.ok)
        .map((r) => {
          const err = r.error;
          if (typeof err === 'object' && err !== null) {
            const errObj = err as { message?: string; code?: string };
            return {
              index: r.index ?? -1,
              id: r.id,
              error: errObj.message ?? String(err),
              code: errObj.code,
            };
          }
          return {
            index: r.index ?? -1,
            id: r.id,
            error: String(err ?? ''),
            code: undefined,
          };
        });

      const text = summarizeBatch({
        action: 'Updated projects',
        ok: summary.ok,
        total: args.items.length,
        okIdentifiers: okIds,
        failures,
        nextSteps: ['Call list_projects to verify changes.'],
      });

      const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

      if (context.includeJsonInContent) {
        parts.push({ type: 'text', text: JSON.stringify(structured) });
      }

      return { content: parts, structuredContent: structured };
    }),
);
