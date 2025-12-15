/**
 * Mock Linear Client for testing.
 * Provides configurable responses for all Linear SDK methods used by tools.
 */

import { vi } from 'vitest';
import type { LinearClient } from '@linear/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MockViewer {
  id: string;
  name?: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  timezone?: string;
  createdAt?: Date;
}

export interface MockTeam {
  id: string;
  key?: string;
  name: string;
  description?: string;
  defaultIssueEstimate?: number;
  cyclesEnabled?: boolean;
  issueEstimationAllowZero?: boolean;
  issueEstimationExtended?: boolean;
  issueEstimationType?: string;
  states: () => Promise<{ nodes: MockWorkflowState[] }>;
  labels: (args: { first: number }) => Promise<{ nodes: MockLabel[] }>;
  projects: (args: { first: number }) => Promise<{ nodes: MockProject[] }>;
  cycles: (args?: { first?: number; after?: string; includeArchived?: boolean; orderBy?: unknown }) => Promise<{ nodes: MockCycle[]; pageInfo: MockPageInfo }>;
}

export interface MockWorkflowState {
  id: string;
  name: string;
  type?: string;
}

export interface MockLabel {
  id: string;
  name: string;
  color?: string;
  description?: string;
}

export interface MockProject {
  id: string;
  name: string;
  state?: string;
  lead?: { id?: string };
  leadId?: string;
  teamId?: string;
  targetDate?: string;
  createdAt?: Date | string;
}

export interface MockIssue {
  id: string;
  identifier?: string;
  title: string;
  description?: string;
  priority?: number;
  estimate?: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt?: Date;
  dueDate?: string;
  url?: string;
  branchName?: string;
  state: Promise<{ id: string; name: string; type?: string }>;
  project: Promise<{ id: string; name?: string } | null>;
  assignee: Promise<{ id: string; name?: string } | null>;
  labels: () => Promise<{ nodes: MockLabel[] }>;
  attachments: () => Promise<{ nodes: unknown[] }>;
  comments: (args?: { first?: number; after?: string }) => Promise<{ nodes: MockComment[]; pageInfo: MockPageInfo }>;
  team?: { id: string } | (() => Promise<{ id: string }>);
}

