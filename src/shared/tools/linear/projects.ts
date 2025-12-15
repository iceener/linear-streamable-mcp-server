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
import { makeConcurrencyGate, withRetry, delay } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { mapProjectNodeToListItem } from '../../../utils/mappers.js';
import { summarizeBatch, summarizeList, previewLinesFromItems } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

// List Projects
const ListProjectsInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max results. Default: 20.'),
  cursor: z.string().optional().describe('Pagination cursor from previous response.'),
  filter: z
    .record(z.any())
    .optional()
    .describe(
      'GraphQL-style ProjectFilter. Structure: { field: { comparator: value } }. ' +
        "Examples: { id: { eq: 'PROJECT_UUID' } } for single project, " +
        "{ state: { eq: 'started' } }, " +
        "{ team: { id: { eq: 'TEAM_UUID' } } }, " +
        "{ lead: { id: { eq: 'USER_UUID' } } }, " +
        "{ targetDate: { lt: '2025-01-01', gt: '2024-01-01' } }.",
    ),
  includeArchived: z.boolean().optional().describe('Include archived projects. Default: false.'),
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
    
    const hasMore = !!conn.pageInfo?.endCursor;
    const nextCursor = conn.pageInfo?.endCursor ?? undefined;

    // Build query echo
    const query = {
      filter: args.filter ? (filter as Record<string, unknown>) : undefined,
      includeArchived: args.includeArchived,
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
        'Use update_projects to modify state or details.',
        'Use list_issues with projectId to see project issues.',
      ],
      relatedTools: ['update_projects', 'list_issues', 'create_projects'],
    };

    const structured = ListProjectsOutputSchema.parse({
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
      (p) =>
        `${String((p.name as string) ?? '')} (${p.id}) — state ${String((p.state as string) ?? '')}`,
    );
    
    const message = summarizeList({
      subject: 'Projects',
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
          });
        
        const payload = await withRetry(
          () => (args.items.length > 1 ? gate(call) : call()),
          { maxRetries: 3, baseDelayMs: 500 },
        );
        
        results.push({
          input: { name: it.name, teamId: it.teamId },
          success: payload.success ?? true,
          id: (payload.project as { id?: string } | null | undefined)?.id,
          // Legacy
          index: i,
          ok: payload.success ?? true,
        });
      } catch (error) {
        await logger.error('create_projects', {
          message: 'Failed to create project',
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
  items: z
    .array(
      z.object({
        id: z.string().describe('Project UUID. Required.'),
        name: z.string().optional().describe('New project name.'),
        description: z.string().optional().describe('New markdown description.'),
        leadId: z.string().optional().describe('New lead user UUID.'),
        targetDate: z.string().optional().describe('New target date (YYYY-MM-DD).'),
        state: z.string().optional().describe("New state: 'planned', 'started', 'paused', 'completed', 'canceled'."),
        archived: z.boolean().optional().describe('Set true to archive, false to unarchive.'),
      }),
    )
    .min(1)
    .max(50)
    .describe('Projects to update.'),
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
        
        const result = await withRetry(
          () => (args.items.length > 1 ? gate(call) : call()),
          { maxRetries: 3, baseDelayMs: 500 },
        );

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
        await logger.error('update_projects', {
          message: 'Failed to update project',
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







