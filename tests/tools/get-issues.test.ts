/**
 * Tests for get_issues tool.
 * Verifies: input validation, batch fetching, output shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getIssuesTool } from '../../src/shared/tools/linear/get-issues.js';
import { createMockLinearClient, resetMockCalls, type MockLinearClient } from '../mocks/linear-client.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import getIssuesFixtures from '../fixtures/tool-inputs/get-issues.json';

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

describe('get_issues tool metadata', () => {
  it('has correct name and title', () => {
    expect(getIssuesTool.name).toBe('get_issues');
    expect(getIssuesTool.title).toBe('Get Issues (Batch)');
  });

  it('has readOnlyHint annotation', () => {
    expect(getIssuesTool.annotations?.readOnlyHint).toBe(true);
    expect(getIssuesTool.annotations?.destructiveHint).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues input validation', () => {
  describe('valid inputs', () => {
    for (const fixture of getIssuesFixtures.valid) {
      it(`accepts: ${fixture.name}`, () => {
        const result = getIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('invalid inputs', () => {
    for (const fixture of getIssuesFixtures.invalid) {
      it(`rejects: ${fixture.name}`, () => {
        const result = getIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(false);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues handler', () => {
  it('fetches single issue by UUID', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.results).toBeDefined();

    const results = structured.results as Array<Record<string, unknown>>;
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
    expect(results[0].issue).toBeDefined();
    expect((results[0].issue as Record<string, unknown>).id).toBe('issue-001');

    // Verify issue() was called
    expect(mockClient.issue).toHaveBeenCalledWith('issue-001');
  });

  it('fetches single issue by identifier', async () => {
    const result = await getIssuesTool.handler({ ids: ['ENG-123'] }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results[0].success).toBe(true);
    expect((results[0].issue as Record<string, unknown>).identifier).toBe('ENG-123');

    // Verify issue() was called with identifier
    expect(mockClient.issue).toHaveBeenCalledWith('ENG-123');
  });

  it('fetches multiple issues in batch', async () => {
    const result = await getIssuesTool.handler(
      { ids: ['issue-001', 'issue-002', 'issue-003'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results.length).toBe(3);
    expect(mockClient.issue).toHaveBeenCalledTimes(3);
  });

  it('returns issue details in result', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;
    const issue = results[0].issue as Record<string, unknown>;

    expect(issue).toBeDefined();
    expect(issue.id).toBe('issue-001');
    expect(issue.title).toBe('Fix authentication bug');
  });

  it('includes summary with ok/failed counts', async () => {
    const result = await getIssuesTool.handler(
      { ids: ['issue-001', 'issue-002'] },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { succeeded: number; failed: number };

    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues output shape', () => {
  it('matches GetIssuesOutputSchema', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.results).toBeDefined();
    expect(structured.summary).toBeDefined();

    const results = structured.results as Array<Record<string, unknown>>;
    for (const r of results) {
      expect(typeof r.requestedId).toBe('string');
      expect(typeof r.success).toBe('boolean');
      if (r.success) {
        expect(r.issue).toBeDefined();
      }
    }
  });

  it('issue contains expected fields', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;
    const issue = results[0].issue as Record<string, unknown>;

    // Required identification fields
    expect(issue.id).toBeDefined();
    expect(issue.identifier).toBeDefined();
    expect(issue.title).toBeDefined();

    // State info (nested object in GetIssueOutputSchema)
    expect(issue.state).toBeDefined();
    const state = issue.state as Record<string, unknown>;
    expect(state.id).toBeDefined();
    expect(state.name).toBeDefined();

    // Labels array
    expect(issue.labels).toBeDefined();
    expect(Array.isArray(issue.labels)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues error handling', () => {
  it('handles not found gracefully', async () => {
    (mockClient.issue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await getIssuesTool.handler({ ids: ['nonexistent'] }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });

  it('continues batch on partial failure', async () => {
    (mockClient.issue as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null) // First fails (not found)
      .mockResolvedValueOnce({
        // Second succeeds - full mock with all required async properties
        id: 'issue-002',
        identifier: 'ENG-124',
        title: 'Test',
        description: null,
        branchName: null,
        state: Promise.resolve({ id: 'state-todo', name: 'Todo', type: 'unstarted' }),
        project: Promise.resolve(null),
        assignee: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [] }),
        attachments: () => Promise.resolve({ nodes: [] }),
      });

    const result = await getIssuesTool.handler(
      { ids: ['bad-id', 'issue-002'] },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { succeeded: number; failed: number };

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it('handles API error gracefully', async () => {
    (mockClient.issue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network error'),
    );

    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results[0].success).toBe(false);
    expect((results[0].error as Record<string, unknown>).message).toContain('Network error');
  });
});

