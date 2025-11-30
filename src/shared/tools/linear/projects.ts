/**
 * Projects tools - list, create, and update projects.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import {
  CreateProjectsOutputSchema,
  ListProjectsOutputSchema,
  UpdateProjectsOutputSchema,
} from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { makeConcurrencyGate } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { mapProjectNodeToListItem } from '../../../utils/mappers.js';
import { summarizeBatch, summarizeList, previewLinesFromItems } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

// List Projects
const ListProjectsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  filter: z.record(z.any()).optional(),
  includeArchived: z.boolean().optional(),
});

export const listProjectsTool = defineTool({
  name: toolsMetadata.list_projects.name,
  title: toolsMetadata.list_projects.title,
  description: toolsMetadata.list_projects.description,
  inputSchema: ListProjectsInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const first = args.limit ?? 20;
    const after = args.cursor;
    const filter = args.filter as Record<string, unknown> | undefined;
    
    const conn = await client.projects({
      first,
      after,
      filter: filter as Record<string, unknown> | undefined,
      includeArchived: args.includeArchived,
    });
    
    const items = conn.nodes.map((p) => mapProjectNodeToListItem(p));
    
    const structured = ListProjectsOutputSchema.parse({
      items,
      cursor: args.cursor,
      nextCursor: conn.pageInfo?.endCursor ?? undefined,
      limit: first,
    });
    
    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (p) =>
        `${String((p.name as string) ?? '')} (${p.id}) — state ${String((p.state as string) ?? '')}`,
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
    
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: message }];
    
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    
    return { content: parts, structuredContent: structured };
  },
});

// Create Projects
const CreateProjectsInputSchema = z.object({
  items: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    teamId: z.string().optional(),
    leadId: z.string().optional(),
    targetDate: z.string().optional(),
  })).min(1).max(50),
});

export const createProjectsTool = defineTool({
  name: toolsMetadata.create_projects.name,
  title: toolsMetadata.create_projects.title,
  description: toolsMetadata.create_projects.description,
  inputSchema: CreateProjectsInputSchema,
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
      try {
        if (context.signal?.aborted) {
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
        
        const payload = args.items.length > 1 ? await gate(call) : await call();
        
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
      total: args.items.length,
      okIdentifiers: okIds,
      failures,
      nextSteps: ['Use list_projects to verify; update_projects to modify.'],
    });
    
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];
    
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    
    return { content: parts, structuredContent: structured };
  },
});

// Update Projects
const UpdateProjectsInputSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    leadId: z.string().optional(),
    targetDate: z.string().optional(),
  })).min(1).max(50),
});

export const updateProjectsTool = defineTool({
  name: toolsMetadata.update_projects.name,
  title: toolsMetadata.update_projects.title,
  description: toolsMetadata.update_projects.description,
  inputSchema: UpdateProjectsInputSchema,
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
      try {
        if (context.signal?.aborted) {
          throw new Error('Operation aborted');
        }
        
        const call = () =>
          client.updateProject(it.id, {
            name: it.name,
            description: it.description,
            leadId: it.leadId,
            targetDate: it.targetDate,
          });
        
        const payload = args.items.length > 1 ? await gate(call) : await call();
        
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
      total: args.items.length,
      okIdentifiers: okIds,
      failures,
      nextSteps: ['Call list_projects to verify changes.'],
    });
    
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];
    
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }
    
    return { content: parts, structuredContent: structured };
  },
});


