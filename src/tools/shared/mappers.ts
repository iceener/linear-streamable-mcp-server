import type {
  ListCommentsOutput,
  ListProjectsOutput,
  ListTeamsOutput,
  ListUsersOutput,
} from './outputs';

// Generic helpers / guards
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function hasFunction<
  Fn extends (...args: unknown[]) => unknown = (...args: unknown[]) => unknown,
>(value: unknown, key: string): value is Record<string, Fn> {
  return isRecord(value) && typeof (value as Record<string, unknown>)[key] === 'function';
}

export function mapProjectNodeToListItem(node: unknown): ListProjectsOutput['items'][number] {
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
  let user: { id: string; name?: string | undefined } | undefined;
  try {
    const u = await (node as { user?: Promise<unknown> }).user;
    if (u && isRecord(u)) {
      user = {
        id: (u as { id?: string })?.id ?? '',
        name: (u as { name?: string | null })?.name ?? undefined,
      };
    }
  } catch {
    // Best effort: the comment is listed without its author.
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
