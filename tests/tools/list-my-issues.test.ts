/**
 * Tests for list_my_issues tool.
 * Verifies: filtering current user's issues, state filters, output shape.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listMyIssuesTool } from '../../src/shared/tools/linear/list-my-issues.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  createMockLinearClient,
  type MockLinearClient,
  resetMockCalls,
} from '../mocks/linear-client.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

let mockClient: MockLinearClient;

const baseContext: ToolContext = {
  sessionId: 'test-session',
  linearProviderAccessToken: 'test-token',
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
// Tool Metadata Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_my_issues tool metadata', () => {
  it('has correct name and title', () => {
    expect(listMyIssuesTool.name).toBe('list_my_issues');
    expect(listMyIssuesTool.title).toBe('List My Issues');
  });

  it('has readOnlyHint annotation', () => {
    expect(listMyIssuesTool.annotations?.readOnlyHint).toBe(true);
    expect(listMyIssuesTool.annotations?.destructiveHint).toBe(false);
  });

  it('has description mentioning current user filter', () => {
    expect(listMyIssuesTool.description).toContain('assigned to you');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_my_issues handler', () => {
  it('returns issues assigned to current viewer', async () => {
    const result = await listMyIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
    expect(Array.isArray(structured.items)).toBe(true);
  });

  it('uses viewer.assignedIssues query (implicit assignee filter)', async () => {
    const result = await listMyIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();

    // Verify the query uses assignedIssues (not issues with assignee filter)
    const call = mockClient._calls.rawRequest[0];
    expect(call.query).toContain('assignedIssues');
  });

  it('passes custom filters to assignedIssues query', async () => {
    const result = await listMyIssuesTool.handler(
      { filter: { state: { type: { eq: 'started' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;

    // assignedIssues already filters by viewer, so only state filter is added
    expect(filter.state).toEqual({ type: { eq: 'started' } });
  });

  it('supports filtering active issues only', async () => {
    const result = await listMyIssuesTool.handler(
      { filter: { state: { type: { neq: 'completed' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { neq: 'completed' } });
  });

  it('supports keyword search', async () => {
    const result = await listMyIssuesTool.handler({ q: 'authentication' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.and).toBeDefined();
  });

  it('respects limit parameter', async () => {
    const result = await listMyIssuesTool.handler({ limit: 5 }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.first).toBe(5);
  });

  it('supports pagination with cursor', async () => {
    const result = await listMyIssuesTool.handler(
      { cursor: 'test-cursor' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.after).toBe('test-cursor');
  });

  it('supports ordering by updatedAt', async () => {
    const result = await listMyIssuesTool.handler(
      { orderBy: 'updatedAt' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.orderBy).toBe('updatedAt');
  });

  it('rejects unsupported priority ordering', () => {
    const result = listMyIssuesTool.inputSchema.safeParse({ orderBy: 'priority' });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_my_issues output shape', () => {
  it('matches ListIssuesOutputSchema', async () => {
    const result = await listMyIssuesTool.handler({}, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.items).toBeDefined();
    expect(structured.limit).toBeDefined();

    const items = structured.items as Array<Record<string, unknown>>;
    for (const item of items) {
      expect(item.id).toBeDefined();
      expect(item.title).toBeDefined();
      expect(item.stateId).toBeDefined();
    }
  });

  it('includes pagination info', async () => {
    const result = await listMyIssuesTool.handler({}, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    expect('nextCursor' in structured || 'cursor' in structured).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Common Workflow Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_my_issues common workflows', () => {
  it('shows my active tasks (most common query)', async () => {
    const result = await listMyIssuesTool.handler(
      { filter: { state: { type: { neq: 'completed' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Uses assignedIssues query
    const call = mockClient._calls.rawRequest[0];
    expect(call.query).toContain('assignedIssues');
  });

  it('shows my in-progress tasks', async () => {
    const result = await listMyIssuesTool.handler(
      { filter: { state: { type: { eq: 'started' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify filter was passed to query
    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { eq: 'started' } });
  });

  it('shows my completed tasks', async () => {
    const result = await listMyIssuesTool.handler(
      { filter: { state: { type: { eq: 'completed' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify filter was passed to query
    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { eq: 'completed' } });
  });
});
