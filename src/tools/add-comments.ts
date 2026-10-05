import { z } from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { delay, makeConcurrencyGate, withRetry } from './shared/limits';
import { CONCURRENCY_LIMIT, withLinear } from './shared/linear';
import { summarizeBatch } from './shared/messages';
import { AddCommentsOutputSchema, type BatchResultSchema } from './shared/outputs';

// Add Comments
const AddCommentsInputSchema = z.object({
  items: z
    .array(
      z.object({
        issueId: z.string(),
        body: z.string(),
      }),
    )
    .min(1)
    .max(50),
  parallel: z.boolean().optional(),
});

export const addComments = defineTool(
  'add_comments',
  {
    title: 'Add Comments (Batch)',
    description:
      'Add one or more comments to issues. Inputs: { items: Array<{ issueId: string; body: string }>, parallel?, dry_run? }.\nReturns: per-item results and a summary. Next: Use list_comments to verify and retrieve the comment URLs.',
    inputSchema: AddCommentsInputSchema,
    outputSchema: AddCommentsOutputSchema,
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
        const it = args.items[i];
        if (!it) continue;

        try {
          if (context.signal?.aborted) {
            throw new Error('Operation aborted');
          }

          // Add small delay between requests to avoid rate limits
          if (i > 0) {
            await delay(100);
          }

          const call = () =>
            client.createComment({
              issueId: it.issueId,
              body: it.body,
            });

          const payload = await withRetry(() => (args.parallel === true ? call() : gate(call)), {
            maxRetries: 3,
            baseDelayMs: 500,
          });

          results.push({
            input: {
              issueId: it.issueId,
              body: it.body.slice(0, 50) + (it.body.length > 50 ? '...' : ''),
            },
            success: payload.success ?? true,
            id: (payload.comment as unknown as { id?: string } | undefined)?.id,
            // Legacy
            index: i,
            ok: payload.success ?? true,
          });
        } catch (error) {
          context.logger.error('Failed to add comment', {
            tool: 'add_comments',
            index: i,
            error: (error as Error).message,
          });
          results.push({
            input: {
              issueId: it.issueId,
              body: it.body.slice(0, 50) + (it.body.length > 50 ? '...' : ''),
            },
            success: false,
            error: {
              code: 'LINEAR_CREATE_ERROR',
              message: (error as Error).message,
              suggestions: ['Verify issueId with list_issues or get_issues.'],
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
        nextSteps: ['Use list_comments to verify and retrieve URLs.'],
        relatedTools: ['list_comments', 'update_comments', 'get_issues'],
      };

      const structured = AddCommentsOutputSchema.parse({ results, summary, meta });

      const failures = results
        .filter((r) => !r.success)
        .map((r) => ({
          index: r.index ?? -1,
          id: typeof r.input?.issueId === 'string' ? r.input.issueId : undefined,
          error: typeof r.error === 'object' ? r.error.message : (r.error ?? ''),
          code: typeof r.error === 'object' ? r.error.code : undefined,
        }));

      // Don't show comment UUIDs (not helpful), just the count
      const text = summarizeBatch({
        action: 'Added comments',
        ok: succeeded,
        total: args.items.length,
        // Skip okIdentifiers - comment UUIDs aren't useful to show
        failures,
        nextSteps:
          succeeded > 0
            ? ['Use list_comments to verify and get comment URLs.']
            : ['Check issueId values with list_issues.'],
      });

      const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

      if (context.includeJsonInContent) {
        parts.push({ type: 'text', text: JSON.stringify(structured) });
      }

      return { content: parts, structuredContent: structured };
    }),
);
