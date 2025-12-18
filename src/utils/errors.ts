/**
 * Error types and hints for LLM-friendly error handling.
 * Every error includes a hint guiding the LLM to the next action.
 */

export type ErrorCode =
  | 'NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'TEAM_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'ISSUE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'FILTER_INVALID'
  | 'CYCLES_DISABLED'
  | 'LINEAR_API_ERROR'
  | 'LINEAR_CREATE_ERROR'
  | 'LINEAR_UPDATE_ERROR';

export interface ToolError {
  code: ErrorCode;
  message: string;
  hint: string;
}

/**
 * Default hints for each error code.
 * These guide the LLM on what to do next.
 */
export const ERROR_HINTS: Record<ErrorCode, string> = {
  NOT_FOUND: 'Use workspace_metadata or list tools to find valid IDs.',
  USER_NOT_FOUND:
    'Use list_users to see available users. You can search by name or email.',
  TEAM_NOT_FOUND:
    'Use workspace_metadata with include=["teams"] to see available teams and their IDs.',
  PROJECT_NOT_FOUND:
    'Use list_projects to see available projects. Check teamId filter if specified.',
  ISSUE_NOT_FOUND:
    'Use list_issues to find valid issue IDs. Check if the issue was archived.',
  PERMISSION_DENIED:
    'You may not have access to this resource. Use workspace_metadata to see accessible teams and projects.',
  RATE_LIMITED:
    'Linear API rate limit reached. Wait 10-30 seconds and retry. Consider reducing batch size.',
  VALIDATION_ERROR:
    'Check the input format matches the schema. See tool description for examples.',
  FILTER_INVALID:
    'Filter syntax is incorrect. Valid comparators include: eq, neq, in, nin, lt, lte, gt, gte, contains, containsIgnoreCase, startsWith, endsWith, eqIgnoreCase, neqIgnoreCase, null. Example: { state: { type: { eq: "started" } } }',
  CYCLES_DISABLED:
    'This team has cycles disabled. Alternatives: use list_projects for milestones, or labels to group issues by phase. Check workspace_metadata for teams with cyclesEnabled=true.',
  LINEAR_API_ERROR:
    'Linear API returned an error. Retry the operation. If persistent, verify IDs with workspace_metadata.',
  LINEAR_CREATE_ERROR:
    'Failed to create resource. Verify teamId and other IDs exist. Use workspace_metadata to discover valid IDs.',
  LINEAR_UPDATE_ERROR:
    'Failed to update resource. Verify the ID exists and you have permission. Use list tools to find valid IDs.',
};

/**
 * Create a standardized error response for tools.
 */
export function createToolError(
  code: ErrorCode,
  message: string,
  customHint?: string,
): ToolError {
  return {
    code,
    message,
    hint: customHint ?? ERROR_HINTS[code],
  };
}

/**
 * Format error for tool result content.
 */
export function formatErrorMessage(error: ToolError): string {
  return `Error: ${error.message}\n\nNext steps: ${error.hint}`;
}

/**
 * Detect error type from Linear API error message.
 */
export function detectErrorCode(error: Error | string): ErrorCode {
  const msg = typeof error === 'string' ? error : error.message;
  const lower = msg.toLowerCase();

  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'RATE_LIMITED';
  }
  if (lower.includes('not found') || lower.includes('does not exist')) {
    if (lower.includes('user')) return 'USER_NOT_FOUND';
    if (lower.includes('team')) return 'TEAM_NOT_FOUND';
    if (lower.includes('project')) return 'PROJECT_NOT_FOUND';
    if (lower.includes('issue')) return 'ISSUE_NOT_FOUND';
    return 'NOT_FOUND';
  }
  if (
    lower.includes('permission') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return 'PERMISSION_DENIED';
  }
  if (lower.includes('validation') || lower.includes('invalid')) {
    return 'VALIDATION_ERROR';
  }

  return 'LINEAR_API_ERROR';
}

/**
 * Create error from caught exception with auto-detected code.
 */
export function createErrorFromException(
  error: Error,
  fallbackCode: ErrorCode = 'LINEAR_API_ERROR',
): ToolError {
  const code = detectErrorCode(error);
  return createToolError(code, error.message);
}

/**
 * Valid GraphQL filter comparators.
 */
export const VALID_COMPARATORS = [
  'eq',
  'neq',
  'in',
  'nin',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'notContains',
  'containsIgnoreCase',
  'notContainsIgnoreCase',
  'startsWith',
  'notStartsWith',
  'endsWith',
  'notEndsWith',
  'eqIgnoreCase',
  'neqIgnoreCase',
  'null',
] as const;

/**
 * Valid logical operators for combining filters.
 */
export const LOGICAL_OPERATORS = ['and', 'or', 'not'] as const;

/**
 * Validate a GraphQL-style filter object.
 * Returns validation result with helpful error messages.
 */
export function validateFilter(
  filter: Record<string, unknown>,
  path = '',
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [key, value] of Object.entries(filter)) {
    const currentPath = path ? `${path}.${key}` : key;

    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value !== 'object') {
      // Leaf value - should be inside a comparator, not at field level
      if (!VALID_COMPARATORS.includes(key as (typeof VALID_COMPARATORS)[number])) {
        errors.push(
          `Invalid structure at "${currentPath}": values must be wrapped in comparators like { eq: value }`,
        );
      }
      continue;
    }

    // Check if this is a comparator object or nested field
    const subKeys = Object.keys(value as object);

    for (const subKey of subKeys) {
      const isComparator = VALID_COMPARATORS.includes(
        subKey as (typeof VALID_COMPARATORS)[number],
      );
      const isLogical = LOGICAL_OPERATORS.includes(subKey as (typeof LOGICAL_OPERATORS)[number]);

      if (!isComparator && !isLogical) {
        // Could be a nested field (e.g., state.type) - recurse
        const nested = validateFilter(
          { [subKey]: (value as Record<string, unknown>)[subKey] },
          currentPath,
        );
        errors.push(...nested.errors);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Zero-result hints based on filter context.
 */
export function getZeroResultHints(context: {
  hasStateFilter?: boolean;
  hasDateFilter?: boolean;
  hasTeamFilter?: boolean;
  hasAssigneeFilter?: boolean;
  hasProjectFilter?: boolean;
  hasKeywordFilter?: boolean;
}): string[] {
  const hints: string[] = [];

  if (context.hasStateFilter) {
    hints.push(
      'Try removing or changing the state filter (e.g., remove neq:completed to include all states).',
    );
  }
  if (context.hasDateFilter) {
    hints.push('Expand the date range (e.g., last 6 months instead of 1 month).');
  }
  if (context.hasTeamFilter) {
    hints.push('Verify teamId exists using workspace_metadata.');
  }
  if (context.hasAssigneeFilter) {
    hints.push('Remove assignee filter, or verify user ID with list_users.');
  }
  if (context.hasProjectFilter) {
    hints.push('Remove project filter, or verify project ID with list_projects.');
  }
  if (context.hasKeywordFilter) {
    hints.push('Try different keywords or remove the keyword filter.');
  }

  if (hints.length === 0) {
    hints.push('Try broader filters or verify IDs with workspace_metadata.');
  }

  return hints;
}

