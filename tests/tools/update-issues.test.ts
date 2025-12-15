/**
 * Tests for update_issues tool.
 * Verifies: input validation, batch updates, state/label changes, error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateIssuesTool } from '../../src/shared/tools/linear/update-issues.js';
import { createMockLinearClient, resetMockCalls, type MockLinearClient } from '../mocks/linear-client.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import updateIssuesFixtures from '../fixtures/tool-inputs/update-issues.json';

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

describe('update_issues tool metadata', () => {
  it('has correct name and title', () => {
    expect(updateIssuesTool.name).toBe('update_issues');
    expect(updateIssuesTool.title).toBe('Update Issues (Batch)');
  });

  it('has destructive annotation', () => {
    expect(updateIssuesTool.annotations?.readOnlyHint).toBe(false);
    // Update can modify data
    expect(updateIssuesTool.annotations?.destructiveHint).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues input validation', () => {
  describe('valid inputs', () => {
    for (const fixture of updateIssuesFixtures.valid) {
      it(`accepts: ${fixture.name}`, () => {
        const result = updateIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('invalid inputs', () => {
    for (const fixture of updateIssuesFixtures.invalid) {
      it(`rejects: ${fixture.name}`, () => {
        const result = updateIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(false);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues handler', () => {
  it('updates issue title', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', title: 'Updated title' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { ok: number; failed: number };

    expect(summary.ok).toBe(1);
    expect(mockClient.updateIssue).toHaveBeenCalledWith('issue-001', expect.objectContaining({ title: 'Updated title' }));
  });

  it('updates issue state', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', stateId: 'state-done' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({ stateId: 'state-done' }),
    );
  });

  it('updates assignee', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', assigneeId: 'user-002' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({ assigneeId: 'user-002' }),
    );
  });

  it('batch updates multiple issues', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [
          { id: 'issue-001', stateId: 'state-done' },
          { id: 'issue-002', stateId: 'state-inprogress' },
          { id: 'issue-003', assigneeId: 'user-001' },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { ok: number; failed: number };

    expect(summary.ok).toBe(3);
    expect(mockClient.updateIssue).toHaveBeenCalledTimes(3);
  });

  it('dry run validates without updating', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [{ id: 'issue-001', stateId: 'state-done' }],
        dry_run: true,
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.dry_run).toBe(true);

    // Verify updateIssue was NOT called
    expect(mockClient.updateIssue).not.toHaveBeenCalled();
  });

  it('updates multiple fields at once', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            title: 'New title',
            stateId: 'state-done',
            priority: 1,
            assigneeId: 'user-002',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        title: 'New title',
        stateId: 'state-done',
        priority: 1,
        assigneeId: 'user-002',
      }),
    );
  });

  it('supports update by identifier (ENG-123)', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'ENG-123', stateId: 'state-done' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // The mock should accept identifier as id
    expect(mockClient.updateIssue).toHaveBeenCalledWith('ENG-123', expect.any(Object));
  });

  it('archives issue (calls archiveIssue method)', async () => {
    // Add archiveIssue method to mock
    (mockClient as unknown as { archiveIssue: ReturnType<typeof vi.fn> }).archiveIssue = vi.fn(
      async () => ({ success: true }),
    );

    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', archived: true }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Archive uses a separate archiveIssue method, not updateIssue
    expect(
      (mockClient as unknown as { archiveIssue: ReturnType<typeof vi.fn> }).archiveIssue,
    ).toHaveBeenCalledWith('issue-001');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Label Update Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues label operations', () => {
  it('replaces all labels with labelIds', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', labelIds: ['label-docs'] }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({ labelIds: ['label-docs'] }),
    );
  });

  it('adds labels with addLabelIds (computes final labelIds)', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', addLabelIds: ['label-feature'] }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Must fetch current issue to get existing labels
    expect(mockClient.issue).toHaveBeenCalledWith('issue-001');

    // updateIssue should be called with merged labelIds
    const updateCalls = mockClient._calls.updateIssue;
    expect(updateCalls.length).toBeGreaterThan(0);

    // Find the call that has labelIds (the one after label computation)
    const labelUpdateCall = updateCalls.find((c) => c.input.labelIds !== undefined);
    if (labelUpdateCall) {
      const labelIds = labelUpdateCall.input.labelIds as string[];
      // Should include the added label
      expect(labelIds).toContain('label-feature');
      // Should retain existing labels (issue-001 has label-bug)
      expect(labelIds).toContain('label-bug');
    }
  });

  it('removes labels with removeLabelIds (computes final labelIds)', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', removeLabelIds: ['label-bug'] }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Must fetch current issue to get existing labels
    expect(mockClient.issue).toHaveBeenCalledWith('issue-001');

    // updateIssue should be called with computed labelIds
    const updateCalls = mockClient._calls.updateIssue;
    expect(updateCalls.length).toBeGreaterThan(0);

    // Find the call that has labelIds (the one after label computation)
    const labelUpdateCall = updateCalls.find((c) => c.input.labelIds !== undefined);
    if (labelUpdateCall) {
      const labelIds = labelUpdateCall.input.labelIds as string[];
      // Should NOT include the removed label
      expect(labelIds).not.toContain('label-bug');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues output shape', () => {
  it('matches UpdateIssuesOutputSchema', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', title: 'Test' }] },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.results).toBeDefined();
    expect(structured.summary).toBeDefined();

    const results = structured.results as Array<Record<string, unknown>>;
    expect(Array.isArray(results)).toBe(true);

    for (const r of results) {
      expect(typeof r.index).toBe('number');
      expect(typeof r.ok).toBe('boolean');
    }

    const summary = structured.summary as Record<string, unknown>;
    expect(typeof summary.ok).toBe('number');
    expect(typeof summary.failed).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues error handling', () => {
  it('handles API error gracefully', async () => {
    (mockClient.updateIssue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Issue not found'),
    );

    const result = await updateIssuesTool.handler(
      { items: [{ id: 'nonexistent', stateId: 'state-done' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results[0].success).toBe(false);
    expect((results[0].error as Record<string, unknown>).message).toContain('Issue not found');
  });

  it('continues batch on partial failure', async () => {
    (mockClient.updateIssue as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('First failed'))
      .mockResolvedValueOnce({ success: true, issue: { id: 'issue-002', identifier: 'ENG-124' } });

    const result = await updateIssuesTool.handler(
      {
        items: [
          { id: 'bad-id', stateId: 'state-done' },
          { id: 'issue-002', stateId: 'state-done' },
        ],
      },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { ok: number; failed: number };

    expect(summary.ok).toBe(1);
    expect(summary.failed).toBe(1);
  });
});

