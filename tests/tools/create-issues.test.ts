/**
 * Tests for create_issues tool.
 * Verifies: input validation, batch creation, dry run, error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIssuesTool } from '../../src/shared/tools/linear/create-issues.js';
import { createMockLinearClient, resetMockCalls, type MockLinearClient } from '../mocks/linear-client.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import createIssuesFixtures from '../fixtures/tool-inputs/create-issues.json';

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

describe('create_issues tool metadata', () => {
  it('has correct name and title', () => {
    expect(createIssuesTool.name).toBe('create_issues');
    expect(createIssuesTool.title).toBe('Create Issues (Batch)');
  });

  it('has non-destructive annotations', () => {
    expect(createIssuesTool.annotations?.readOnlyHint).toBe(false);
    expect(createIssuesTool.annotations?.destructiveHint).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_issues input validation', () => {
  describe('valid inputs', () => {
    for (const fixture of createIssuesFixtures.valid) {
      it(`accepts: ${fixture.name}`, () => {
        const result = createIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('invalid inputs', () => {
    for (const fixture of createIssuesFixtures.invalid) {
      it(`rejects: ${fixture.name}`, () => {
        const result = createIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(false);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_issues handler', () => {
  it('creates a single issue with minimal input', async () => {
    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'Test issue' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.results).toBeDefined();
    expect(structured.summary).toBeDefined();

    const summary = structured.summary as { ok: number; failed: number };
    expect(summary.ok).toBe(1);
    expect(summary.failed).toBe(0);

    // Verify createIssue was called
    expect(mockClient.createIssue).toHaveBeenCalledTimes(1);
  });

  it('creates issue with all optional fields', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Full issue',
            description: 'Detailed description',
            stateId: 'state-todo',
            labelIds: ['label-feature'],
            assigneeId: 'user-002',
            projectId: 'project-001',
            priority: 2,
            estimate: 5,
            dueDate: '2025-01-15',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify the call included all fields
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-eng',
        title: 'Full issue',
        description: 'Detailed description',
        stateId: 'state-todo',
        labelIds: ['label-feature'],
        assigneeId: 'user-002',
        projectId: 'project-001',
        priority: 2,
        estimate: 5,
        dueDate: '2025-01-15',
      }),
    );
  });

  it('batch creates multiple issues', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          { teamId: 'team-eng', title: 'Issue 1' },
          { teamId: 'team-eng', title: 'Issue 2' },
          { teamId: 'team-eng', title: 'Issue 3' },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { ok: number; failed: number };

    expect(summary.ok).toBe(3);
    expect(mockClient.createIssue).toHaveBeenCalledTimes(3);
  });

  it('resolves assigneeName to assigneeId', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Issue with name-based assignee',
            assigneeName: 'Jane', // Should match Jane Doe (user-002)
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify the call resolved Jane to user-002
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-eng',
        title: 'Issue with name-based assignee',
        assigneeId: 'user-002',
      }),
    );
  });

  it('resolves assigneeEmail to assigneeId', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Issue with email-based assignee',
            assigneeEmail: 'bob@example.com', // Should match Bob Smith (user-003)
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify the call resolved email to user-003
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-eng',
        title: 'Issue with email-based assignee',
        assigneeId: 'user-003',
      }),
    );
  });

  it('returns error for non-matching assigneeName', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Issue with unknown assignee',
            assigneeName: 'NonExistentPerson',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy(); // Batch continues

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;
    const summary = structured.summary as { ok: number; failed: number };

    expect(summary.failed).toBe(1);
    expect(results[0].success).toBe(false);
    expect((results[0].error as Record<string, unknown>).message).toContain('No user found');
    expect((results[0].error as Record<string, unknown>).code).toBe('USER_NOT_FOUND');
  });

  it('dry run validates without creating', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [{ teamId: 'team-eng', title: 'Dry run test' }],
        dry_run: true,
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.dry_run).toBe(true);

    const summary = structured.summary as { ok: number; failed: number };
    expect(summary.ok).toBe(1);

    // Verify createIssue was NOT called
    expect(mockClient.createIssue).not.toHaveBeenCalled();

    // Verify text mentions dry run
    expect(result.content[0].text).toContain('Dry run');
  });

  it('defaults assigneeId to viewer when not provided', async () => {
    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'Auto-assign test' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Should have called createIssue with viewer's ID as assigneeId
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: 'user-001', // Default viewer ID from mock
      }),
    );
  });

  it('respects explicit assigneeId', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [{ teamId: 'team-eng', title: 'Assigned test', assigneeId: 'user-002' }],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: 'user-002',
      }),
    );
  });

  it('returns results with id and identifier', async () => {
    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'Test' }] },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results.length).toBe(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].id).toBeDefined();
    expect(results[0].identifier).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_issues output shape', () => {
  it('matches CreateIssuesOutputSchema', async () => {
    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'Schema test' }] },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;

    // Required fields
    expect(structured.results).toBeDefined();
    expect(structured.summary).toBeDefined();

    // Results array
    const results = structured.results as Array<Record<string, unknown>>;
    expect(Array.isArray(results)).toBe(true);

    for (const r of results) {
      expect(typeof r.index).toBe('number');
      expect(typeof r.ok).toBe('boolean');
    }

    // Summary
    const summary = structured.summary as Record<string, unknown>;
    expect(typeof summary.ok).toBe('number');
    expect(typeof summary.failed).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_issues error handling', () => {
  it('handles API error gracefully after retries', async () => {
    // Make createIssue throw consistently (3 retries + 1 = 4 calls)
    const error = new Error('API rate limit exceeded');
    (mockClient.createIssue as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error);

    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'Error test' }] },
      baseContext,
    );

    // Should not throw, but report error in results
    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results[0].success).toBe(false);
    expect((results[0].error as Record<string, unknown>).message).toContain('API rate limit');
    expect((results[0].error as Record<string, unknown>).code).toBe('LINEAR_CREATE_ERROR');
  });

  it('continues batch on partial failure', async () => {
    // First call fails, second succeeds
    (mockClient.createIssue as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('First failed'))
      .mockResolvedValueOnce({ success: true, issue: { id: 'new-id', identifier: 'ENG-100' } });

    const result = await createIssuesTool.handler(
      {
        items: [
          { teamId: 'team-eng', title: 'Will fail' },
          { teamId: 'team-eng', title: 'Will succeed' },
        ],
      },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { ok: number; failed: number };

    expect(summary.ok).toBe(1);
    expect(summary.failed).toBe(1);

    const results = structured.results as Array<Record<string, unknown>>;
    expect(results[0].ok).toBe(false);
    expect(results[1].ok).toBe(true);
  });
});

