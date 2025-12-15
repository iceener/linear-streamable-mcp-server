/**
 * Tests for list_cycles tool.
 * Verifies: cycle listing, team filtering, cyclesEnabled check, output shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listCyclesTool } from '../../src/shared/tools/linear/cycles.js';
import {
  createMockLinearClient,
  resetMockCalls,
  type MockLinearClient,
  defaultMockCycles,
} from '../mocks/linear-client.js';
import type { ToolContext } from '../../src/shared/tools/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

let mockClient: MockLinearClient;

const baseContext: ToolContext = {
  sessionId: 'test-session',
  providerToken: 'test-token',
  authStrategy: 'bearer',
};

vi.mock('../../src/services/linear/client.js', () => ({
  getLinearClient: vi.fn(() => Promise.resolve(mockClient)),
}));

beforeEach(() => {
  mockClient = createMockLinearClient({ cycles: defaultMockCycles });
  resetMockCalls(mockClient);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Metadata Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles tool metadata', () => {
  it('has correct name and title', () => {
    expect(listCyclesTool.name).toBe('list_cycles');
    expect(listCyclesTool.title).toBe('List Cycles');
  });

  it('has readOnlyHint annotation', () => {
    expect(listCyclesTool.annotations?.readOnlyHint).toBe(true);
    expect(listCyclesTool.annotations?.destructiveHint).toBe(false);
  });

  it('description mentions cyclesEnabled requirement', () => {
    expect(listCyclesTool.description).toContain('cyclesEnabled');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles input validation', () => {
  it('requires teamId parameter', () => {
    const result = listCyclesTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts valid teamId', () => {
    const result = listCyclesTool.inputSchema.safeParse({ teamId: 'team-eng' });
    expect(result.success).toBe(true);
  });

  it('accepts optional limit', () => {
    const result = listCyclesTool.inputSchema.safeParse({ teamId: 'team-eng', limit: 10 });
    expect(result.success).toBe(true);
  });

  it('accepts optional cursor for pagination', () => {
    const result = listCyclesTool.inputSchema.safeParse({
      teamId: 'team-eng',
      cursor: 'test-cursor',
    });
    expect(result.success).toBe(true);
  });

  it('accepts includeArchived option', () => {
    const result = listCyclesTool.inputSchema.safeParse({
      teamId: 'team-eng',
      includeArchived: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts orderBy parameter', () => {
    const result = listCyclesTool.inputSchema.safeParse({
      teamId: 'team-eng',
      orderBy: 'createdAt',
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles handler', () => {
  it('returns cycles for specified team', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
    expect(Array.isArray(structured.items)).toBe(true);
  });

  it('filters cycles by team', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    // All cycles should belong to the requested team
    for (const item of items) {
      expect(item.teamId).toBe('team-eng');
    }
  });

  it('respects limit parameter', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng', limit: 1 }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.limit).toBe(1);
  });

  it('supports pagination with cursor', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', cursor: 'test-cursor' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.cursor).toBe('test-cursor');
  });

  it('supports ordering by updatedAt', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', orderBy: 'updatedAt' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
  });

  it('supports ordering by createdAt', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', orderBy: 'createdAt' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
  });

  it('supports includeArchived option', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', includeArchived: true },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles output shape', () => {
  it('matches ListCyclesOutputSchema', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.items).toBeDefined();
    const items = structured.items as Array<Record<string, unknown>>;

    for (const item of items) {
      expect(item.id).toBeDefined();
      expect(item.teamId).toBeDefined();
      expect(typeof item.id).toBe('string');
      expect(typeof item.teamId).toBe('string');
    }
  });

  it('includes cycle metadata (name, number, dates)', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items.length).toBeGreaterThan(0);
    
    const firstCycle = items[0];
    expect(firstCycle.name).toBeDefined();
    expect(firstCycle.number).toBeDefined();
  });

  it('includes pagination info', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    expect('nextCursor' in structured || 'cursor' in structured).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Common Workflow Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles common workflows', () => {
  it('lists cycles with team ID association', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    // All cycles should be associated with the requested team
    for (const cycle of items) {
      expect(cycle.teamId).toBe('team-eng');
    }
  });

  it('provides cycle dates for sprint planning', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items.length).toBeGreaterThan(0);

    // Cycles should have start/end dates for planning
    const firstCycle = items[0];
    expect(firstCycle.startsAt).toBeDefined();
    expect(firstCycle.endsAt).toBeDefined();
  });

  it('provides cycle number for identification', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items.length).toBeGreaterThan(0);

    // Cycles should have number for easy reference
    const firstCycle = items[0];
    expect(firstCycle.number).toBeDefined();
    expect(typeof firstCycle.number).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles edge cases', () => {
  it('returns error when team has cyclesEnabled=false', async () => {
    // team-design has cyclesEnabled=false
    const result = await listCyclesTool.handler({ teamId: 'team-design' }, baseContext);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cycles are disabled');
  });

  it('returns empty list when team has no cycles but cyclesEnabled=true', async () => {
    // Create a team with cycles enabled but no cycles
    mockClient = createMockLinearClient({
      teams: [
        {
          id: 'team-new',
          key: 'NEW',
          name: 'New Team',
          cyclesEnabled: true,
          states: () => Promise.resolve({ nodes: [] }),
          labels: () => Promise.resolve({ nodes: [] }),
          projects: () => Promise.resolve({ nodes: [] }),
          cycles: () => Promise.resolve({ nodes: [], pageInfo: { hasNextPage: false } }),
        },
      ],
      cycles: [],
    });

    const result = await listCyclesTool.handler({ teamId: 'team-new' }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items).toEqual([]);
  });
});

