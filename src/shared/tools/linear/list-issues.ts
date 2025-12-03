/**
 * List Issues tool - search and filter issues with powerful GraphQL filtering.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import { ListIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { normalizeIssueFilter } from '../../../utils/filters.js';
import { mapIssueNodeToListItem } from '../../../utils/mappers.js';
import { summarizeList, previewLinesFromItems } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  filter: z.record(z.any()).optional(),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
  includeArchived: z.boolean().optional(),
  orderBy: z.enum(['updatedAt', 'createdAt', 'priority']).optional(),
  q: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  fullDescriptions: z.boolean().optional(),
});

export const listIssuesTool = defineTool({
  name: toolsMetadata.list_issues.name,
  title: toolsMetadata.list_issues.title,
  description: toolsMetadata.list_issues.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const limit = args.limit ?? 25;

    // Build filter
    let filter = normalizeIssueFilter(args.filter) ?? {};
    
    // Apply teamId filter
    if (args.teamId) {
      filter = { ...filter, team: { id: { eq: args.teamId } } };
    }
    
    // Apply projectId filter
    if (args.projectId) {
      filter = { ...filter, project: { id: { eq: args.projectId } } };
    }

    // Handle keyword search
    const keywords = args.keywords ?? (args.q ? args.q.split(/\s+/).filter(Boolean) : []);
    if (keywords.length > 0) {
      const titleFilters = keywords.map((k) => ({
        title: { containsIgnoreCase: k },
      }));
      filter = { ...filter, or: titleFilters };
    }

    const queryArgs: Record<string, unknown> = {
      first: limit,
      filter,
      includeArchived: args.includeArchived ?? false,
    };

    if (args.cursor) {
      queryArgs.after = args.cursor;
    }

    if (args.orderBy) {
      queryArgs.orderBy = args.orderBy;
    }

    const connection = await client.issues(queryArgs as Parameters<typeof client.issues>[0]);
    const nodes = connection.nodes;
    const pageInfo = connection.pageInfo;

    const items = await Promise.all(nodes.map(mapIssueNodeToListItem));

    const structured = ListIssuesOutputSchema.parse({
      items,
      cursor: args.cursor,
      nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : undefined,
      limit,
    });

    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (it) => {
        const identifier = it.identifier as string | undefined;
        const title = it.title as string;
        const stateName = it.stateName as string | undefined;
        return `${identifier ?? it.id} — ${title}${stateName ? ` [${stateName}]` : ''}`;
      },
    );

    const text = summarizeList({
      subject: 'Issues',
      count: items.length,
      limit,
      nextCursor: structured.nextCursor,
      previewLines: preview,
      nextSteps: structured.nextCursor
        ? [`Pass cursor '${structured.nextCursor}' to fetch more.`]
        : undefined,
    });

    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];
    
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});







