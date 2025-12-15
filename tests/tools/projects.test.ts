/**
 * Tests for project tools (list, create, update).
 * Verifies: project listing, creation, updates, filtering, output shapes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listProjectsTool,
  createProjectsTool,
  updateProjectsTool,
} from '../../src/shared/tools/linear/projects.js';
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
// List Projects Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_projects tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(listProjectsTool.name).toBe('list_projects');
      expect(listProjectsTool.title).toBe('List Projects');
    });

    it('has readOnlyHint annotation', () => {
      expect(listProjectsTool.annotations?.readOnlyHint).toBe(true);
      expect(listProjectsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('handler behavior', () => {
    it('returns all projects by default', async () => {
      const result = await listProjectsTool.handler({}, baseContext);

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.items).toBeDefined();
      expect(Array.isArray(structured.items)).toBe(true);
    });

    it('supports filtering by project state', async () => {
      const result = await listProjectsTool.handler(
        { filter: { state: { eq: 'started' } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify filter was passed to API
      expect(mockClient.projects).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { state: { eq: 'started' } },
        }),
      );
    });

    it('supports filtering by single project ID', async () => {
      const result = await listProjectsTool.handler(
        { filter: { id: { eq: 'project-001' } }, limit: 1 },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify filter and limit were passed
      expect(mockClient.projects).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { id: { eq: 'project-001' } },
          first: 1,
        }),
      );
    });

    it('supports filtering by team', async () => {
      const result = await listProjectsTool.handler(
        { filter: { team: { id: { eq: 'team-eng' } } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify team filter was passed
      expect(mockClient.projects).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { team: { id: { eq: 'team-eng' } } },
        }),
      );
    });

    it('supports includeArchived option', async () => {
      const result = await listProjectsTool.handler(
        { includeArchived: true },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
    });

    it('respects limit parameter', async () => {
      const result = await listProjectsTool.handler({ limit: 5 }, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.limit).toBe(5);
    });

    it('supports pagination with cursor', async () => {
      const result = await listProjectsTool.handler(
        { cursor: 'test-cursor' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.cursor).toBe('test-cursor');
    });
  });

  describe('output shape', () => {
    it('matches ListProjectsOutputSchema', async () => {
      const result = await listProjectsTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      for (const item of items) {
        expect(item.id).toBeDefined();
        expect(item.name).toBeDefined();
        expect(item.state).toBeDefined();
      }
    });

    it('includes project metadata (lead, team, dates)', async () => {
      const result = await listProjectsTool.handler({}, baseContext);

      const structured = result.structuredContent as Record<string, unknown>;
      const items = structured.items as Array<Record<string, unknown>>;

      // At least one project should have metadata
      const hasMetadata = items.some((p) => p.leadId !== undefined || p.teamId !== undefined);
      expect(hasMetadata).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Create Projects Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_projects tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(createProjectsTool.name).toBe('create_projects');
      expect(createProjectsTool.title).toBe('Create Projects (Batch)');
    });

    it('has non-destructive annotations', () => {
      expect(createProjectsTool.annotations?.readOnlyHint).toBe(false);
      expect(createProjectsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires at least one item', () => {
      const result = createProjectsTool.inputSchema.safeParse({ items: [] });
      expect(result.success).toBe(false);
    });

    it('requires name for each project', () => {
      const result = createProjectsTool.inputSchema.safeParse({ items: [{}] });
      expect(result.success).toBe(false);
    });

    it('accepts minimal project (name only)', () => {
      const result = createProjectsTool.inputSchema.safeParse({
        items: [{ name: 'Q1 Goals' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts project with all optional fields', () => {
      const result = createProjectsTool.inputSchema.safeParse({
        items: [
          {
            name: 'Q1 Goals',
            teamId: 'team-eng',
            leadId: 'user-001',
            description: 'Q1 roadmap',
            targetDate: '2025-03-31',
            state: 'started',
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('creates a single project', async () => {
      const result = await createProjectsTool.handler(
        { items: [{ name: 'New Project' }] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      const summary = structured.summary as { ok: number; failed: number };

      expect(summary.ok).toBe(1);
      expect(mockClient.createProject).toHaveBeenCalledTimes(1);
    });

    it('creates project with all fields', async () => {
      const result = await createProjectsTool.handler(
        {
          items: [
            {
              name: 'Infrastructure Upgrade',
              teamId: 'team-eng',
              leadId: 'user-001',
              description: 'Modernize stack',
              targetDate: '2025-06-30',
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // API uses teamIds array, not teamId
      expect(mockClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Infrastructure Upgrade',
          teamIds: ['team-eng'],
          leadId: 'user-001',
        }),
      );
    });

    it('batch creates multiple projects', async () => {
      const result = await createProjectsTool.handler(
        {
          items: [
            { name: 'Project A' },
            { name: 'Project B' },
            { name: 'Project C' },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      const summary = structured.summary as { ok: number; failed: number };

      expect(summary.ok).toBe(3);
      expect(mockClient.createProject).toHaveBeenCalledTimes(3);
    });

    it('returns project IDs for created projects', async () => {
      const result = await createProjectsTool.handler(
        { items: [{ name: 'Test Project' }] },
        baseContext,
      );

      const structured = result.structuredContent as Record<string, unknown>;
      const results = structured.results as Array<Record<string, unknown>>;

      expect(results[0].ok).toBe(true);
      expect(results[0].id).toBeDefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Update Projects Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_projects tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(updateProjectsTool.name).toBe('update_projects');
      expect(updateProjectsTool.title).toBe('Update Projects (Batch)');
    });

    it('has non-destructive annotations', () => {
      expect(updateProjectsTool.annotations?.readOnlyHint).toBe(false);
      expect(updateProjectsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires at least one item', () => {
      const result = updateProjectsTool.inputSchema.safeParse({ items: [] });
      expect(result.success).toBe(false);
    });

    it('requires id for each project', () => {
      const result = updateProjectsTool.inputSchema.safeParse({
        items: [{ name: 'Updated' }],
      });
      expect(result.success).toBe(false);
    });

    it('accepts update with id and any field', () => {
      const result = updateProjectsTool.inputSchema.safeParse({
        items: [{ id: 'project-001', name: 'Updated Name' }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('updates project name', async () => {
      const result = await updateProjectsTool.handler(
        { items: [{ id: 'project-001', name: 'New Name' }] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.updateProject).toHaveBeenCalledWith(
        'project-001',
        expect.objectContaining({ name: 'New Name' }),
      );
    });

    it('updates project state', async () => {
      const result = await updateProjectsTool.handler(
        { items: [{ id: 'project-001', state: 'completed' }] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.updateProject).toHaveBeenCalledWith(
        'project-001',
        expect.objectContaining({ state: 'completed' }),
      );
    });

    it('updates multiple fields at once', async () => {
      const result = await updateProjectsTool.handler(
        {
          items: [
            {
              id: 'project-001',
              name: 'Updated',
              state: 'started',
              leadId: 'user-002',
              targetDate: '2025-12-31',
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.updateProject).toHaveBeenCalledWith(
        'project-001',
        expect.objectContaining({
          name: 'Updated',
          state: 'started',
          leadId: 'user-002',
          targetDate: '2025-12-31',
        }),
      );
    });

    it('batch updates multiple projects', async () => {
      const result = await updateProjectsTool.handler(
        {
          items: [
            { id: 'project-001', state: 'started' },
            { id: 'project-002', state: 'completed' },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      const summary = structured.summary as { ok: number; failed: number };

      expect(summary.ok).toBe(2);
      expect(mockClient.updateProject).toHaveBeenCalledTimes(2);
    });

    it('accepts archived in schema (note: not implemented in handler yet)', async () => {
      // The schema accepts archived, but handler doesn't implement it yet
      const schemaResult = updateProjectsTool.inputSchema.safeParse({
        items: [{ id: 'project-001', archived: true }],
      });

      expect(schemaResult.success).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Common Workflow Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('projects common workflows', () => {
  it('roadmap view: list active projects with state filter', async () => {
    const result = await listProjectsTool.handler(
      { filter: { state: { in: ['started', 'planned'] } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify filter was applied
    expect(mockClient.projects).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { state: { in: ['started', 'planned'] } },
      }),
    );

    // Results should include project data
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
  });

  it('milestone tracking: get single project by ID', async () => {
    const result = await listProjectsTool.handler(
      { filter: { id: { eq: 'project-001' } }, limit: 1 },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items.length).toBeLessThanOrEqual(1);
    expect(structured.limit).toBe(1);
  });

  it('project creation with team assignment', async () => {
    const result = await createProjectsTool.handler(
      {
        items: [
          {
            name: 'Mobile App',
            teamId: 'team-eng',
            leadId: 'user-001',
            targetDate: '2025-09-01',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify API was called with correct data
    expect(mockClient.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Mobile App',
        teamIds: ['team-eng'],
        leadId: 'user-001',
        targetDate: '2025-09-01',
      }),
    );
  });
});

