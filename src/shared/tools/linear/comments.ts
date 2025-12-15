/**
 * Comments tools - list and add comments on issues.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import {
  AddCommentsOutputSchema,
  ListCommentsOutputSchema,
  UpdateCommentsOutputSchema,
} from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { makeConcurrencyGate, withRetry, delay } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { mapCommentNodeToListItem } from '../../../utils/mappers.js';
import { summarizeBatch, summarizeList, previewLinesFromItems } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

// List Comments
const ListCommentsInputSchema = z.object({
  issueId: z.string(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const listCommentsTool = defineTool({
  name: toolsMetadata.list_comments.name,
  title: toolsMetadata.list_comments.title,
  description: toolsMetadata.list_comments.description,
  inputSchema: ListCommentsInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const issue = await client.issue(args.issueId);
    const first = args.limit ?? 20;
    const after = args.cursor;
    const conn = await issue.comments({ first, after });
    const items = await Promise.all(conn.nodes.map((c) => mapCommentNodeToListItem(c)));
    
    const hasMore = !!conn.pageInfo?.endCursor;
    const nextCursor = conn.pageInfo?.endCursor ?? undefined;

    // Build query echo
    const query = {
      issueId: args.issueId,
      limit: first,
    };

    // Build pagination
    const pagination = {
      hasMore,
      nextCursor,
      itemsReturned: items.length,
      limit: first,
    };

    // Build meta
    const meta = {
      nextSteps: [
        ...(hasMore ? [`Call again with cursor="${nextCursor}" for more.`] : []),
        'Use add_comments to add context or mention teammates.',
        'Use update_comments to edit existing comments.',
      ],
      relatedTools: ['add_comments', 'update_comments', 'get_issues'],
    };

    const structured = ListCommentsOutputSchema.parse({
      query,
      items,
      pagination,
      meta,
      // Legacy
      cursor: args.cursor,
      nextCursor,
      limit: first,
    });
    
    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (c) => {
        const user = c.user as unknown as { name?: string; id?: string } | undefined;
        const author = user?.name ?? user?.id ?? 'unknown';
        const body = String((c.body as string | undefined) ?? '').slice(0, 80);
        const url = (c.url as string | undefined) ?? undefined;
        const title = url ? `[${author}](${url})` : author;
        return `${title}: ${body}`;
      },
    );
    
    const message = summarizeList({
      subject: 'Comments',
      count: items.length,
      limit: first,
      nextCursor,
      previewLines: preview,
      nextSteps: meta.nextSteps,
    });
    
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: message }];
    
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    
    return { content: parts, structuredContent: structured };
  },
});

// Add Comments
const AddCommentsInputSchema = z.object({
  items: z.array(z.object({
    issueId: z.string(),
    body: z.string(),
  })).min(1).max(50),
  parallel: z.boolean().optional(),
});

export const addCommentsTool = defineTool({
  name: toolsMetadata.add_comments.name,
  title: toolsMetadata.add_comments.title,
  description: toolsMetadata.add_comments.description,
  inputSchema: AddCommentsInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);
    
    const results: {
      index: number;
      ok: boolean;
      id?: string;
      error?: string;
      code?: string;
    }[] = [];
    
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
        
        const payload = await withRetry(
          () => (args.parallel === true ? call() : gate(call)),
          { maxRetries: 3, baseDelayMs: 500 },
        );
        
        results.push({
          input: { issueId: it.issueId, body: it.body.slice(0, 50) + (it.body.length > 50 ? '...' : '') },
          success: payload.success ?? true,
          id: (payload.comment as unknown as { id?: string } | undefined)?.id,
          // Legacy
          index: i,
          ok: payload.success ?? true,
        });
      } catch (error) {
        await logger.error('add_comments', {
          message: 'Failed to add comment',
          index: i,
          error: (error as Error).message,
        });
        results.push({
          input: { issueId: it.issueId, body: it.body.slice(0, 50) + (it.body.length > 50 ? '...' : '') },
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
        index: r.index,
        id: r.input?.issueId,
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
      nextSteps: succeeded > 0 
        ? ['Use list_comments to verify and get comment URLs.']
        : ['Check issueId values with list_issues.'],
    });
    
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];
    
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    
    return { content: parts, structuredContent: structured };
  },
});

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

export const updateCommentsTool = defineTool({
  name: toolsMetadata.update_comments.name,
  title: toolsMetadata.update_comments.title,
  description: toolsMetadata.update_comments.description,
  inputSchema: UpdateCommentsInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);

    const results: {
      index: number;
      ok: boolean;
      id?: string;
      error?: string;
      code?: string;
    }[] = [];

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

        const payload = await withRetry(
          () => (gate(call)),
          { maxRetries: 3, baseDelayMs: 500 },
        );

        results.push({
          input: { id: it.id, body: it.body.slice(0, 50) + (it.body.length > 50 ? '...' : '') },
          success: payload.success ?? true,
          id: it.id,
          // Legacy
          index: i,
          ok: payload.success ?? true,
        });
      } catch (error) {
        await logger.error('update_comments', {
          message: 'Failed to update comment',
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
        index: r.index,
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
      nextSteps: succeeded > 0 
        ? ['Use list_comments to verify changes.']
        : ['Check comment IDs with list_comments first.'],
    });

    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});



