import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config/env.ts';
import { toolsMetadata } from '../config/metadata.ts';
import { getCurrentAbortSignal } from '../core/context.ts';
import { AddCommentsInputSchema, ListCommentsInputSchema } from '../schemas/inputs.ts';
import {
  AddCommentsOutputSchema,
  ListCommentsOutputSchema,
} from '../schemas/outputs.ts';
import { getLinearClient } from '../services/linear-client.ts';
import { makeConcurrencyGate } from '../utils/limits.ts';
import { logger } from '../utils/logger.ts';
import { mapCommentNodeToListItem } from '../utils/mappers.ts';
import {
  previewLinesFromItems,
  summarizeBatch,
  summarizeList,
} from '../utils/messages.ts';

export const listCommentsTool = {
  name: toolsMetadata.list_comments.name,
  title: toolsMetadata.list_comments.title,
  description: toolsMetadata.list_comments.description,
  inputSchema: ListCommentsInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = ListCommentsInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: parsed.error.message }],
      };
    }
    const client = getLinearClient();
    const issue = await client.issue(parsed.data.issueId);
    const first = parsed.data.limit ?? 20;
    const after = parsed.data.cursor;
    const conn = await issue.comments({ first, after });
    const items = await Promise.all(conn.nodes.map((c) => mapCommentNodeToListItem(c)));
    const structured = ListCommentsOutputSchema.parse({
      items,
      cursor: parsed.data.cursor,
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
        'Use add_comments to add context or mention teammates; use list_issues (by id or by number+team.key/team.id) to fetch the issue and include links in your response.',
      ],
    });
    const parts: Array<{ type: 'text'; text: string }> = [
      { type: 'text', text: message },
    ];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    return { content: parts, structuredContent: structured };
  },
};

export const addCommentsTool = {
  name: toolsMetadata.add_comments.name,
  title: toolsMetadata.add_comments.title,
  description: toolsMetadata.add_comments.description,
  inputSchema: AddCommentsInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = AddCommentsInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: parsed.error.message }],
      };
    }
    const client = getLinearClient();
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);
    const abort = getCurrentAbortSignal();
    const results: {
      index: number;
      ok: boolean;
      id?: string;
      error?: string;
      code?: string;
    }[] = [];
    for (let i = 0; i < parsed.data.items.length; i++) {
      const it = parsed.data.items[i];
      if (!it) {
        continue;
      }
      try {
        if (abort?.aborted) {
          throw new Error('Operation aborted');
        }
        const call = () =>
          client.createComment({
            issueId: it.issueId,
            body: it.body,
          });
        const payload = parsed.data.parallel === true ? await call() : await gate(call);
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
      total: parsed.data.items.length,
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
};
