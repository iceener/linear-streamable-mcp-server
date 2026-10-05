import { z } from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { delay, makeConcurrencyGate, withRetry } from './shared/limits';
import { CONCURRENCY_LIMIT, withLinear } from './shared/linear';
import { summarizeBatch } from './shared/messages';
import { type BatchResultSchema, CreateProjectsOutputSchema } from './shared/outputs';

// Create Projects
const CreateProjectsInputSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().describe('Project name. Required.'),
        description: z.string().optional().describe('Markdown description.'),
        teamId: z.string().optional().describe('Team UUID to associate.'),
        leadId: z.string().optional().describe('Lead user UUID.'),
        targetDate: z.string().optional().describe('Target date (YYYY-MM-DD).'),
      }),
    )
    .min(1)
    .max(50)
    .describe('Projects to create. Use update_projects to change state after creation.'),
});

export const createProjects = defineTool(
  'create_projects',
  {
    title: 'Create Projects (Batch)',
    description:
      'Create multiple projects in one call. Inputs: { items: Array<{ name: string; teamId?: string; leadId?: string; description?: string; targetDate?: string; state?: string }> }.\nNotes: team association uses teamIds internally; provide teamId to attach initially. Returns: per-item results and a summary.',
    inputSchema: CreateProjectsInputSchema,
    outputSchema: CreateProjectsOutputSchema,
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

          const call = () =>
            client.createProject({
              name: it.name,
              description: it.description,
              leadId: it.leadId,
              targetDate: it.targetDate,
              teamIds: it.teamId ? [it.teamId] : [],
            } as Parameters<typeof client.createProject>[0]);

          const payload = await withRetry(() => (args.items.length > 1 ? gate(call) : call()), {
            maxRetries: 3,
            baseDelayMs: 500,
          });

          results.push({
            input: { name: it.name, teamId: it.teamId },
            success: payload.success ?? true,
            id: (payload.project as { id?: string } | null | undefined)?.id,
            // Legacy
            index: i,
            ok: payload.success ?? true,
          });
        } catch (error) {
          context.logger.error('Failed to create project', {
            tool: 'create_projects',
            index: i,
            error: (error as Error).message,
          });
          results.push({
            input: { name: it.name, teamId: it.teamId },
            success: false,
            error: {
              code: 'LINEAR_CREATE_ERROR',
              message: (error as Error).message,
              suggestions: ['Verify teamId with workspace_metadata.'],
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
        nextSteps: ['Use list_projects to verify.', 'Use update_projects to modify.'],
        relatedTools: ['list_projects', 'update_projects', 'list_issues'],
      };

      const structured = CreateProjectsOutputSchema.parse({ results, summary, meta });

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
              id: undefined,
              error: errObj.message ?? String(err),
              code: errObj.code,
            };
          }
          return {
            index: r.index ?? -1,
            id: undefined,
            error: String(err ?? ''),
            code: undefined,
          };
        });

      const text = summarizeBatch({
        action: 'Created projects',
        ok: summary.ok,
        total: args.items.length,
        okIdentifiers: okIds,
        failures,
        nextSteps: ['Use list_projects to verify; update_projects to modify.'],
      });

      const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

      if (context.includeJsonInContent) {
        parts.push({ type: 'text', text: JSON.stringify(structured) });
      }

      return { content: parts, structuredContent: structured };
    }),
);
