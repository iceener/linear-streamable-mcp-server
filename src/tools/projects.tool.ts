import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config/env.ts';
import { toolsMetadata } from '../config/metadata.ts';
import { getCurrentAbortSignal } from '../core/context.ts';
import {
  CreateProjectsInputSchema,
  GetProjectInputSchema,
  ListProjectsInputSchema,
  UpdateProjectsInputSchema,
} from '../schemas/inputs.ts';
import {
  CreateProjectsOutputSchema,
  ListProjectsOutputSchema,
  UpdateProjectsOutputSchema,
} from '../schemas/outputs.ts';
import { getLinearClient } from '../services/linear-client.ts';
import { makeConcurrencyGate } from '../utils/limits.ts';
import { logger } from '../utils/logger.ts';
import { mapProjectNodeToListItem } from '../utils/mappers.ts';
import {
  previewLinesFromItems,
  summarizeBatch,
  summarizeList,
} from '../utils/messages.ts';

export const listProjectsTool = {
  name: toolsMetadata.list_projects.name,
  title: toolsMetadata.list_projects.title,
  description: toolsMetadata.list_projects.description,
  inputSchema: ListProjectsInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = ListProjectsInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: parsed.error.message }],
      };
    }
    const client = getLinearClient();
    const first = parsed.data.limit ?? 20;
    const after = parsed.data.cursor;
    const filter =
      (parsed.data.filter as Record<string, unknown> | undefined) ?? undefined;
    const conn = await client.projects({
      first,
      after,
      filter: filter as Record<string, unknown> | undefined,
      includeArchived: parsed.data.includeArchived,
    });
    const items = conn.nodes.map((p) => mapProjectNodeToListItem(p));
    const structured = ListProjectsOutputSchema.parse({
      items,
      cursor: parsed.data.cursor,
      nextCursor: conn.pageInfo?.endCursor ?? undefined,
      limit: first,
    });
    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (p) =>
        `${String((p.name as string) ?? '')} (${p.id}) — state ${String(
          (p.state as string) ?? '',
        )}`,
    );
    const message = summarizeList({
      subject: 'Projects',
      count: items.length,
      limit: first,
      nextCursor: structured.nextCursor,
      previewLines: preview,
      nextSteps: [
        'For a single project, call list_projects with filter.id.eq and limit=1; filter by state/team/lead to narrow; pass cursor for next page.',
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

export const getProjectTool = {
  name: toolsMetadata.get_project.name,
  title: toolsMetadata.get_project.title,
  description: toolsMetadata.get_project.description,
  inputSchema: GetProjectInputSchema.shape,
  handler: async (_args: unknown): Promise<CallToolResult> => {
    // Deprecated: advise clients to use list_projects with filter.id.eq and limit=1
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: "'get_project' is deprecated. Use 'list_projects' with filter.id.eq and limit=1 to fetch a single project.",
        },
      ],
    };
  },
};

export const createProjectsTool = {
  name: toolsMetadata.create_projects.name,
  title: toolsMetadata.create_projects.title,
  description: toolsMetadata.create_projects.description,
  inputSchema: CreateProjectsInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = CreateProjectsInputSchema.safeParse(args);
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
      try {
        if (abort?.aborted) {
          throw new Error('Operation aborted');
        }
        const call = () =>
          client.createProject({
            name: it.name,
            description: it.description,
            leadId: it.leadId,
            targetDate: it.targetDate,
            teamIds: it.teamId ? [it.teamId] : [],
          });
        const payload = parsed.data.items.length > 1 ? await gate(call) : await call();
        results.push({
          index: i,
          ok: payload.success ?? true,
          id: (payload.project as { id?: string } | null | undefined)?.id,
        });
      } catch (error) {
        await logger.error('create_projects', {
          message: 'Failed to create project',
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
    const structured = CreateProjectsOutputSchema.parse({ results, summary });
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
      action: 'Created projects',
      ok: summary.ok,
      total: parsed.data.items.length,
      okIdentifiers: okIds,
      failures,
      nextSteps: ['Use get_project to verify; update_projects to modify.'],
    });
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    return { content: parts, structuredContent: structured };
  },
};

export const updateProjectsTool = {
  name: toolsMetadata.update_projects.name,
  title: toolsMetadata.update_projects.title,
  description: toolsMetadata.update_projects.description,
  inputSchema: UpdateProjectsInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = UpdateProjectsInputSchema.safeParse(args);
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
      try {
        if (abort?.aborted) {
          throw new Error('Operation aborted');
        }
        const call = () =>
          client.updateProject(it.id, {
            name: it.name,
            description: it.description,
            leadId: it.leadId,
            targetDate: it.targetDate,
            // ProjectUpdateInput: omit unsupported fields; handle archive via dedicated API if needed
          });
        const payload = parsed.data.items.length > 1 ? await gate(call) : await call();
        results.push({ index: i, ok: payload.success ?? true, id: it.id });
      } catch (error) {
        await logger.error('update_projects', {
          message: 'Failed to update project',
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
    const structured = UpdateProjectsOutputSchema.parse({ results, summary });
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
    const text = summarizeBatch({
      action: 'Updated projects',
      ok: summary.ok,
      total: parsed.data.items.length,
      okIdentifiers: okIds,
      failures,
      nextSteps: ['Call get_project to verify changes.'],
    });
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    return { content: parts, structuredContent: structured };
  },
};
