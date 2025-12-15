/**
 * LLM UX Behavior Tests
 *
 * These tests verify that the MCP tools provide good UX for language models:
 * - Context bloat prevention (pagination hints when more results exist)
 * - Easy navigation through completed/cancelled issues with time ranges
 * - Clear guidance for common workflows
 * - Helpful error messages and zero-result hints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import { listMyIssuesTool } from '../../src/shared/tools/linear/list-my-issues.js';
import { workspaceMetadataTool } from '../../src/shared/tools/linear/workspace-metadata.js';
import {
  createMockLinearClient,
  resetMockCalls,
  type MockLinearClient,
  type MockIssue,
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
  mockClient = createMockLinearClient();
  resetMockCalls(mockClient);
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Generate many issues for pagination tests
// ─────────────────────────────────────────────────────────────────────────────

function generateManyIssues(count: number): MockIssue[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `issue-${String(i + 1).padStart(3, '0')}`,
    identifier: `ENG-${100 + i}`,
    title: `Issue ${i + 1}`,
    priority: (i % 4) + 1,
    createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - i * 12 * 60 * 60 * 1000),
    state: Promise.resolve({
      id: i % 3 === 0 ? 'state-done' : 'state-inprogress',
      name: i % 3 === 0 ? 'Done' : 'In Progress',
      type: i % 3 === 0 ? 'completed' : 'started',
    }),
    project: Promise.resolve(null),
    assignee: Promise.resolve({ id: 'user-001', name: 'Test User' }),
    labels: () => Promise.resolve({ nodes: [] }),
    attachments: () => Promise.resolve({ nodes: [] }),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Context Bloat Prevention
// ─────────────────────────────────────────────────────────────────────────────

describe('Context Bloat Prevention', () => {
  describe('when there are more results than the limit', () => {
    it('includes "more available" indicator in text output', async () => {
      // Create many issues to trigger pagination
      mockClient = createMockLinearClient({ issues: generateManyIssues(50) });

      const result = await listIssuesTool.handler({ limit: 10 }, baseContext);

      expect(result.isError).toBeFalsy();

      const textContent = result.content[0].text;
      expect(textContent).toContain('more available');
    });

    it('provides nextCursor in structuredContent for pagination', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(50) });

      const result = await listIssuesTool.handler({ limit: 10 }, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.nextCursor).toBeDefined();
      expect(typeof structured.nextCursor).toBe('string');
    });

    it('includes explicit pagination guidance in suggested next steps', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(50) });

      const result = await listIssuesTool.handler({ limit: 10 }, baseContext);

      const textContent = result.content[0].text;
      expect(textContent).toContain('cursor');
      expect(textContent).toContain('fetch');
    });

    it('shows count and limit for transparency', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(50) });

      const result = await listIssuesTool.handler({ limit: 10 }, baseContext);

      const textContent = result.content[0].text;
      // Should show something like "Issues: 10 (limit 10)"
      expect(textContent).toMatch(/Issues:\s*\d+.*limit\s*10/i);
    });
  });

  describe('when results fit within limit', () => {
    it('does NOT show "more available" when all results returned', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(5) });

      const result = await listIssuesTool.handler({ limit: 25 }, baseContext);

      const textContent = result.content[0].text;
      // Should not mention more available
      expect(textContent).not.toContain('more available');
    });

    it('nextCursor is undefined when no more pages', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(5) });

      const result = await listIssuesTool.handler({ limit: 25 }, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.nextCursor).toBeUndefined();
    });
  });

  describe('default limit behavior', () => {
    it('uses reasonable default limit (25) when not specified', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(50) });

      const result = await listIssuesTool.handler({}, baseContext);

      // Verify the query was made with default limit
      const call = mockClient._calls.rawRequest[0];
      expect(call.variables?.first).toBe(25);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Navigating Completed/Cancelled Issues
// ─────────────────────────────────────────────────────────────────────────────

describe('Navigating Completed/Cancelled Issues', () => {
  describe('filtering by state type', () => {
    it('returns ONLY completed issues when filtering by state.type.eq=completed', async () => {
      const result = await listIssuesTool.handler(
        { filter: { state: { type: { eq: 'completed' } } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify filter was passed to API
      const call = mockClient._calls.rawRequest[0];
      const filter = call.variables?.filter as Record<string, unknown>;
      expect(filter.state).toEqual({ type: { eq: 'completed' } });

      // Verify ACTUAL filtering worked - only completed issues returned
      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.stateName).toBe('Done');
      }
    });

    it('returns ONLY cancelled issues when filtering by state.type.eq=canceled', async () => {
      const result = await listIssuesTool.handler(
        { filter: { state: { type: { eq: 'canceled' } } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.stateName).toBe('Cancelled');
      }
    });

    it('EXCLUDES completed issues when filtering by state.type.neq=completed', async () => {
      const result = await listIssuesTool.handler(
        { filter: { state: { type: { neq: 'completed' } } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.stateName).not.toBe('Done');
      }
    });

    it('returns ONLY in-progress issues when filtering by state.type.eq=started', async () => {
      const result = await listIssuesTool.handler(
        { filter: { state: { type: { eq: 'started' } } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.stateName).toBe('In Progress');
      }
    });
  });

  describe('filtering by date range', () => {
    it('accepts updatedAt date range filter', async () => {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const result = await listIssuesTool.handler(
        {
          filter: {
            updatedAt: {
              gte: threeMonthsAgo.toISOString(),
            },
          },
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      const filter = call.variables?.filter as Record<string, unknown>;
      expect(filter.updatedAt).toBeDefined();
    });

    it('accepts completedAt date range for finished issues', async () => {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const result = await listIssuesTool.handler(
        {
          filter: {
            state: { type: { eq: 'completed' } },
            completedAt: {
              gte: threeMonthsAgo.toISOString(),
            },
          },
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      const filter = call.variables?.filter as Record<string, unknown>;
      expect(filter.state).toEqual({ type: { eq: 'completed' } });
      expect(filter.completedAt).toBeDefined();
    });

    it('supports combining state and date filters', async () => {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const result = await listIssuesTool.handler(
        {
          filter: {
            and: [
              { state: { type: { in: ['completed', 'canceled'] } } },
              { updatedAt: { gte: oneMonthAgo.toISOString() } },
            ],
          },
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      const filter = call.variables?.filter as Record<string, unknown>;
      expect(filter.and).toBeDefined();
    });
  });

  describe('includeArchived option', () => {
    it('allows including archived issues', async () => {
      const result = await listIssuesTool.handler(
        {
          filter: { state: { type: { eq: 'completed' } } },
          includeArchived: true,
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      expect(call.variables?.includeArchived).toBe(true);
    });

    it('excludes archived by default', async () => {
      const result = await listIssuesTool.handler({}, baseContext);

      const call = mockClient._calls.rawRequest[0];
      // includeArchived should be false or undefined (not explicitly true)
      expect(call.variables?.includeArchived).not.toBe(true);
    });
  });

  describe('ordering for historical queries', () => {
    it('supports ordering by updatedAt (default, preferred for recency)', async () => {
      const result = await listIssuesTool.handler(
        { orderBy: 'updatedAt' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      expect(call.variables?.orderBy).toBe('updatedAt');
    });

    it('supports ordering by createdAt', async () => {
      const result = await listIssuesTool.handler(
        { orderBy: 'createdAt' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      expect(call.variables?.orderBy).toBe('createdAt');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Workflow Chaining Guidance
// ─────────────────────────────────────────────────────────────────────────────

describe('Workflow Chaining Guidance', () => {
  describe('workspace_metadata as entry point', () => {
    it('provides team IDs for subsequent list_issues calls', async () => {
      const result = await workspaceMetadataTool.handler(
        { include: ['teams'] },
        baseContext,
      );

      const structured = result.structuredContent as Record<string, unknown>;
      const teams = structured.teams as Array<Record<string, unknown>>;

      // Each team should have an ID
      for (const team of teams) {
        expect(team.id).toBeDefined();
        expect(typeof team.id).toBe('string');
      }
    });

    it('provides workflow state IDs for state filtering', async () => {
      const result = await workspaceMetadataTool.handler(
        { include: ['teams', 'workflow_states'] },
        baseContext,
      );

      const structured = result.structuredContent as Record<string, unknown>;
      const statesByTeam = structured.workflowStatesByTeam as Record<string, unknown[]>;

      // States should have id, name, and type
      for (const states of Object.values(statesByTeam)) {
        for (const state of states as Array<Record<string, unknown>>) {
          expect(state.id).toBeDefined();
          expect(state.name).toBeDefined();
          expect(state.type).toBeDefined();
        }
      }
    });

    it('viewer ID enables self-assignment in create/update', async () => {
      const result = await workspaceMetadataTool.handler(
        { include: ['profile'] },
        baseContext,
      );

      const structured = result.structuredContent as Record<string, unknown>;
      const viewer = structured.viewer as Record<string, unknown>;

      expect(viewer.id).toBeDefined();
      expect(typeof viewer.id).toBe('string');
    });
  });

  describe('list_issues provides actionable IDs', () => {
    it('returns issue IDs for update_issues', async () => {
      const result = await listIssuesTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      for (const item of items) {
        expect(item.id).toBeDefined();
        expect(typeof item.id).toBe('string');
      }
    });

    it('returns stateId for understanding current state', async () => {
      const result = await listIssuesTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      for (const item of items) {
        expect(item.stateId).toBeDefined();
      }
    });

    it('returns human-readable stateName for context', async () => {
      const result = await listIssuesTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      // stateName should be present when state is available
      const hasStateName = items.some((item) => item.stateName !== undefined);
      expect(hasStateName).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Zero Results Handling
// ─────────────────────────────────────────────────────────────────────────────

describe('Zero Results Handling', () => {
  it('returns empty items array gracefully', async () => {
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items).toEqual([]);
  });

  it('shows count as 0 in text output', async () => {
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler({}, baseContext);

    const textContent = result.content[0].text;
    expect(textContent).toMatch(/Issues:\s*0/i);
  });

  it('shows helpful hints when state filter returns no results', async () => {
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler(
      { filter: { state: { type: { eq: 'completed' } } } },
      baseContext,
    );

    const textContent = result.content[0].text;
    // Should have context-aware hint about state filter
    expect(textContent).toMatch(/state filter|filter/i);
  });

  it('shows helpful hints when assignee filter returns no results', async () => {
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler(
      { assignedToMe: true },
      baseContext,
    );

    const textContent = result.content[0].text;
    // Should suggest verifying user or removing filter
    expect(textContent.toLowerCase()).toMatch(/assignee|filter|list_users/);
  });

  it('shows helpful hints when keyword filter returns no results', async () => {
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler(
      { q: 'nonexistent query' },
      baseContext,
    );

    const textContent = result.content[0].text;
    // Should suggest trying different keywords
    expect(textContent.toLowerCase()).toMatch(/keyword|filter/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Tool Description Guidance
// ─────────────────────────────────────────────────────────────────────────────

describe('Tool Description Provides State Filtering Guidance', () => {
  it('list_issues description mentions state filtering', () => {
    const desc = listIssuesTool.description;

    // Should mention state filtering
    expect(desc).toContain('state');
    expect(desc).toContain('started');
    expect(desc).toContain('completed');
  });

  it('list_issues description shows active issues filter example', () => {
    const desc = listIssuesTool.description;

    // Should mention how to get active/open issues
    expect(desc).toContain('neq');
    expect(desc).toContain('completed');
  });

  it('list_issues description shows in-progress filter example', () => {
    const desc = listIssuesTool.description;

    // Should mention how to get in-progress issues
    expect(desc).toContain('started');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Reasonable Limits
// ─────────────────────────────────────────────────────────────────────────────

describe('Reasonable Limits', () => {
  it('maximum limit is 100 per request', () => {
    // Check schema accepts 100
    const result = listIssuesTool.inputSchema.safeParse({ limit: 100 });
    expect(result.success).toBe(true);

    // Check schema rejects > 100
    const tooHigh = listIssuesTool.inputSchema.safeParse({ limit: 101 });
    expect(tooHigh.success).toBe(false);
  });

  it('minimum limit is 1', () => {
    const result = listIssuesTool.inputSchema.safeParse({ limit: 1 });
    expect(result.success).toBe(true);

    const zero = listIssuesTool.inputSchema.safeParse({ limit: 0 });
    expect(zero.success).toBe(false);
  });

  it('get_issues batch limited to 50 items', async () => {
    // Import get_issues schema to verify batch limit
    const { getIssuesTool } = await import('../../src/shared/tools/linear/get-issues.js');

    // Should accept exactly 50 items
    const valid = getIssuesTool.inputSchema.safeParse({
      ids: Array.from({ length: 50 }, (_, i) => `id-${i}`),
    });
    expect(valid.success).toBe(true);

    // Should reject 51 items
    const tooMany = getIssuesTool.inputSchema.safeParse({
      ids: Array.from({ length: 51 }, (_, i) => `id-${i}`),
    });
    expect(tooMany.success).toBe(false);
  });
});

