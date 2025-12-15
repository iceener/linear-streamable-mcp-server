/**
 * Tests for list_issues tool.
 * Verifies: input validation, filtering, pagination, output shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import { createMockLinearClient, resetMockCalls, type MockLinearClient } from '../mocks/linear-client.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import listIssuesFixtures from '../fixtures/tool-inputs/list-issues.json';

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

let mockClient: MockLinearClient;

const baseContext: ToolContext = {
  sessionId: 'test-session',
  providerToken: 'test-token',
  authStrategy: 'bearer',
};

// Mock the getLinearClient function
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

describe('list_issues tool metadata', () => {
  it('has correct name and title', () => {
    expect(listIssuesTool.name).toBe('list_issues');
    expect(listIssuesTool.title).toBe('List Issues');
  });

  it('has readOnlyHint annotation', () => {
    expect(listIssuesTool.annotations?.readOnlyHint).toBe(true);
    expect(listIssuesTool.annotations?.destructiveHint).toBe(false);
  });

  it('has description with state filtering guidance', () => {
    expect(listIssuesTool.description).toContain('List issues');
    expect(listIssuesTool.description).toContain('state');
    expect(listIssuesTool.description).toContain('filter');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues input validation', () => {
  describe('valid inputs', () => {
    for (const fixture of listIssuesFixtures.valid) {
      it(`accepts: ${fixture.name}`, () => {
        const result = listIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('invalid inputs', () => {
    for (const fixture of listIssuesFixtures.invalid) {
      it(`rejects: ${fixture.name}`, () => {
        const result = listIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(false);
        if (!result.success) {
          const errorMessage = result.error.errors.map((e) => e.message).join(', ');
          expect(errorMessage).toContain(fixture.expectedError);
        }
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues handler', () => {
  it('returns issues with default parameters', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
    expect(Array.isArray(structured.items)).toBe(true);

    const items = structured.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
  });

  it('respects limit parameter', async () => {
    const result = await listIssuesTool.handler({ limit: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    // Verify rawRequest was called with correct limit
    expect(mockClient._calls.rawRequest.length).toBe(1);
    expect(mockClient._calls.rawRequest[0].variables?.first).toBe(2);
  });

  it('passes teamId as filter', async () => {
    const result = await listIssuesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();

    // Verify filter was passed with team constraint
    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.filter).toBeDefined();
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.team).toEqual({ id: { eq: 'team-eng' } });
  });

  it('passes projectId as filter', async () => {
    const result = await listIssuesTool.handler({ projectId: 'project-001' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.project).toEqual({ id: { eq: 'project-001' } });
  });

  it('converts q parameter to keyword OR filter', async () => {
    const result = await listIssuesTool.handler({ q: 'auth bug' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;

    // Should have OR filter with both keywords
    expect(filter.or).toBeDefined();
    const orFilters = filter.or as Array<Record<string, unknown>>;
    expect(orFilters.length).toBe(2);
    expect(orFilters).toContainEqual({ title: { containsIgnoreCase: 'auth' } });
    expect(orFilters).toContainEqual({ title: { containsIgnoreCase: 'bug' } });
  });

  it('uses explicit keywords array', async () => {
    const result = await listIssuesTool.handler({ keywords: ['fix', 'auth'] }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    const orFilters = filter.or as Array<Record<string, unknown>>;

    expect(orFilters).toContainEqual({ title: { containsIgnoreCase: 'fix' } });
    expect(orFilters).toContainEqual({ title: { containsIgnoreCase: 'auth' } });
  });

  it('passes state filter to GraphQL', async () => {
    const result = await listIssuesTool.handler(
      { filter: { state: { type: { eq: 'started' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { eq: 'started' } });
  });

  it('passes cursor for pagination', async () => {
    const result = await listIssuesTool.handler({ cursor: 'abc-cursor' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.after).toBe('abc-cursor');
  });

  it('passes orderBy parameter', async () => {
    const result = await listIssuesTool.handler({ orderBy: 'createdAt' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.orderBy).toBe('createdAt');
  });

  it('passes includeArchived parameter', async () => {
    const result = await listIssuesTool.handler({ includeArchived: true }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.includeArchived).toBe(true);
  });

  it('combines multiple filters', async () => {
    const result = await listIssuesTool.handler(
      {
        teamId: 'team-eng',
        filter: { state: { type: { eq: 'started' } } },
        q: 'auth',
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;

    // Should have all three filters
    expect(filter.team).toEqual({ id: { eq: 'team-eng' } });
    expect(filter.state).toEqual({ type: { eq: 'started' } });
    expect(filter.or).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues output shape', () => {
  it('returns items array with issue objects', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    for (const item of items) {
      // Required fields
      expect(typeof item.id).toBe('string');
      expect(typeof item.title).toBe('string');
      expect(typeof item.stateId).toBe('string');
      expect(typeof item.createdAt).toBe('string');
      expect(typeof item.updatedAt).toBe('string');

      // Labels array
      expect(Array.isArray(item.labels)).toBe(true);
    }
  });

  it('includes pagination info', async () => {
    const result = await listIssuesTool.handler({ limit: 2 }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.limit).toBe(2);
    // nextCursor may or may not be present depending on hasNextPage
    expect('cursor' in structured || 'nextCursor' in structured).toBe(true);
  });

  it('returns text content with issue preview', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    const textContent = result.content[0];
    expect(textContent.type).toBe('text');
    expect(textContent.text).toContain('Issues');

    // Text should include actual issue data from mock
    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    // If we have issues, text should reflect the count
    if (items.length > 0) {
      expect(textContent.text).toMatch(/Issues:\s*\d+/);
      // Should contain issue identifier or title
      const firstIssue = items[0];
      expect(
        textContent.text.includes(firstIssue.identifier as string) ||
          textContent.text.includes(firstIssue.title as string),
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues edge cases', () => {
  it('handles empty results gracefully', async () => {
    // Create client with no issues
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items.length).toBe(0);
  });

  it('handles complex nested filter', async () => {
    const complexFilter = {
      and: [
        { state: { type: { neq: 'completed' } } },
        { assignee: { id: { eq: 'user-001' } } },
        { priority: { lte: 2 } },
      ],
    };

    const result = await listIssuesTool.handler({ filter: complexFilter }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.and).toBeDefined();
  });
});

