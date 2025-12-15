/**
 * User resolver utility for resolving names/emails to user IDs.
 * Supports fuzzy matching for names and exact matching for emails.
 */

import type { LinearClient } from '@linear/sdk';
import { createToolError, type ToolError } from './errors.js';

export interface ResolvedUser {
  id: string;
  name?: string;
  email?: string;
}

export interface UserResolutionResult {
  success: boolean;
  user?: ResolvedUser;
  error?: ToolError;
  candidates?: ResolvedUser[]; // For ambiguous matches
}

/**
 * Normalize string for fuzzy matching (removes diacritics, lowercases).
 * "Łukasz" → "lukasz", "José" → "jose"
 */
function normalizeForSearch(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Cache for users list to avoid repeated API calls.
 */
let userCache: ResolvedUser[] | null = null;
let userCacheTimestamp = 0;
const USER_CACHE_TTL_MS = 60000; // 1 minute

/**
 * Fetch all users and cache them.
 */
async function fetchUsers(client: LinearClient): Promise<ResolvedUser[]> {
  const now = Date.now();

  if (userCache && now - userCacheTimestamp < USER_CACHE_TTL_MS) {
    return userCache;
  }

  const usersConn = await client.users({ first: 250 }); // Linear default max
  userCache = usersConn.nodes.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
  }));
  userCacheTimestamp = now;

  return userCache;
}

/**
 * Clear user cache (useful after user changes).
 */
export function clearUserCache(): void {
  userCache = null;
  userCacheTimestamp = 0;
}

/**
 * Resolve a user by email (exact match, case-insensitive).
 */
export async function resolveUserByEmail(
  client: LinearClient,
  email: string,
): Promise<UserResolutionResult> {
  const users = await fetchUsers(client);
  const normalizedEmail = email.toLowerCase().trim();

  const match = users.find((u) => u.email?.toLowerCase() === normalizedEmail);

  if (match) {
    return { success: true, user: match };
  }

  return {
    success: false,
    error: createToolError(
      'USER_NOT_FOUND',
      `No user found with email "${email}".`,
      `Use list_users to see available users and their emails.`,
    ),
  };
}

/**
 * Resolve a user by name (fuzzy match).
 * - Exact match preferred
 * - Partial match (name contains search term)
 * - Multiple matches returns candidates for disambiguation
 */
export async function resolveUserByName(
  client: LinearClient,
  name: string,
): Promise<UserResolutionResult> {
  const users = await fetchUsers(client);
  const normalizedSearch = normalizeForSearch(name);

  // Try exact match first
  const exactMatch = users.find(
    (u) => u.name && normalizeForSearch(u.name) === normalizedSearch,
  );

  if (exactMatch) {
    return { success: true, user: exactMatch };
  }

  // Try partial matches (name contains search term)
  const partialMatches = users.filter(
    (u) => u.name && normalizeForSearch(u.name).includes(normalizedSearch),
  );

  if (partialMatches.length === 1) {
    return { success: true, user: partialMatches[0] };
  }

  if (partialMatches.length > 1) {
    // Multiple matches - return candidates for disambiguation
    return {
      success: false,
      error: createToolError(
        'USER_NOT_FOUND',
        `Multiple users match "${name}": ${partialMatches.map((u) => u.name).join(', ')}`,
        `Be more specific or use assigneeEmail for exact matching. Candidates: ${partialMatches.map((u) => `${u.name} (${u.id})`).join(', ')}`,
      ),
      candidates: partialMatches,
    };
  }

  // No matches - try even fuzzier matching (any word match)
  const searchWords = normalizedSearch.split(/\s+/).filter(Boolean);
  const wordMatches = users.filter((u) => {
    if (!u.name) return false;
    const nameWords = normalizeForSearch(u.name).split(/\s+/);
    return searchWords.some((sw) => nameWords.some((nw) => nw.includes(sw) || sw.includes(nw)));
  });

  if (wordMatches.length === 1) {
    return { success: true, user: wordMatches[0] };
  }

  if (wordMatches.length > 1) {
    return {
      success: false,
      error: createToolError(
        'USER_NOT_FOUND',
        `Multiple users partially match "${name}": ${wordMatches.map((u) => u.name).join(', ')}`,
        `Be more specific. Did you mean: ${wordMatches.map((u) => `"${u.name}"`).join(' or ')}?`,
      ),
      candidates: wordMatches,
    };
  }

  return {
    success: false,
    error: createToolError(
      'USER_NOT_FOUND',
      `No user found matching "${name}".`,
      `Use list_users to see available users. Check spelling or try a different name.`,
    ),
  };
}

/**
 * Resolve assignee from either assigneeId, assigneeName, or assigneeEmail.
 * Priority: assigneeId > assigneeEmail > assigneeName
 */
export async function resolveAssignee(
  client: LinearClient,
  options: {
    assigneeId?: string;
    assigneeName?: string;
    assigneeEmail?: string;
  },
): Promise<UserResolutionResult> {
  // If assigneeId is provided, use it directly
  if (options.assigneeId) {
    return { success: true, user: { id: options.assigneeId } };
  }

  // If email is provided, resolve by email (more reliable)
  if (options.assigneeEmail) {
    return resolveUserByEmail(client, options.assigneeEmail);
  }

  // If name is provided, resolve by name (fuzzy)
  if (options.assigneeName) {
    return resolveUserByName(client, options.assigneeName);
  }

  // No assignee specified - return success with no user (will use default)
  return { success: true };
}

