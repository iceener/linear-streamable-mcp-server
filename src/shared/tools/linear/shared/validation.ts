/**
 * Validation utilities for issue fields
 */

import type { LinearClient } from '@linear/sdk';

/**
 * Validate and process estimate value based on team settings
 */
export async function validateEstimate(
  estimate: number | undefined,
  teamId: string | undefined,
  teamAllowZeroCache: Map<string, boolean>,
  client: LinearClient,
  allowZeroEstimate?: boolean,
): Promise<number | undefined> {
  if (typeof estimate !== 'number') {
    return undefined;
  }

  if (estimate > 0) {
    return estimate;
  }

  if (estimate === 0) {
    let allowZero = allowZeroEstimate === true;

    if (!allowZero && teamId) {
      // Check cache first
      if (teamAllowZeroCache.has(teamId)) {
        allowZero = teamAllowZeroCache.get(teamId) === true;
      } else {
        // Fetch team settings
        try {
          const team = await client.team(teamId);
          allowZero =
            ((team as unknown as { issueEstimationAllowZero?: boolean })
              .issueEstimationAllowZero ?? false) === true;
          teamAllowZeroCache.set(teamId, allowZero);
        } catch {
          allowZero = false;
        }
      }
    }

    if (allowZero) {
      return 0;
    }
  }

  return undefined;
}

/**
 * Validate priority value.
 * Linear priority: 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.
 */
export function validatePriority(
  priority: number | string | undefined,
): number | undefined {
  if (typeof priority === 'undefined') {
    return undefined;
  }

  const n = typeof priority === 'string' ? Number(priority) : priority;
  // Validate range 0-4 per Linear API
  if (Number.isInteger(n) && n >= 0 && n <= 4) {
    return n;
  }

  return undefined;
}

/**
 * Clean payload by removing empty strings and invalid values
 */
export function cleanPayload<T extends Record<string, unknown>>(input: T): Partial<T> {
  const cleaned: Partial<T> = {};

  for (const [key, value] of Object.entries(input)) {
    // Skip empty strings
    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }

    // Skip undefined
    if (value === undefined) {
      continue;
    }

    cleaned[key as keyof T] = value as T[keyof T];
  }

  return cleaned;
}

/**
 * Validate that a field should be included in the payload
 */
export function shouldIncludeField(value: unknown, allowEmpty = false): boolean {
  // Always exclude undefined
  if (value === undefined) {
    return false;
  }

  // Handle strings
  if (typeof value === 'string') {
    return allowEmpty || value.trim() !== '';
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return allowEmpty || value.length > 0;
  }

  // Include all other values
  return true;
}

























