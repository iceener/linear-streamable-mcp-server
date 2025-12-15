import type {
  ListCommentsOutput,
  ListIssuesOutput,
  ListProjectsOutput,
  ListTeamsOutput,
  ListUsersOutput,
} from '../schemas/outputs.js';
import { logger } from './logger.js';

// Generic helpers / guards
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hasFunction<
  Fn extends (...args: unknown[]) => unknown = (...args: unknown[]) => unknown,
>(value: unknown, key: string): value is Record<string, Fn> {
  return (
    isRecord(value) && typeof (value as Record<string, unknown>)[key] === 'function'
  );
}

export function hasProperty<T = unknown>(
  value: unknown,
  key: string,
): value is Record<string, T> {
  return isRecord(value) && key in value;
}

export async function mapIssueNodeToListItem(
  node: unknown,
): Promise<ListIssuesOutput['items'][number]> {
  // Labels
  const labels = await (async () => {
    try {
      if (hasFunction(node, 'labels')) {
        const conn = await (
          node as {
            labels: () => Promise<{
              nodes: Array<{ id: string; name: string }>;
            }>;
          }
        ).labels();
        return conn.nodes.map((l) => ({ id: l.id, name: l.name }));
      }
    } catch (error) {
      logger.debug('mappers', {
        message: 'Failed to fetch labels',
        error: (error as Error).message,
      });
    }
    return [] as Array<{ id: string; name: string }>;
  })();

  // Related names (best-effort with logging)
  let stateName: string | undefined;
  let stateIdFromRelation: string | undefined;
  let projectName: string | undefined;
  let assigneeName: string | undefined;
  try {
    const s = (node as { state?: Promise<{ id?: string; name?: string }> }).state;
    if (s && typeof (s as unknown) === 'object') {
      const resolved = await s;
      stateName = resolved?.name ?? undefined;
      stateIdFromRelation = resolved?.id ?? undefined;
    }
  } catch (error) {
    logger.debug('mappers', {
      message: 'Failed to fetch state relation',
      error: (error as Error).message,
    });
  }
  try {
    const p = (node as { project?: Promise<{ name?: string }> }).project;
    if (p && typeof (p as unknown) === 'object') {
      const resolved = await p;
      projectName = resolved?.name ?? undefined;
    }
  } catch (error) {
    logger.debug('mappers', {
      message: 'Failed to fetch project relation',
      error: (error as Error).message,
    });
  }
  try {
    const a = (node as { assignee?: Promise<{ name?: string }> }).assignee;
    if (a && typeof (a as unknown) === 'object') {
      const resolved = await a;
      assigneeName = resolved?.name ?? undefined;
    }
  } catch (error) {
    logger.debug('mappers', {
      message: 'Failed to fetch assignee relation',
      error: (error as Error).message,
    });
  }

  // Issue class has these as required properties per SDK types
  const issue = node as {
    id: string;
    identifier: string;
    title: string;
    priority: number;
    url: string;
    description?: string | null;
    estimate?: number | null;
    dueDate?: string | null;
    archivedAt?: Date | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  };

  const id = issue.id;
  const identifier = issue.identifier;
  const title = issue.title;
  const description = issue.description ?? undefined;
  const priority = issue.priority;
  const estimate = issue.estimate ?? undefined;
  // Use stateId from relation, fall back to empty string (required by output schema)
  const stateId = stateIdFromRelation ?? '';
  const projectId = (node as { projectId?: string | null })?.projectId ?? undefined;
  const assigneeId = (node as { assigneeId?: string | null })?.assigneeId ?? undefined;
  const createdAt = String(issue.createdAt ?? '');
  const updatedAt = String(issue.updatedAt ?? '');
  const archivedAt = issue.archivedAt ? String(issue.archivedAt) : undefined;
  const dueDate = issue.dueDate ?? undefined;
  const url = issue.url;

  return {
    id,
    identifier,
    title,
    description,
    priority,
    estimate,
    stateId,
    stateName,
    projectId,
    projectName,
    assigneeId,
    assigneeName,
    createdAt,
    updatedAt,
    archivedAt,
    dueDate,
    url,
    labels,
  };
}

export function mapProjectNodeToListItem(
  node: unknown,
): ListProjectsOutput['items'][number] {
  // Project class per SDK types
  const project = node as {
    id: string;
    name: string;
    state: string;
    description: string;
    priority: number;
    targetDate?: string | null;
  };

  // Try to get leadId if available
  const leadId = (node as { leadId?: string | null })?.leadId ?? undefined;

  return {
    id: project.id,
    name: project.name,
    state: project.state,
    teamId: undefined, // Projects can have multiple teams via teams() - caller should resolve if needed
    leadId,
    targetDate: project.targetDate ?? undefined,
    description: project.description ?? undefined,
  };
}

export function mapTeamNodeToListItem(node: unknown): ListTeamsOutput['items'][number] {
  return {
    id: (node as { id?: string })?.id ?? '',
    key: (node as { key?: string | null })?.key ?? undefined,
    name: (node as { name?: string })?.name ?? '',
  };
}

export function mapUserNodeToListItem(node: unknown): ListUsersOutput['items'][number] {
  return {
    id: (node as { id?: string })?.id ?? '',
    name: (node as { name?: string | null })?.name ?? undefined,
    email: (node as { email?: string | null })?.email ?? undefined,
    displayName: (node as { displayName?: string | null })?.displayName ?? undefined,
    avatarUrl: (node as { avatarUrl?: string | null })?.avatarUrl ?? undefined,
  };
}

export async function mapCommentNodeToListItem(
  node: unknown,
): Promise<ListCommentsOutput['items'][number]> {
  let user: { id: string; name?: string } | undefined;
  try {
    const u = await (node as { user?: Promise<unknown> }).user;
    if (u && isRecord(u)) {
      user = {
        id: (u as { id?: string })?.id ?? '',
        name: (u as { name?: string | null })?.name ?? undefined,
      };
    }
  } catch (error) {
    logger.debug('mappers', {
      message: 'Failed to fetch comment user relation',
      error: (error as Error).message,
    });
  }

  const comment = node as {
    id: string;
    body?: string | null;
    url?: string | null;
    createdAt: Date | string;
    updatedAt?: Date | string | null;
  };

  return {
    id: comment.id,
    body: comment.body ?? undefined,
    url: comment.url ?? undefined,
    createdAt: String(comment.createdAt),
    updatedAt: comment.updatedAt ? String(comment.updatedAt) : undefined,
    user,
  };
}

























