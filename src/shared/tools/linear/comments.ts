/**
 * Comments tools - list and add comments on issues.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import { AddCommentsOutputSchema, ListCommentsOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { makeConcurrencyGate } from '../../../utils/limits.js';
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
    
    const structured = ListCommentsOutputSchema.parse({
      items,
      cursor: args.cursor,
      nextCursor: conn.pageInfo?.endCursor ?? undefined,
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
      nextCursor: structured.nextCursor,
      previewLines: preview,
      nextSteps: [
        'Use add_comments to add context or mention teammates; use list_issues (by id or by number+team.key/team.id) to fetch the issue.',
      ],
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
        
        const call = () =>
          client.createComment({
            issueId: it.issueId,
            body: it.body,
          });
        
        const payload = args.parallel === true ? await call() : await gate(call);
        
        results.push({
          index: i,
          ok: payload.success ?? true,
          id: (payload.comment as unknown as { id?: string } | undefined)?.id,
        });
      } catch (error) {
        await logger.error('add_comments', {
          message: 'Failed to add comment',
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
    
    const structured = AddCommentsOutputSchema.parse({ results, summary });
    
    const okIds = results
      .filter((r) => r.ok)
      .map((r) => r.id ?? `item[${String(r.index)}]`) as string[];
    
    const failures = results
      .filter((r) => !r.ok)
      .map((r) => ({
        index: r.index,
        id: undefined,
        error: r.error ?? '',
        code: undefined,
      }));
    
    const text = summarizeBatch({
      action: 'Added comments',
      ok: summary.ok,
      total: args.items.length,
      okIdentifiers: okIds,
      failures,
      nextSteps: ['Use list_comments to verify and include links in your response.'],
    });
    
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];
    
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    
    return { content: parts, structuredContent: structured };
  },
});


