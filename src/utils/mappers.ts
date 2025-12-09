import type {
  ListCommentsOutput,
  ListIssuesOutput,
  ListProjectsOutput,
  ListTeamsOutput,
  ListUsersOutput,
} from '../schemas/outputs.js';

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
    } catch {}
    return [] as Array<{ id: string; name: string }>;
  })();

  // Related names (best-effort)
  let stateName: string | undefined;
  let projectName: string | undefined;
  let assigneeName: string | undefined;
  try {
    const s = (node as { state?: Promise<{ name?: string }> }).state;
    if (s && typeof (s as unknown) === 'object') {
      const resolved = await s;
      stateName = resolved?.name ?? undefined;
    }
  } catch {}
  try {
    const p = (node as { project?: Promise<{ name?: string }> }).project;
    if (p && typeof (p as unknown) === 'object') {
      const resolved = await p;
      projectName = resolved?.name ?? undefined;
    }
  } catch {}
  try {
    const a = (node as { assignee?: Promise<{ name?: string }> }).assignee;
    if (a && typeof (a as unknown) === 'object') {
      const resolved = await a;
      assigneeName = resolved?.name ?? undefined;
    }
  } catch {}

  const id = (node as { id?: string })?.id ?? '';
  const identifier = (node as { identifier?: string })?.identifier ?? undefined;
  const title = (node as { title?: string })?.title ?? '';
  const description =
    (node as { description?: string | null })?.description ?? undefined;
  const priority = (node as { priority?: number | null })?.priority ?? undefined;
  const estimate = (node as { estimate?: number | null })?.estimate ?? undefined;
  const stateId = (node as { stateId?: string | null })?.stateId ?? '';
  const projectId = (node as { projectId?: string | null })?.projectId ?? undefined;
  const assigneeId = (node as { assigneeId?: string | null })?.assigneeId ?? undefined;
  const createdAt = String(
    (node as { createdAt?: Date | string | null })?.createdAt ?? '',
  );
  const updatedAt = String(
    (node as { updatedAt?: Date | string | null })?.updatedAt ?? '',
  );
  const archivedAtRaw =
    (node as { archivedAt?: Date | string | null })?.archivedAt ?? undefined;
  const archivedAt = archivedAtRaw ? String(archivedAtRaw) : undefined;
  const dueDate = (node as { dueDate?: string })?.dueDate ?? undefined;
  const url = (node as { url?: string })?.url ?? undefined;

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
  return {
    id: (node as { id?: string })?.id ?? '',
    name: (node as { name?: string })?.name ?? '',
    state: (node as { state?: string })?.state ?? '',
    teamId: undefined,
    leadId: (node as { leadId?: string | null })?.leadId ?? undefined,
    targetDate: (node as { targetDate?: string | null })?.targetDate ?? undefined,
    description: (node as { description?: string | null })?.description ?? undefined,
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
  } catch {}

  const createdRaw = (node as { createdAt?: Date | string })?.createdAt;
  const updatedRaw =
    (node as { updatedAt?: Date | string | null })?.updatedAt ?? undefined;

  return {
    id: (node as { id?: string })?.id ?? '',
    body: (node as { body?: string | null })?.body ?? undefined,
    url: (node as { url?: string | null })?.url ?? undefined,
    createdAt: createdRaw ? String(createdRaw) : '',
    updatedAt: updatedRaw ? String(updatedRaw) : undefined,
    user,
  };
}















