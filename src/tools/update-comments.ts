import { z } from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { delay, makeConcurrencyGate, withRetry } from './shared/limits';
import { CONCURRENCY_LIMIT, withLinear } from './shared/linear';
import { summarizeBatch } from './shared/messages';
import { type BatchResultSchema, UpdateCommentsOutputSchema } from './shared/outputs';

// Update Comments
const UpdateCommentsInputSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().describe('Comment ID to update.'),
        body: z.string().min(1).describe('New comment body (cannot be empty).'),
      }),
    )
    .min(1)
    .max(50),
});

export const updateComments = defineTool(
  'update_comments',
  {
    title: 'Update Comments (Batch)',
    description:
      'Update existing comment bodies. Cannot delete comments (by design). Inputs: { items: Array<{ id: string; body: string }> }.\nReturns: per-item results and a summary. Next: Use list_comments to verify changes.',
    inputSchema: UpdateCommentsInputSchema,
    outputSchema: UpdateCommentsOutputSchema,
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
            client.updateComment(it.id, {
              body: it.body,
            });

          const payload = await withRetry(() => gate(call), {
            maxRetries: 3,
            baseDelayMs: 500,
          });

          results.push({
            input: {
              id: it.id,
              body: it.body.slice(0, 50) + (it.body.length > 50 ? '...' : ''),
            },
            success: payload.success ?? true,
            id: it.id,
            // Legacy
            index: i,
            ok: payload.success ?? true,
          });
        } catch (error) {
          context.logger.error('Failed to update comment', {
            tool: 'update_comments',
            index: i,
            error: (error as Error).message,
          });
          results.push({
            input: { id: it.id },
            success: false,
            id: it.id,
            error: {
              code: 'LINEAR_UPDATE_ERROR',
              message: (error as Error).message,
              suggestions: ['Verify comment ID with list_comments.'],
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
        nextSteps: ['Use list_comments to verify changes.'],
        relatedTools: ['list_comments', 'add_comments'],
      };

      const structured = UpdateCommentsOutputSchema.parse({ results, summary, meta });

      const failures = results
        .filter((r) => !r.success)
        .map((r) => ({
          index: r.index ?? -1,
          id: r.id,
          error: typeof r.error === 'object' ? r.error.message : (r.error ?? ''),
          code: typeof r.error === 'object' ? r.error.code : undefined,
        }));

      // Don't show comment UUIDs (not helpful), just the count
      const text = summarizeBatch({
        action: 'Updated comments',
        ok: succeeded,
        total: args.items.length,
        failures,
        nextSteps:
          succeeded > 0
            ? ['Use list_comments to verify changes.']
            : ['Check comment IDs with list_comments first.'],
      });

      const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

      if (context.includeJsonInContent) {
        parts.push({ type: 'text', text: JSON.stringify(structured) });
      }

      return { content: parts, structuredContent: structured };
    }),
);
