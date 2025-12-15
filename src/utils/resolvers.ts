/**
 * Resolvers for human-readable names → Linear IDs
 * Allows using "High" instead of 2, "Done" instead of UUID, etc.
 */

import type { LinearClient } from '@linear/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// Priority Resolution
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_MAP: Record<string, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  normal: 3,
  low: 4,
};

const PRIORITY_NAMES: Record<number, string> = {
  0: 'None',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export type PriorityInput = number | string;

export interface ResolveResult<T> {
  success: true;
  value: T;
}

export interface ResolveError {
  success: false;
  error: string;
  suggestions?: string[];
}

export type ResolverResult<T> = ResolveResult<T> | ResolveError;

/**
 * Resolve priority from number or string
 * Accepts: 0-4, "None", "Urgent", "High", "Medium", "Normal", "Low"
 */
export function resolvePriority(input: PriorityInput): ResolverResult<number> {
  if (typeof input === 'number') {
    if (input >= 0 && input <= 4) {
      return { success: true, value: input };
    }
    return {
      success: false,
      error: `Invalid priority number: ${input}. Must be 0-4.`,
      suggestions: ['0=None, 1=Urgent, 2=High, 3=Medium, 4=Low'],
    };
  }

  const normalized = input.toLowerCase().trim();
  const value = PRIORITY_MAP[normalized];

  if (value !== undefined) {
    return { success: true, value };
  }

  return {
    success: false,
    error: `Unknown priority: "${input}"`,
    suggestions: ['Valid values: None, Urgent, High, Medium, Normal, Low (or 0-4)'],
  };
}

/**
 * Format priority number as human-readable string
 */
export function formatPriorityName(priority: number): string {
  return PRIORITY_NAMES[priority] ?? `P${priority}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// State Resolution
// ─────────────────────────────────────────────────────────────────────────────

export type StateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

const VALID_STATE_TYPES: StateType[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

export interface StateInfo {
  id: string;
  name: string;
  type: StateType;
}

/**
 * Resolve state by name or type within a team
 */
export async function resolveState(
  client: LinearClient,
  teamId: string,
  input: { stateName?: string; stateType?: StateType },
): Promise<ResolverResult<string>> {
  if (!input.stateName && !input.stateType) {
    return { success: false, error: 'Must provide stateName or stateType' };
  }

  // Validate stateType if provided
  if (input.stateType && !VALID_STATE_TYPES.includes(input.stateType)) {
    return {
      success: false,
      error: `Invalid stateType: "${input.stateType}"`,
      suggestions: [`Valid types: ${VALID_STATE_TYPES.join(', ')}`],
    };
  }

  try {
    const team = await client.team(teamId);
    const states = await team.states();
    const stateList = states.nodes as StateInfo[];

    // Try to match by name first (exact, case-insensitive)
    if (input.stateName) {
      const normalized = input.stateName.toLowerCase().trim();
      const match = stateList.find((s) => s.name.toLowerCase() === normalized);

      if (match) {
        return { success: true, value: match.id };
      }

      // Fuzzy match suggestions
      const similar = stateList
        .filter((s) => s.name.toLowerCase().includes(normalized) || normalized.includes(s.name.toLowerCase()))
        .map((s) => s.name);

      return {
        success: false,
        error: `State "${input.stateName}" not found in team`,
        suggestions: similar.length > 0
          ? [`Did you mean: ${similar.join(', ')}?`]
          : [`Available states: ${stateList.map((s) => s.name).join(', ')}`],
      };
    }

    // Match by type
    if (input.stateType) {
      const matches = stateList.filter((s) => s.type === input.stateType);

      if (matches.length === 1) {
        return { success: true, value: matches[0].id };
      }

      if (matches.length > 1) {
        // Multiple states of same type - return first one but warn
        // This is common (e.g., multiple "completed" states like "Done", "Merged")
        return { success: true, value: matches[0].id };
      }

      return {
        success: false,
        error: `No state with type "${input.stateType}" found in team`,
        suggestions: [`Available types in this team: ${[...new Set(stateList.map((s) => s.type))].join(', ')}`],
      };
    }

    return { success: false, error: 'Unexpected resolver state' };
  } catch (e) {
    return {
      success: false,
      error: `Failed to fetch team states: ${(e as Error).message}`,
    };
  }
}

/**
 * Get team ID from an issue (for update operations)
 */
export async function getIssueTeamId(client: LinearClient, issueId: string): Promise<string | null> {
  try {
    const issue = await client.issue(issueId);
    const team = await issue.team;
    return team?.id ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Label Resolution
// ─────────────────────────────────────────────────────────────────────────────

export interface LabelInfo {
  id: string;
  name: string;
}

/**
 * Resolve label names to IDs within a team
 */
export async function resolveLabels(
  client: LinearClient,
  teamId: string,
  labelNames: string[],
): Promise<ResolverResult<string[]>> {
  if (labelNames.length === 0) {
    return { success: true, value: [] };
  }

  try {
    const team = await client.team(teamId);
    const labels = await team.labels();
    const labelList = labels.nodes as LabelInfo[];

    const resolved: string[] = [];
    const notFound: string[] = [];

    for (const name of labelNames) {
      const normalized = name.toLowerCase().trim();
      const match = labelList.find((l) => l.name.toLowerCase() === normalized);

      if (match) {
        resolved.push(match.id);
      } else {
        notFound.push(name);
      }
    }

    if (notFound.length > 0) {
      return {
        success: false,
        error: `Labels not found: ${notFound.join(', ')}`,
        suggestions: [`Available labels: ${labelList.map((l) => l.name).join(', ')}`],
      };
    }

    return { success: true, value: resolved };
  } catch (e) {
    return {
      success: false,
      error: `Failed to fetch team labels: ${(e as Error).message}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve project by name
 */
export async function resolveProject(
  client: LinearClient,
  projectName: string,
): Promise<ResolverResult<string>> {
  try {
    const projects = await client.projects({ first: 100 });
    const normalized = projectName.toLowerCase().trim();

    const exactMatch = projects.nodes.find(
      (p) => p.name.toLowerCase() === normalized,
    );

    if (exactMatch) {
      return { success: true, value: exactMatch.id };
    }

    // Partial match suggestions
    const similar = projects.nodes
      .filter((p) => p.name.toLowerCase().includes(normalized))
      .map((p) => p.name)
      .slice(0, 5);

    return {
      success: false,
      error: `Project "${projectName}" not found`,
      suggestions: similar.length > 0
        ? [`Similar projects: ${similar.join(', ')}`]
        : ['Use workspace_metadata to list available projects'],
    };
  } catch (e) {
    return {
      success: false,
      error: `Failed to fetch projects: ${(e as Error).message}`,
    };
  }
}

