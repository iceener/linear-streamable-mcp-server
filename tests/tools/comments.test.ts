/**
 * Tests for comment tools (list, add).
 * Verifies: comment listing, adding comments, batch operations, output shapes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listCommentsTool,
  addCommentsTool,
} from '../../src/shared/tools/linear/comments.js';
import {
  createMockLinearClient,
  resetMockCalls,
  type MockLinearClient,
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
// List Comments Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_comments tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(listCommentsTool.name).toBe('list_comments');
      expect(listCommentsTool.title).toBe('List Comments');
    });

    it('has readOnlyHint annotation', () => {
      expect(listCommentsTool.annotations?.readOnlyHint).toBe(true);
      expect(listCommentsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires issueId parameter', () => {
      const result = listCommentsTool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts valid issueId', () => {
      const result = listCommentsTool.inputSchema.safeParse({ issueId: 'issue-001' });
      expect(result.success).toBe(true);
    });

    it('accepts optional limit', () => {
      const result = listCommentsTool.inputSchema.safeParse({
        issueId: 'issue-001',
        limit: 10,
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional cursor', () => {
      const result = listCommentsTool.inputSchema.safeParse({
        issueId: 'issue-001',
        cursor: 'test-cursor',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('returns comments for specified issue', async () => {
      const result = await listCommentsTool.handler({ issueId: 'issue-001' }, baseContext);

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.items).toBeDefined();
      expect(Array.isArray(structured.items)).toBe(true);
    });

    it('respects limit parameter', async () => {
      const result = await listCommentsTool.handler(
        { issueId: 'issue-001', limit: 5 },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.limit).toBe(5);
    });

    it('supports pagination with cursor', async () => {
      const result = await listCommentsTool.handler(
        { issueId: 'issue-001', cursor: 'test-cursor' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.cursor).toBe('test-cursor');
    });
  });

  describe('output shape', () => {
    it('matches ListCommentsOutputSchema', async () => {
      const result = await listCommentsTool.handler({ issueId: 'issue-001' }, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      for (const item of items) {
        expect(item.id).toBeDefined();
        expect(item.createdAt).toBeDefined();
        expect(typeof item.id).toBe('string');
      }
    });

    it('includes comment metadata (body, user, dates)', async () => {
      const result = await listCommentsTool.handler({ issueId: 'issue-001' }, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      expect(items.length).toBeGreaterThan(0);

      const firstComment = items[0];
      // Body content
      expect(firstComment.body).toBeDefined();
      expect(typeof firstComment.body).toBe('string');
      // User info
      expect(firstComment.user).toBeDefined();
      // Timestamps
      expect(firstComment.createdAt).toBeDefined();
      expect(typeof firstComment.createdAt).toBe('string');
    });

    it('includes pagination info', async () => {
      const result = await listCommentsTool.handler({ issueId: 'issue-001' }, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      expect('nextCursor' in structured || 'cursor' in structured).toBe(true);
    });
  });

  describe('common workflows', () => {
    it('reads discussion history on an issue', async () => {
      const result = await listCommentsTool.handler({ issueId: 'issue-001' }, baseContext);

      expect(result.isError).toBeFalsy();

      // Verify comments are actually returned
      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);

      // Verify text output mentions comment count
      const textContent = result.content[0].text;
      expect(textContent).toContain('Comments');
      expect(textContent).toMatch(/\d+/); // Contains count
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Add Comments Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('add_comments tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(addCommentsTool.name).toBe('add_comments');
      expect(addCommentsTool.title).toBe('Add Comments (Batch)');
    });

    it('has non-destructive annotations', () => {
      expect(addCommentsTool.annotations?.readOnlyHint).toBe(false);
      expect(addCommentsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires at least one item', () => {
      const result = addCommentsTool.inputSchema.safeParse({ items: [] });
      expect(result.success).toBe(false);
    });

    it('requires issueId for each comment', () => {
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ body: 'Test comment' }],
      });
      expect(result.success).toBe(false);
    });

    it('requires body for each comment', () => {
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ issueId: 'issue-001' }],
      });
      expect(result.success).toBe(false);
    });

    it('accepts empty body (Linear SDK allows it)', () => {
      // The schema doesn't enforce min(1) on body - Linear API handles this
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ issueId: 'issue-001', body: '' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid comment', () => {
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ issueId: 'issue-001', body: 'This is a test comment' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts multiple comments', () => {
      const result = addCommentsTool.inputSchema.safeParse({
        items: [
          { issueId: 'issue-001', body: 'Comment 1' },
          { issueId: 'issue-002', body: 'Comment 2' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('ignores unknown keys like dry_run (passthrough schema)', () => {
      // add_comments schema doesn't use strict() so extra keys are ignored
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ issueId: 'issue-001', body: 'Test' }],
        dry_run: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts parallel option', () => {
      const result = addCommentsTool.inputSchema.safeParse({
        items: [{ issueId: 'issue-001', body: 'Test' }],
        parallel: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('adds a single comment', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [{ issueId: 'issue-001', body: 'Great progress on this!' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      const summary = structured.summary as { ok: number; failed: number };

      expect(summary.ok).toBe(1);
      expect(mockClient.createComment).toHaveBeenCalledTimes(1);
    });

    it('passes comment body to API', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [{ issueId: 'issue-001', body: 'Status update: deployed to staging' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'issue-001',
          body: 'Status update: deployed to staging',
        }),
      );
    });

    it('batch adds multiple comments', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [
            { issueId: 'issue-001', body: 'Comment A' },
            { issueId: 'issue-002', body: 'Comment B' },
            { issueId: 'issue-001', body: 'Comment C' },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      const summary = structured.summary as { ok: number; failed: number };

      expect(summary.ok).toBe(3);
      expect(mockClient.createComment).toHaveBeenCalledTimes(3);
    });

    it('creates comment without dry_run option (not supported)', async () => {
      // add_comments doesn't support dry_run
      const result = await addCommentsTool.handler(
        {
          items: [{ issueId: 'issue-001', body: 'Real comment' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify createComment WAS called
      expect(mockClient.createComment).toHaveBeenCalled();
    });

    it('returns comment IDs', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [{ issueId: 'issue-001', body: 'Test' }],
        },
        baseContext,
      );

      const structured = result.structuredContent as Record<string, unknown>;
      const results = structured.results as Array<Record<string, unknown>>;

      expect(results[0].ok).toBe(true);
      expect(results[0].id).toBeDefined();
    });
  });

  describe('output shape', () => {
    it('matches AddCommentsOutputSchema', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [{ issueId: 'issue-001', body: 'Test' }],
        },
        baseContext,
      );

      const structured = result.structuredContent as Record<string, unknown>;

      expect(structured.results).toBeDefined();
      expect(structured.summary).toBeDefined();

      const results = structured.results as Array<Record<string, unknown>>;
      expect(Array.isArray(results)).toBe(true);

      const summary = structured.summary as Record<string, unknown>;
      expect(typeof summary.ok).toBe('number');
      expect(typeof summary.failed).toBe('number');
    });
  });

  describe('common workflows', () => {
    it('adds status update to issue', async () => {
      const statusUpdate = 'Deployed to production. Monitoring for issues.';
      const result = await addCommentsTool.handler(
        {
          items: [
            {
              issueId: 'issue-001',
              body: statusUpdate,
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify the exact body was sent
      expect(mockClient.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'issue-001',
          body: statusUpdate,
        }),
      );
    });

    it('mentions teammate in comment', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [
            {
              issueId: 'issue-001',
              body: '@jane Could you review the changes?',
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Body should preserve @ mentions
      expect(mockClient.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('@jane'),
        }),
      );
    });

    it('adds follow-up comments to multiple issues', async () => {
      const result = await addCommentsTool.handler(
        {
          items: [
            { issueId: 'issue-001', body: 'Fixed in PR #123' },
            { issueId: 'issue-002', body: 'Fixed in PR #123' },
            { issueId: 'issue-003', body: 'Fixed in PR #123' },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      const summary = structured.summary as { ok: number; failed: number };

      expect(summary.ok).toBe(3);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('comments workflow integration', () => {
  it('list comments, then add new comment', async () => {
    // Step 1: Check existing comments
    const listResult = await listCommentsTool.handler(
      { issueId: 'issue-001' },
      baseContext,
    );

    expect(listResult.isError).toBeFalsy();

    // Step 2: Add new comment
    const addResult = await addCommentsTool.handler(
      {
        items: [{ issueId: 'issue-001', body: 'Following up on discussion' }],
      },
      baseContext,
    );

    expect(addResult.isError).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// update_comments Tool Tests
// ─────────────────────────────────────────────────────────────────────────────

import { updateCommentsTool } from '../../src/shared/tools/linear/comments.js';

describe('update_comments tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(updateCommentsTool.name).toBe('update_comments');
      expect(updateCommentsTool.title).toBe('Update Comments (Batch)');
    });

    it('is not read-only or destructive', () => {
      expect(updateCommentsTool.annotations?.readOnlyHint).toBe(false);
      expect(updateCommentsTool.annotations?.destructiveHint).toBe(false);
    });

    it('description mentions no delete', () => {
      expect(updateCommentsTool.description).toContain('Cannot delete');
    });
  });

  describe('input validation', () => {
    it('requires at least one comment', () => {
      const result = updateCommentsTool.inputSchema.safeParse({ items: [] });
      expect(result.success).toBe(false);
    });

    it('requires id for each comment', () => {
      const result = updateCommentsTool.inputSchema.safeParse({
        items: [{ body: 'Updated body' }],
      });
      expect(result.success).toBe(false);
    });

    it('requires body for each comment', () => {
      const result = updateCommentsTool.inputSchema.safeParse({
        items: [{ id: 'comment-001' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty body', () => {
      const result = updateCommentsTool.inputSchema.safeParse({
        items: [{ id: 'comment-001', body: '' }],
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid update', () => {
      const result = updateCommentsTool.inputSchema.safeParse({
        items: [{ id: 'comment-001', body: 'Updated content' }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('updates single comment', async () => {
      const result = await updateCommentsTool.handler(
        {
          items: [{ id: 'comment-001', body: 'Updated comment body' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.updateComment).toHaveBeenCalledWith('comment-001', { body: 'Updated comment body' });

      const structured = result.structuredContent as Record<string, unknown>;
      const summary = structured.summary as { ok: number; failed: number };
      expect(summary.ok).toBe(1);
    });

    it('batch updates multiple comments', async () => {
      const result = await updateCommentsTool.handler(
        {
          items: [
            { id: 'comment-001', body: 'Updated 1' },
            { id: 'comment-002', body: 'Updated 2' },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.updateComment).toHaveBeenCalledTimes(2);

      const structured = result.structuredContent as Record<string, unknown>;
      const summary = structured.summary as { ok: number; failed: number };
      expect(summary.ok).toBe(2);
    });

    it('suggests verifying with list_comments', async () => {
      const result = await updateCommentsTool.handler(
        {
          items: [{ id: 'comment-001', body: 'Updated' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('list_comments');
    });
  });
});

