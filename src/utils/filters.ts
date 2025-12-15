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
  // Common ID alias → relation.id mapping
  const idAliasMap: Record<string, string[]> = {
    stateId: ['state', 'id'],
    projectId: ['project', 'id'],
    assigneeId: ['assignee', 'id'],
    teamId: ['team', 'id'],
    // labelIds is many-to-many; map to labels.id
    labelIds: ['labels', 'id'],
  };
  // Helper: convert identifier like "ENG-123" → team.key + number
  const setFromIdentifier = (identifierValue: unknown) => {
    const extract = (value: unknown): string | undefined => {
      if (typeof value === 'string') {
        return value;
      }
      if (isPlainObject(value)) {
        const obj = value as Record<string, unknown>;
        const eqVal = obj.eq ?? obj.eqIgnoreCase;
        if (typeof eqVal === 'string') {
          return eqVal;
        }
      }
      return undefined;
    };
    const raw = extract(identifierValue);
    if (!raw) {
      return false;
    }
    const match = String(raw)
      .trim()
      .match(/^([A-Za-z]+)[-\s]?([0-9]+)$/);
    if (!match) {
      return false;
    }
    const teamKey = match[1]?.toUpperCase();
    const issueNumber = Number(match[2]);
    if (!Number.isFinite(issueNumber)) {
      return false;
    }
    setNested(result, ['team', 'key'], teamKey);
    setNested(result, ['number'], issueNumber);
    return true;
  };
  for (const [key, value] of Object.entries(input)) {
    // Map common *Id filters to relation.id per Linear GraphQL
    if (key in idAliasMap) {
      setNested(result, idAliasMap[key]!, value);
      continue;
    }
    if (key === 'identifier') {
      const ok = setFromIdentifier(value);
      if (ok) {
        continue;
      }
      // If parsing failed, try to use it as-is for id lookup
      // Linear accepts issue IDs in multiple formats
      const idValue =
        typeof value === 'string'
          ? value
          : (value as { eq?: string })?.eq ?? undefined;
      if (idValue) {
        // Could be a UUID - try id filter instead
        setNested(result, ['id'], idValue);
      }
      continue;
    }
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

























