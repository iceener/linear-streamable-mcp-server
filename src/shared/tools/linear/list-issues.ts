/**
 * List Issues tool - search and filter issues with powerful GraphQL filtering.
 * Uses raw GraphQL to avoid N+1 query problem with SDK lazy loading.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import { ListIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import {
  validateFilter,
  formatErrorMessage,
  createToolError,
  getZeroResultHints,
} from '../../../utils/errors.js';
import { normalizeIssueFilter } from '../../../utils/filters.js';
import { summarizeList, previewLinesFromItems } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';
import type { IssueListItem, DetailLevel } from './shared/index.js';
import { formatIssuePreviewLine, formatIssueDetails } from './shared/index.js';

const InputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max results. Default: 25.'),
  cursor: z.string().optional().describe('Pagination cursor from previous response.'),
  filter: z
    .record(z.any())
    .optional()
    .describe(
      'GraphQL-style IssueFilter. Structure: { field: { comparator: value } }. ' +
        "Comparators: eq, neq, lt, lte, gt, gte, in, nin, containsIgnoreCase, startsWith, endsWith. " +
        "Examples: { state: { type: { eq: 'started' } } } for in-progress, " +
        "{ state: { type: { neq: 'completed' } } } for open issues, " +
        "{ assignee: { email: { eqIgnoreCase: 'x@y.com' } } }, " +
        "{ labels: { name: { in: ['Bug', 'Urgent'] } } }, " +
        "{ title: { containsIgnoreCase: 'search' } }.",
    ),
  teamId: z.string().optional().describe('Filter by team UUID.'),
  projectId: z.string().optional().describe('Filter by project UUID.'),
  includeArchived: z.boolean().optional().describe('Include archived issues. Default: false.'),
  orderBy: z
    .enum(['updatedAt', 'createdAt'])
    .optional()
    .describe("Sort order. Default: 'updatedAt'. Note: To prioritize high-priority issues, use filter: { priority: { lte: 2 } } instead."),
  detail: z
    .enum(['minimal', 'standard', 'full'])
    .optional()
    .describe("Detail level: 'minimal' (id, title, state), 'standard' (+ priority, assignee, project, due), 'full' (+ labels, description). Default: 'standard'."),
  q: z
    .string()
    .optional()
    .describe('Free-text search. Splits into tokens, matches title case-insensitively.'),
  keywords: z
    .array(z.string())
    .optional()
    .describe('Explicit keywords for title search (OR logic).'),
  assignedToMe: z
    .boolean()
    .optional()
    .describe('If true, only show issues assigned to the current viewer. Shortcut for filter.assignee.id.eq with viewer ID.'),
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

    // Apply assignedToMe filter
    if (args.assignedToMe) {
      const viewer = await client.viewer;
      const viewerId = (viewer as unknown as { id?: string })?.id;
      if (viewerId) {
        filter = { ...filter, assignee: { id: { eq: viewerId } } };
      }
    }

    // Handle keyword search
    const keywords = args.keywords ?? (args.q ? args.q.split(/\s+/).filter(Boolean) : []);
    if (keywords.length > 0) {
      const titleFilters = keywords.map((k) => ({
        title: { containsIgnoreCase: k },
      }));
      filter = { ...filter, or: titleFilters };
    }

    // Validate filter structure before sending to API
    if (args.filter && Object.keys(args.filter).length > 0) {
      const validation = validateFilter(args.filter as Record<string, unknown>);
      if (!validation.valid) {
        const error = createToolError(
          'FILTER_INVALID',
          `Filter validation failed:\n${validation.errors.join('\n')}`,
        );
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(error) }],
          structuredContent: { error: error.code, message: error.message, hint: error.hint },
        };
      }
    }

    // Use raw GraphQL to avoid N+1 query problem with SDK lazy loading
    const QUERY = `
      query ListIssues(
        $first: Int!,
        $after: String,
        $filter: IssueFilter,
        $includeArchived: Boolean,
        $orderBy: PaginationOrderBy
      ) {
        issues(
          first: $first,
          after: $after,
          filter: $filter,
          includeArchived: $includeArchived,
          orderBy: $orderBy
        ) {
          nodes {
            id
            identifier
            title
            description
            priority
            estimate
            state { id name type }
            project { id name }
            assignee { id name }
            createdAt
            updatedAt
            archivedAt
            dueDate
            url
            labels { nodes { id name } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const variables = {
      first: limit,
      after: args.cursor,
      filter: filter as Record<string, unknown>,
      includeArchived: args.includeArchived ?? false,
      orderBy: args.orderBy,
    } as Record<string, unknown>;

    const resp = await client.client.rawRequest(QUERY, variables);
    const conn = (
      resp as unknown as {
        data?: {
          issues?: {
            nodes?: Array<Record<string, unknown>>;
            pageInfo?: { hasNextPage?: boolean; endCursor?: string };
          };
        };
      }
    ).data?.issues ?? { nodes: [], pageInfo: {} };

    const items: IssueListItem[] = (conn.nodes ?? []).map((i) => {
      const state = (i.state as { id?: string; name?: string } | undefined) ?? undefined;
      const project = (i.project as { id?: string; name?: string } | undefined) ?? undefined;
      const assignee = (i.assignee as { id?: string; name?: string } | undefined) ?? undefined;
      const labelsConn = i.labels as { nodes?: Array<{ id: string; name: string }> } | undefined;
      const labels = (labelsConn?.nodes ?? []).map((l) => ({ id: l.id, name: l.name }));
      const archivedAtRaw = (i.archivedAt as string | null | undefined) ?? undefined;

      return {
        id: String(i.id ?? ''),
        identifier: (i.identifier as string) ?? undefined,
        title: String(i.title ?? ''),
        description: (i.description as string | null) ?? undefined,
        priority: (i.priority as number) ?? undefined,
        estimate: (i.estimate as number | null) ?? undefined,
        stateId: state?.id ?? '',
        stateName: state?.name ?? undefined,
        projectId: project?.id ?? undefined,
        projectName: project?.name ?? undefined,
        assigneeId: assignee?.id ?? undefined,
        assigneeName: assignee?.name ?? undefined,
        createdAt: String((i.createdAt as string | Date) ?? ''),
        updatedAt: String((i.updatedAt as string | Date) ?? ''),
        archivedAt: archivedAtRaw ? String(archivedAtRaw) : undefined,
        dueDate: (i.dueDate as string) ?? undefined,
        url: (i.url as string) ?? undefined,
        labels,
      };
    });

    const pageInfo = conn.pageInfo ?? {};
    const hasMore = pageInfo.hasNextPage ?? false;
    const nextCursor = hasMore ? pageInfo.endCursor ?? undefined : undefined;

    // Build query echo for LLM context
    const query = {
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      teamId: args.teamId,
      projectId: args.projectId,
      assignedToMe: args.assignedToMe,
      keywords: keywords.length > 0 ? keywords : undefined,
      includeArchived: args.includeArchived,
      orderBy: args.orderBy,
      limit,
    };

    // Build pagination info
    const pagination = {
      hasMore,
      nextCursor,
      itemsReturned: items.length,
      limit,
    };

    // Build context-aware hints for zero results
    const zeroReasonHints =
      items.length === 0
        ? getZeroResultHints({
            hasStateFilter: !!(args.filter as Record<string, unknown> | undefined)?.state,
            hasDateFilter: !!(args.filter as Record<string, unknown> | undefined)?.updatedAt ||
              !!(args.filter as Record<string, unknown> | undefined)?.createdAt,
            hasTeamFilter: !!args.teamId,
            hasAssigneeFilter: !!args.assignedToMe ||
              !!(args.filter as Record<string, unknown> | undefined)?.assignee,
            hasProjectFilter: !!args.projectId,
            hasKeywordFilter: !!args.q || (args.keywords?.length ?? 0) > 0,
          })
        : undefined;

    // Build meta with next steps
    const meta = {
      nextSteps: [
        ...(hasMore ? [`Call again with cursor="${nextCursor}" to fetch more results.`] : []),
        'Use get_issues with specific IDs for detailed info.',
        'Use update_issues to modify state, assignee, or labels.',
      ],
      hints: zeroReasonHints,
      relatedTools: ['get_issues', 'update_issues', 'add_comments'],
    };

    const structured = ListIssuesOutputSchema.parse({
      query,
      items,
      pagination,
      meta,
      // Legacy fields for backward compatibility
      cursor: args.cursor,
      nextCursor,
      limit,
    });

    const detail: DetailLevel = args.detail ?? 'standard';
    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (it) => formatIssuePreviewLine(it as unknown as IssueListItem, detail),
    );

    const text = summarizeList({
      subject: 'Issues',
      count: items.length,
      limit,
      nextCursor,
      previewLines: preview,
      zeroReasonHints,
      nextSteps: hasMore
        ? [`Pass cursor '${nextCursor}' to fetch more.`]
        : undefined,
    });

    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];
    
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});

























