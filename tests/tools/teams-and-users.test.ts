/**
 * Tests for teams and users tools.
 * Verifies: listing teams, listing users, pagination, output shapes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listTeamsTool } from '../../src/shared/tools/linear/list-teams.js';
import { listUsersTool } from '../../src/shared/tools/linear/list-users.js';
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
// List Teams Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_teams tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(listTeamsTool.name).toBe('list_teams');
      expect(listTeamsTool.title).toBe('List Teams');
    });

    it('has readOnlyHint annotation', () => {
      expect(listTeamsTool.annotations?.readOnlyHint).toBe(true);
      expect(listTeamsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('handler behavior', () => {
    it('returns all teams', async () => {
      const result = await listTeamsTool.handler({}, baseContext);

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.items).toBeDefined();
      expect(Array.isArray(structured.items)).toBe(true);
    });

    it('respects limit parameter', async () => {
      const result = await listTeamsTool.handler({ limit: 5 }, baseContext);

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.limit).toBe(5);
    });

    it('supports pagination with cursor', async () => {
      const result = await listTeamsTool.handler({ cursor: 'test-cursor' }, baseContext);

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.cursor).toBe('test-cursor');
    });
  });

  describe('output shape', () => {
    it('matches ListTeamsOutputSchema', async () => {
      const result = await listTeamsTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      for (const item of items) {
        expect(item.id).toBeDefined();
        expect(item.name).toBeDefined();
        expect(typeof item.id).toBe('string');
        expect(typeof item.name).toBe('string');
      }
    });

    it('includes team key for issue identification', async () => {
      const result = await listTeamsTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      // At least one team should have a key (like ENG, DES)
      const hasKey = items.some((team) => team.key !== undefined);
      expect(hasKey).toBe(true);
    });

    it('includes pagination info', async () => {
      const result = await listTeamsTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      expect('nextCursor' in structured || 'cursor' in structured).toBe(true);
    });
  });

  describe('common workflows', () => {
    it('discovers available teams for filtering', async () => {
      const result = await listTeamsTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      expect(items.length).toBeGreaterThan(0);
      
      // Teams should have identifiers LLM can use in list_issues
      for (const team of items) {
        expect(team.id).toBeDefined();
      }
    });

    it('provides team names for human-readable context', async () => {
      const result = await listTeamsTool.handler({}, baseContext);

      const textContent = result.content[0].text;
      expect(textContent).toContain('Teams');

      // Should include actual team names from mock data
      expect(textContent).toContain('Engineering');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// List Users Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_users tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(listUsersTool.name).toBe('list_users');
      expect(listUsersTool.title).toBe('List Users');
    });

    it('has readOnlyHint annotation', () => {
      expect(listUsersTool.annotations?.readOnlyHint).toBe(true);
      expect(listUsersTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('handler behavior', () => {
    it('returns all users', async () => {
      const result = await listUsersTool.handler({}, baseContext);

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.items).toBeDefined();
      expect(Array.isArray(structured.items)).toBe(true);
    });

    it('respects limit parameter', async () => {
      const result = await listUsersTool.handler({ limit: 2 }, baseContext);

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.limit).toBe(2);
    });

    it('supports pagination with cursor', async () => {
      const result = await listUsersTool.handler({ cursor: 'test-cursor' }, baseContext);

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.cursor).toBe('test-cursor');
    });
  });

  describe('output shape', () => {
    it('matches ListUsersOutputSchema', async () => {
      const result = await listUsersTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      for (const item of items) {
        expect(item.id).toBeDefined();
        expect(typeof item.id).toBe('string');
        // Name, email, displayName are optional
      }
    });

    it('includes user identification fields', async () => {
      const result = await listUsersTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      expect(items.length).toBeGreaterThan(0);

      // Users should have at least name or email
      const hasIdentifier = items.some(
        (user) => user.name !== undefined || user.email !== undefined,
      );
      expect(hasIdentifier).toBe(true);
    });

    it('includes pagination info', async () => {
      const result = await listUsersTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      expect('nextCursor' in structured || 'cursor' in structured).toBe(true);
    });
  });

  describe('common workflows', () => {
    it('discovers users for assignment', async () => {
      const result = await listUsersTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      expect(items.length).toBeGreaterThan(0);

      // Users should have IDs for assigneeId in create/update_issues
      for (const user of items) {
        expect(user.id).toBeDefined();
      }
    });

    it('provides user names for readable assignments', async () => {
      const result = await listUsersTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      // Verify we get actual user data for LLM to reference
      expect(items.length).toBeGreaterThan(0);
      const firstUser = items[0];
      expect(firstUser.id).toBeDefined();
      expect(firstUser.name).toBeDefined();
    });

    it('returns users with IDs and names for assignment matching', async () => {
      const result = await listUsersTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      // All users should have ID (required for assigneeId)
      for (const user of items) {
        expect(user.id).toBeDefined();
        expect(typeof user.id).toBe('string');
      }

      // At least one should have name for matching user requests
      const hasName = items.some((u) => u.name !== undefined);
      expect(hasName).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Tool Workflow Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('teams and users workflow integration', () => {
  it('list teams returns IDs usable for list_issues teamId filter', async () => {
    const teamsResult = await listTeamsTool.handler({}, baseContext);
    const teamsStructured = teamsResult.structuredContent as Record<string, unknown>;
    const teams = teamsStructured.items as Array<Record<string, unknown>>;

    expect(teams.length).toBeGreaterThan(0);

    // Every team has ID suitable for filtering
    for (const team of teams) {
      expect(team.id).toBeDefined();
      expect(typeof team.id).toBe('string');
      expect((team.id as string).length).toBeGreaterThan(0);
    }

    // Teams have keys for issue identifiers (ENG-123)
    const hasKey = teams.some((t) => t.key !== undefined);
    expect(hasKey).toBe(true);
  });

  it('list users returns IDs usable for assigneeId in create/update_issues', async () => {
    const usersResult = await listUsersTool.handler({}, baseContext);
    const usersStructured = usersResult.structuredContent as Record<string, unknown>;
    const users = usersStructured.items as Array<Record<string, unknown>>;

    expect(users.length).toBeGreaterThan(0);

    // Every user has ID suitable for assignment
    for (const user of users) {
      expect(user.id).toBeDefined();
      expect(typeof user.id).toBe('string');
      expect((user.id as string).length).toBeGreaterThan(0);
    }
  });
});

