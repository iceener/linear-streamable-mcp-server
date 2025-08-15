type Json = Record<string, unknown>;

const COMPARATOR_KEYS = new Set([
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'nin',
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
]);

const STATE_TYPE_ALIASES: Record<string, string> = {
  active: 'started',
  in_progress: 'started',
  'in progress': 'started',
  done: 'completed',
  closed: 'completed',
  open: 'unstarted',
};

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wrapComparator(value: unknown): unknown {
  if (isPlainObject(value)) {
    // If object already looks like comparator object, keep it
    const keys = Object.keys(value);
    if (keys.some((k) => COMPARATOR_KEYS.has(k))) {
      return value;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return { in: value };
  }
  return { eq: value };
}

function setNested(target: Json, path: string[], rawValue: unknown): void {
  let value = rawValue;
  // Map aliases for state.type values
  if (
    path.length >= 2 &&
    path[path.length - 2] === 'state' &&
    path[path.length - 1] === 'type' &&
    typeof value === 'string'
  ) {
    const mapped = STATE_TYPE_ALIASES[value.toLowerCase()];
    if (mapped) {
      value = mapped;
    }
  }
  const lastIdx = path.length - 1;
  let cur: Json = target;
  for (let i = 0; i < lastIdx; i++) {
    const key = path[i] as string;
    const next = cur[key];
    if (!isPlainObject(next)) {
      cur[key] = {};
    }
    cur = cur[key] as Json;
  }
  const leafKey = path[lastIdx] as string;
  cur[leafKey] = wrapComparator(value);
}

export function normalizeIssueFilter(
  input?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!input) {
    return undefined;
  }
  const result: Json = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.includes('.')) {
      const parts = key.split('.').filter(Boolean);
      if (parts.length > 0) {
        setNested(result, parts, value);
      }
    } else {
      // Keep existing structured filters as-is
      result[key] = isPlainObject(value) ? value : wrapComparator(value);
    }
  }
  return result;
}
