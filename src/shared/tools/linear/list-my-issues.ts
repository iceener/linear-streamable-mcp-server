/**
 * List My Issues tool - fetch issues assigned to the current user.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { config } from '../../../config/env.js';
import { ListIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { normalizeIssueFilter } from '../../../utils/filters.js';
import { summarizeList } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';
import {
  formatIssueDetails,
  formatIssuePreviewLine,
  previewLinesFromItems,
  type IssueListItem,
} from './shared/index.js';

const InputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  filter: z.record(z.any()).optional(),
  includeArchived: z.boolean().optional(),
  orderBy: z.enum(['updatedAt', 'createdAt']).optional(),
  q: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  fullDescriptions: z.boolean().optional(),
});

export const listMyIssuesTool = defineTool({
  name: toolsMetadata.list_my_issues.name,
  title: toolsMetadata.list_my_issues.title,
  description: toolsMetadata.list_my_issues.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const first = args.limit ?? 20;
    const after = args.cursor && args.cursor.trim() !== '' ? args.cursor : undefined;

    // Build keyword-aware filter for assigned issues
    const keywordTokens = [
      ...(args.keywords ?? []),
      ...(args.q ?? '')
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ];
    const keywordOr = keywordTokens.length
      ? { or: keywordTokens.map((t) => ({ title: { containsIgnoreCase: t } })) }
      : undefined;
    const baseFilter =
      normalizeIssueFilter(args.filter as Record<string, unknown> | undefined) ?? {};
    const mergedFilter = keywordOr
      ? { ...(baseFilter as object), ...(keywordOr as object) }
      : baseFilter;

    // Single GraphQL query to avoid N+1 requests
    const QUERY = `
      query ListMyIssues(
        $first: Int!,
        $after: String,
        $filter: IssueFilter,
        $includeArchived: Boolean,
        $orderBy: PaginationOrderBy
      ) {
        viewer {
          assignedIssues(
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
            pageInfo { endCursor }
          }
        }
      }
    `;

    const variables = {
      first,
      after,
      filter: mergedFilter as Record<string, unknown>,
      includeArchived: args.includeArchived,
      orderBy: args.orderBy,
    } as Record<string, unknown>;

    const resp = await client.client.rawRequest(QUERY, variables);
    const conn = (
      resp as unknown as {
        data?: {
          viewer?: {
            assignedIssues?: {
              nodes?: Array<Record<string, unknown>>;
              pageInfo?: { endCursor?: string };
            };
          };
        };
      }
    ).data?.viewer?.assignedIssues ?? { nodes: [], pageInfo: {} };

    const items: IssueListItem[] = (conn.nodes ?? []).map((i) => {
      const state = (i.state as { id?: string; name?: string } | undefined) ?? undefined;
      const project =
        (i.project as { id?: string; name?: string } | undefined) ?? undefined;
      const assignee =
        (i.assignee as { id?: string; name?: string } | undefined) ?? undefined;
      const labelsConn = i.labels as
        | { nodes?: Array<{ id: string; name: string }> }
        | undefined;
      const labels = (labelsConn?.nodes ?? []).map((l) => ({
        id: l.id,
        name: l.name,
      }));
      const archivedAtRaw = (i.archivedAt as string | null | undefined) ?? undefined;
      return {
        id: String(i.id ?? ''),
        identifier: (i as { identifier?: string }).identifier ?? undefined,
        title: String(i.title ?? ''),
        description: (i as { description?: string | null }).description ?? undefined,
        priority: (i as { priority?: number | null }).priority ?? undefined,
        estimate: (i as { estimate?: number | null }).estimate ?? undefined,
        stateId: state?.id ?? '',
        stateName: state?.name ?? undefined,
        projectId: project?.id ?? undefined,
        projectName: project?.name ?? undefined,
        assigneeId: assignee?.id ?? undefined,
        assigneeName: assignee?.name ?? undefined,
        createdAt: String((i as { createdAt?: string | Date | null }).createdAt ?? ''),
        updatedAt: String((i as { updatedAt?: string | Date | null }).updatedAt ?? ''),
        archivedAt: archivedAtRaw ? String(archivedAtRaw) : undefined,
        dueDate: (i as { dueDate?: string }).dueDate ?? undefined,
        url: (i as { url?: string }).url ?? undefined,
        labels,
      };
    });

    const structured = ListIssuesOutputSchema.parse({
      items,
      cursor: args.cursor,
      nextCursor: conn.pageInfo?.endCursor ?? undefined,
      limit: first,
    });

    // Use shared formatting utilities
    const preview = previewLinesFromItems(items, formatIssuePreviewLine);

    const nextSteps: string[] = [];
    if (items.length > 0) {
      nextSteps.push(
        'Use list_issues (by id or by number+team.key/team.id, limit=1) for details, or update_issues to change state/assignee.',
      );
    } else {
      nextSteps.push(
        "Refine filters: try state.type 'started' (alias: active), clear q/keywords or try different keywords.",
      );
    }

    const message = summarizeList({
      subject: 'My issues',
      count: items.length,
      limit: first,
      nextCursor: structured.nextCursor,
      previewLines: preview,
      nextSteps,
    });

    // Use shared details formatting
    const details = items
      .map((i) =>
        formatIssueDetails(i, {
          fullDescriptions: args.fullDescriptions,
        }),
      )
      .join('\n');

    const full = details ? `${message}\n\n${details}` : message;
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: full }];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});