export interface MockUser {
  id: string;
  name?: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface MockComment {
  id: string;
  body?: string;
  url?: string;
  createdAt: Date;
  updatedAt?: Date;
  user?: { id: string; name?: string };
}

export interface MockCycle {
  id: string;
  name?: string;
  number?: number;
  startsAt?: Date;
  endsAt?: Date;
  completedAt?: Date;
  team: { id: string };
}

export interface MockPageInfo {
  hasNextPage: boolean;
  endCursor?: string;
}

export interface MockConnection<T> {
  nodes: T[];
  pageInfo: MockPageInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Mock Data
// ─────────────────────────────────────────────────────────────────────────────

export const defaultMockViewer: MockViewer = {
  id: 'user-001',
  name: 'Test User',
  email: 'test@example.com',
  displayName: 'Test User',
  avatarUrl: 'https://example.com/avatar.png',
  timezone: 'Europe/Warsaw',
  createdAt: new Date('2024-01-01T00:00:00Z'),
};

export const defaultMockStates: MockWorkflowState[] = [
  { id: 'state-backlog', name: 'Backlog', type: 'backlog' },
  { id: 'state-todo', name: 'Todo', type: 'unstarted' },
  { id: 'state-inprogress', name: 'In Progress', type: 'started' },
  { id: 'state-done', name: 'Done', type: 'completed' },
  { id: 'state-canceled', name: 'Canceled', type: 'canceled' },
];

export const defaultMockLabels: MockLabel[] = [
  { id: 'label-bug', name: 'Bug', color: '#ff0000' },
  { id: 'label-feature', name: 'Feature', color: '#00ff00' },
  { id: 'label-docs', name: 'Documentation', color: '#0000ff' },
];

export const defaultMockProjects: MockProject[] = [
  {
    id: 'project-001',
    name: 'Q1 Release',
    state: 'started',
    lead: { id: 'user-001' },
    leadId: 'user-001',
    teamId: 'team-eng',
    targetDate: '2025-03-31',
    createdAt: new Date('2024-12-01T00:00:00Z'),
  },
  {
    id: 'project-002',
    name: 'Infrastructure',
    state: 'planned',
    leadId: 'user-002',
    createdAt: new Date('2024-11-01T00:00:00Z'),
  },
];

export const defaultMockTeams: MockTeam[] = [
  {
    id: 'team-eng',
    key: 'ENG',
    name: 'Engineering',
    description: 'Core engineering team',
    defaultIssueEstimate: 2,
    cyclesEnabled: true,
    issueEstimationAllowZero: false,
    issueEstimationType: 'fibonacci',
    states: () => Promise.resolve({ nodes: defaultMockStates }),
    labels: () => Promise.resolve({ nodes: defaultMockLabels }),
    projects: () => Promise.resolve({ nodes: defaultMockProjects }),
    cycles: (args) => {
      const limit = args?.first ?? defaultMockCycles.length;
      const cyclesForTeam = defaultMockCycles.filter((c) => c.team.id === 'team-eng');
      return Promise.resolve({
        nodes: cyclesForTeam.slice(0, limit),
        pageInfo: {
          hasNextPage: cyclesForTeam.length > limit,
          endCursor: cyclesForTeam.length > limit ? 'cycle-cursor' : undefined,
        },
      });
    },
  },
  {
    id: 'team-design',
    key: 'DES',
    name: 'Design',
    cyclesEnabled: false,
    states: () => Promise.resolve({ nodes: defaultMockStates }),
    labels: () => Promise.resolve({ nodes: [] }),
    projects: () => Promise.resolve({ nodes: [] }),
    cycles: () => Promise.resolve({ nodes: [], pageInfo: { hasNextPage: false } }),
  },
];

export const defaultMockComments: MockComment[] = [
  {
    id: 'comment-001',
    body: 'This looks good, approved!',
    url: 'https://linear.app/team/issue/ENG-123/comment-001',
    createdAt: new Date('2024-12-15T10:00:00Z'),
    updatedAt: new Date('2024-12-15T10:00:00Z'),
    user: { id: 'user-002', name: 'Jane Doe' },
  },
  {
    id: 'comment-002',
    body: 'Deployed to staging for testing',
    createdAt: new Date('2024-12-15T14:00:00Z'),
    user: { id: 'user-001', name: 'Test User' },
  },
];

export const defaultMockIssues: MockIssue[] = [
  {
    id: 'issue-001',
    identifier: 'ENG-123',
    title: 'Fix authentication bug',
    description: 'Users are being logged out unexpectedly',
    priority: 1,
    estimate: 3,
    createdAt: new Date('2024-12-10T10:00:00Z'),
    updatedAt: new Date('2024-12-15T14:30:00Z'),
    url: 'https://linear.app/team/issue/ENG-123',
    branchName: 'fix/auth-bug',
    state: Promise.resolve({ id: 'state-inprogress', name: 'In Progress', type: 'started' }),
    project: Promise.resolve({ id: 'project-001', name: 'Q1 Release' }),
    assignee: Promise.resolve({ id: 'user-001', name: 'Test User' }),
    labels: () => Promise.resolve({ nodes: [{ id: 'label-bug', name: 'Bug' }] }),
    attachments: () => Promise.resolve({ nodes: [] }),
    comments: (args) => Promise.resolve({
      nodes: defaultMockComments.slice(0, args?.first ?? defaultMockComments.length),
      pageInfo: { hasNextPage: false },
    }),
    team: { id: 'team-eng' },
  },
  {
    id: 'issue-002',
    identifier: 'ENG-124',
    title: 'Add dark mode support',
    description: 'Implement dark mode toggle in settings',
    priority: 2,
    createdAt: new Date('2024-12-11T09:00:00Z'),
    updatedAt: new Date('2024-12-14T11:00:00Z'),
    url: 'https://linear.app/team/issue/ENG-124',
    state: Promise.resolve({ id: 'state-todo', name: 'Todo', type: 'unstarted' }),
    project: Promise.resolve({ id: 'project-001', name: 'Q1 Release' }),
    assignee: Promise.resolve(null),
    labels: () => Promise.resolve({ nodes: [{ id: 'label-feature', name: 'Feature' }] }),
    attachments: () => Promise.resolve({ nodes: [] }),
    comments: () => Promise.resolve({ nodes: [], pageInfo: { hasNextPage: false } }),
    team: { id: 'team-eng' },
  },
  {
    id: 'issue-003',
    identifier: 'ENG-125',
    title: 'Update API documentation',
    priority: 3,
    createdAt: new Date('2024-12-12T08:00:00Z'),
    updatedAt: new Date('2024-12-12T08:00:00Z'),
    state: Promise.resolve({ id: 'state-backlog', name: 'Backlog', type: 'backlog' }),
    project: Promise.resolve(null),
    assignee: Promise.resolve(null),
    labels: () => Promise.resolve({ nodes: [{ id: 'label-docs', name: 'Documentation' }] }),
    attachments: () => Promise.resolve({ nodes: [] }),
    comments: () => Promise.resolve({ nodes: [], pageInfo: { hasNextPage: false } }),
    team: { id: 'team-eng' },
  },
  {
    id: 'issue-004',
    identifier: 'ENG-126',
    title: 'Fix login page styling',
    priority: 2,
    createdAt: new Date('2024-12-01T08:00:00Z'),
    updatedAt: new Date('2024-12-10T16:00:00Z'),
    state: Promise.resolve({ id: 'state-done', name: 'Done', type: 'completed' }),
    project: Promise.resolve({ id: 'project-001', name: 'Q1 Release' }),
    assignee: Promise.resolve({ id: 'user-002', name: 'Jane Doe' }),
    labels: () => Promise.resolve({ nodes: [{ id: 'label-bug', name: 'Bug' }] }),
    attachments: () => Promise.resolve({ nodes: [] }),
    comments: () => Promise.resolve({ nodes: [], pageInfo: { hasNextPage: false } }),
    team: { id: 'team-eng' },
  },
  {
    id: 'issue-005',
    identifier: 'ENG-127',
    title: 'Add user profile page',
    priority: 3,
    createdAt: new Date('2024-11-20T08:00:00Z'),
    updatedAt: new Date('2024-12-05T12:00:00Z'),
    state: Promise.resolve({ id: 'state-cancelled', name: 'Cancelled', type: 'canceled' }),
    project: Promise.resolve({ id: 'project-002', name: 'Infrastructure' }),
    assignee: Promise.resolve({ id: 'user-001', name: 'Test User' }),
    labels: () => Promise.resolve({ nodes: [{ id: 'label-feature', name: 'Feature' }] }),
    attachments: () => Promise.resolve({ nodes: [] }),
    comments: () => Promise.resolve({ nodes: [], pageInfo: { hasNextPage: false } }),
    team: { id: 'team-design' },
  },
];

export const defaultMockUsers: MockUser[] = [
  { id: 'user-001', name: 'Test User', email: 'test@example.com', displayName: 'Test User' },
  { id: 'user-002', name: 'Jane Doe', email: 'jane@example.com', displayName: 'Jane' },
  { id: 'user-003', name: 'Bob Smith', email: 'bob@example.com', displayName: 'Bob' },
];

export const defaultMockCycles: MockCycle[] = [
  {
    id: 'cycle-001',
    name: 'Sprint 1',
    number: 1,
    startsAt: new Date('2024-12-09T00:00:00Z'),
    endsAt: new Date('2024-12-22T23:59:59Z'),
    team: { id: 'team-eng' },
  },
  {
    id: 'cycle-002',
    name: 'Sprint 2',
    number: 2,
    startsAt: new Date('2024-12-23T00:00:00Z'),
    endsAt: new Date('2025-01-05T23:59:59Z'),
    team: { id: 'team-eng' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Mock Client Factory
// ─────────────────────────────────────────────────────────────────────────────

export interface MockLinearClientConfig {
  viewer?: MockViewer;
  teams?: MockTeam[];
  issues?: MockIssue[];
  users?: MockUser[];
  cycles?: MockCycle[];
  projects?: MockProject[];
  comments?: MockComment[];
  favorites?: unknown[];
}

export interface MockLinearClient {
  viewer: Promise<MockViewer>;
  teams: (args?: { first?: number }) => Promise<MockConnection<MockTeam>>;
  team: (id: string) => Promise<MockTeam | null>;
  issues: (args?: Record<string, unknown>) => Promise<MockConnection<MockIssue>>;
  issue: (id: string) => Promise<MockIssue | null>;
  users: (args?: { first?: number }) => Promise<MockConnection<MockUser>>;
  favorites: (args?: { first?: number }) => Promise<MockConnection<unknown>>;
  projects: (args?: { first?: number; after?: string; filter?: Record<string, unknown> }) => Promise<MockConnection<MockProject>>;
  cycles: (args?: { first?: number; after?: string; filter?: Record<string, unknown> }) => Promise<MockConnection<MockCycle>>;
  comments: (issueId: string, args?: { first?: number; after?: string }) => Promise<MockConnection<MockComment>>;
  createIssue: (input: Record<string, unknown>) => Promise<{ success: boolean; issue?: { id: string; identifier: string } }>;
  updateIssue: (id: string, input: Record<string, unknown>) => Promise<{ success: boolean; issue?: { id: string; identifier: string } }>;
  createProject: (input: Record<string, unknown>) => Promise<{ success: boolean; project?: { id: string; name: string } }>;
  updateProject: (id: string, input: Record<string, unknown>) => Promise<{ success: boolean; project?: { id: string; name: string } }>;
  createComment: (input: Record<string, unknown>) => Promise<{ success: boolean; comment?: { id: string } }>;
  updateComment: (id: string, input: Record<string, unknown>) => Promise<{ success: boolean; comment?: { id: string } }>;
  /** Raw GraphQL client for rawRequest calls */
  client: {
    rawRequest: (query: string, variables?: Record<string, unknown>) => Promise<{ data: unknown }>;
  };
  // Internal config for test assertions
  _config: MockLinearClientConfig;
  _calls: {
    issues: Array<Record<string, unknown>>;
    createIssue: Array<Record<string, unknown>>;
    updateIssue: Array<{ id: string; input: Record<string, unknown> }>;
    rawRequest: Array<{ query: string; variables?: Record<string, unknown> }>;
  };
}

export function createMockLinearClient(config: MockLinearClientConfig = {}): MockLinearClient {
  const {
    viewer = defaultMockViewer,
    teams = defaultMockTeams,
    issues = defaultMockIssues,
    users = defaultMockUsers,
    cycles = defaultMockCycles,
    projects = defaultMockProjects,
    comments = [],
    favorites = [],
  } = config;

  const calls = {
    issues: [] as Array<Record<string, unknown>>,
    createIssue: [] as Array<Record<string, unknown>>,
    updateIssue: [] as Array<{ id: string; input: Record<string, unknown> }>,
    rawRequest: [] as Array<{ query: string; variables?: Record<string, unknown> }>,
  };

  return {
    viewer: Promise.resolve(viewer),

    teams: vi.fn(async (args?: { first?: number }) => ({
      nodes: teams.slice(0, args?.first ?? teams.length),
      pageInfo: { hasNextPage: false },
    })),

    team: vi.fn(async (id: string) => {
      return teams.find((t) => t.id === id) ?? null;
    }),

    issues: vi.fn(async (args?: Record<string, unknown>) => {
      calls.issues.push(args ?? {});
      const limit = (args?.first as number) ?? 25;
      return {
        nodes: issues.slice(0, limit),
        pageInfo: { hasNextPage: issues.length > limit, endCursor: 'cursor-next' },
      };
    }),

    issue: vi.fn(async (id: string) => {
      // Support both UUID and identifier lookup
      return issues.find((i) => i.id === id || i.identifier === id) ?? null;
    }),

    users: vi.fn(async (args?: { first?: number }) => ({
      nodes: users.slice(0, args?.first ?? users.length),
      pageInfo: { hasNextPage: false },
    })),

    favorites: vi.fn(async () => ({
      nodes: favorites,
      pageInfo: { hasNextPage: false },
    })),

    projects: vi.fn(async (args?: { first?: number; after?: string; filter?: Record<string, unknown> }) => {
      const limit = args?.first ?? projects.length;
      return {
        nodes: projects.slice(0, limit),
        pageInfo: { hasNextPage: projects.length > limit, endCursor: projects.length > limit ? 'project-cursor' : undefined },
      };
    }),

    cycles: vi.fn(async (args?: { first?: number; after?: string; filter?: Record<string, unknown> }) => {
      const limit = args?.first ?? cycles.length;
      const filtered = args?.filter?.team?.id?.eq
        ? cycles.filter((c) => c.team.id === args.filter.team.id.eq)
        : cycles;
      return {
        nodes: filtered.slice(0, limit),
        pageInfo: { hasNextPage: filtered.length > limit, endCursor: filtered.length > limit ? 'cycle-cursor' : undefined },
      };
    }),

    comments: vi.fn(async (issueId: string, args?: { first?: number; after?: string }) => {
      const limit = args?.first ?? comments.length;
      return {
        nodes: comments.slice(0, limit),
        pageInfo: { hasNextPage: comments.length > limit, endCursor: comments.length > limit ? 'comment-cursor' : undefined },
      };
    }),

    createIssue: vi.fn(async (input: Record<string, unknown>) => {
      calls.createIssue.push(input);
      const newId = `issue-new-${Date.now()}`;
      const teamKey = teams.find((t) => t.id === input.teamId)?.key ?? 'XXX';
      return {
        success: true,
        issue: { id: newId, identifier: `${teamKey}-999` },
      };
    }),

    updateIssue: vi.fn(async (id: string, input: Record<string, unknown>) => {
      calls.updateIssue.push({ id, input });
      const existing = issues.find((i) => i.id === id || i.identifier === id);
      return {
        success: !!existing,
        issue: existing ? { id: existing.id, identifier: existing.identifier ?? id } : undefined,
      };
    }),

    createProject: vi.fn(async (input: Record<string, unknown>) => ({
      success: true,
      project: { id: `project-new-${Date.now()}`, name: input.name as string },
    })),

    updateProject: vi.fn(async (id: string, input: Record<string, unknown>) => ({
      success: true,
      project: { id, name: (input.name as string) ?? 'Updated Project' },
    })),

    createComment: vi.fn(async (input: Record<string, unknown>) => ({
      success: true,
      comment: { id: `comment-new-${Date.now()}` },
    })),

    updateComment: vi.fn(async (id: string, input: Record<string, unknown>) => ({
      success: true,
      comment: { id },
    })),

    // Raw GraphQL client for rawRequest calls (used by list-issues, list-my-issues, etc.)
    client: {
      rawRequest: vi.fn(async (query: string, variables?: Record<string, unknown>) => {
        calls.rawRequest.push({ query, variables });

        const filter = variables?.filter as Record<string, unknown> | undefined;

        // Helper to apply filters to issues
        const applyFilters = async (issuesToFilter: MockIssue[]): Promise<MockIssue[]> => {
          if (!filter) return issuesToFilter;

          const results: MockIssue[] = [];

          for (const issue of issuesToFilter) {
            const stateData = await issue.state;
            const projectData = await issue.project;
            const assigneeData = await issue.assignee;

            let matches = true;

            // State type filter
            if (filter.state && typeof filter.state === 'object') {
              const stateFilter = filter.state as Record<string, unknown>;
              if (stateFilter.type && typeof stateFilter.type === 'object') {
                const typeFilter = stateFilter.type as Record<string, unknown>;
                if (typeFilter.eq && stateData?.type !== typeFilter.eq) {
                  matches = false;
                }
                if (typeFilter.neq && stateData?.type === typeFilter.neq) {
                  matches = false;
                }
                if (typeFilter.in && Array.isArray(typeFilter.in)) {
                  if (!typeFilter.in.includes(stateData?.type)) {
                    matches = false;
                  }
                }
              }
            }

            // Team filter
            if (filter.team && typeof filter.team === 'object') {
              const teamFilter = filter.team as Record<string, unknown>;
              if (teamFilter.id && typeof teamFilter.id === 'object') {
                const idFilter = teamFilter.id as Record<string, unknown>;
                const issueTeamId =
                  typeof issue.team === 'function'
                    ? (await issue.team()).id
                    : issue.team?.id;
                if (idFilter.eq && issueTeamId !== idFilter.eq) {
                  matches = false;
                }
              }
            }

            // Project filter
            if (filter.project && typeof filter.project === 'object') {
              const projectFilter = filter.project as Record<string, unknown>;
              if (projectFilter.id && typeof projectFilter.id === 'object') {
                const idFilter = projectFilter.id as Record<string, unknown>;
                if (idFilter.eq && projectData?.id !== idFilter.eq) {
                  matches = false;
                }
              }
            }

            // Assignee filter
            if (filter.assignee && typeof filter.assignee === 'object') {
              const assigneeFilter = filter.assignee as Record<string, unknown>;
              if (assigneeFilter.id && typeof assigneeFilter.id === 'object') {
                const idFilter = assigneeFilter.id as Record<string, unknown>;
                if (idFilter.eq && assigneeData?.id !== idFilter.eq) {
                  matches = false;
                }
              }
            }

            // Title keyword filter (OR logic)
            if (filter.or && Array.isArray(filter.or)) {
              const orMatches = filter.or.some((orFilter: Record<string, unknown>) => {
                if (orFilter.title && typeof orFilter.title === 'object') {
                  const titleFilter = orFilter.title as Record<string, unknown>;
                  if (titleFilter.containsIgnoreCase) {
                    return issue.title
                      .toLowerCase()
                      .includes((titleFilter.containsIgnoreCase as string).toLowerCase());
                  }
                }
                return false;
              });
              if (!orMatches) {
                matches = false;
              }
            }

            // Date filters
            if (filter.updatedAt && typeof filter.updatedAt === 'object') {
              const dateFilter = filter.updatedAt as Record<string, unknown>;
              if (dateFilter.gte) {
                const minDate = new Date(dateFilter.gte as string);
                if (issue.updatedAt < minDate) {
                  matches = false;
                }
              }
              if (dateFilter.lte) {
                const maxDate = new Date(dateFilter.lte as string);
                if (issue.updatedAt > maxDate) {
                  matches = false;
                }
              }
            }

            if (matches) {
              results.push(issue);
            }
          }

          return results;
        };

        // Helper to format issue nodes for GraphQL response
        const formatIssueNodes = async (issuesToFormat: MockIssue[]) => {
          return await Promise.all(
            issuesToFormat.map(async (issue) => {
              const stateData = await issue.state;
              const projectData = await issue.project;
              const assigneeData = await issue.assignee;

              return {
                id: issue.id,
                identifier: issue.identifier,
                title: issue.title,
                description: issue.description,
                priority: issue.priority,
                estimate: issue.estimate,
                state: stateData,
                project: projectData,
                assignee: assigneeData,
                createdAt: issue.createdAt.toISOString(),
                updatedAt: issue.updatedAt.toISOString(),
                archivedAt: issue.archivedAt?.toISOString() ?? null,
                dueDate: issue.dueDate ?? null,
                url: issue.url ?? null,
                labels: { nodes: [] },
              };
            }),
          );
        };

        // Detect query type and return appropriate mock data
        if (query.includes('assignedIssues(')) {
          // list_my_issues query (viewer.assignedIssues)
          const limit = (variables?.first as number) ?? 20;
          const filtered = await applyFilters(issues);
          const limited = filtered.slice(0, limit);
          const issueNodes = await formatIssueNodes(limited);

          return {
            data: {
              viewer: {
                assignedIssues: {
                  nodes: issueNodes,
                  pageInfo: {
                    endCursor: filtered.length > limit ? 'cursor-next' : null,
                  },
                },
              },
            },
          };
        }

        if (query.includes('issues(')) {
          // list_issues query
          const limit = (variables?.first as number) ?? 25;
          const filtered = await applyFilters(issues);
          const limited = filtered.slice(0, limit);
          const issueNodes = await formatIssueNodes(limited);

          return {
            data: {
              issues: {
                nodes: issueNodes,
                pageInfo: {
                  hasNextPage: filtered.length > limit,
                  endCursor: filtered.length > limit ? 'cursor-next' : null,
                },
              },
            },
          };
        }

        // Default empty response for unknown queries
        return { data: {} };
      }),
    },

    _config: config,
    _calls: calls,
  };
}

/**
 * Reset all mock function calls.
 * Call this in beforeEach to ensure clean state.
 */
export function resetMockCalls(client: MockLinearClient): void {
  client._calls.issues = [];
  client._calls.createIssue = [];
  client._calls.updateIssue = [];
  client._calls.rawRequest = [];

  // Reset vi.fn() call history
  (client.teams as ReturnType<typeof vi.fn>).mockClear();
  (client.team as ReturnType<typeof vi.fn>).mockClear();
  (client.issues as ReturnType<typeof vi.fn>).mockClear();
  (client.issue as ReturnType<typeof vi.fn>).mockClear();
  (client.users as ReturnType<typeof vi.fn>).mockClear();
  (client.favorites as ReturnType<typeof vi.fn>).mockClear();
  (client.projects as ReturnType<typeof vi.fn>).mockClear();
  (client.cycles as ReturnType<typeof vi.fn>).mockClear();
  (client.comments as ReturnType<typeof vi.fn>).mockClear();
  (client.createIssue as ReturnType<typeof vi.fn>).mockClear();
  (client.updateIssue as ReturnType<typeof vi.fn>).mockClear();
  (client.createProject as ReturnType<typeof vi.fn>).mockClear();
  (client.updateProject as ReturnType<typeof vi.fn>).mockClear();
  (client.createComment as ReturnType<typeof vi.fn>).mockClear();
  (client.client.rawRequest as ReturnType<typeof vi.fn>).mockClear();
}

