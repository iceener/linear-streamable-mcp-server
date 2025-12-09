/**
 * Cache management for team settings and other frequently accessed data
 */

import type { LinearClient } from '@linear/sdk';

/**
 * Get whether a team allows zero estimates (with caching)
 */
export async function getTeamAllowsZeroEstimate(
  teamId: string,
  client: LinearClient,
  cache: Map<string, boolean>,
): Promise<boolean> {
  // Check cache first
  if (cache.has(teamId)) {
    return cache.get(teamId) === true;
  }

  // Fetch from API
  try {
    const team = await client.team(teamId);
    const allowZero =
      ((team as unknown as { issueEstimationAllowZero?: boolean })
        .issueEstimationAllowZero ?? false) === true;

    cache.set(teamId, allowZero);
    return allowZero;
  } catch {
    cache.set(teamId, false);
    return false;
  }
}

/**
 * Create a new team settings cache
 */
export function createTeamSettingsCache(): Map<string, boolean> {
  return new Map<string, boolean>();
}















