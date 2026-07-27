/**
 * Live API Integration Tests
 *
 * Tests real Linear API to verify:
 * - CRUD operations work correctly
 * - Filtering returns expected results
 * - Pagination works with cursors
 * - Error handling for invalid requests
 * - Rate limiting / retry behavior under load
 *
 * Run with: bun run test:integration
 */

import { LinearClient } from '@linear/sdk';
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createIssuesTool } from '../../src/shared/tools/linear/create-issues.js';
import { getIssuesTool } from '../../src/shared/tools/linear/get-issues.js';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import { updateIssuesTool } from '../../src/shared/tools/linear/update-issues.js';

// Unmock the client service so we get the REAL implementation
vi.unmock('../../src/services/linear/client.js');

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

// Live tests are destructive and require an explicit opt-in in addition to credentials.
const runLive = process.env.RUN_LINEAR_LIVE_TESTS === 'true';
const envPath = path.resolve(__dirname, '../../.env');
if (runLive && fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split('\n').forEach((line) => {
    const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      const value = match[2] ? match[2].trim() : '';
      process.env[key] = value;
    }
  });
}

const apiKey = runLive
  ? process.env.PROVIDER_API_KEY || process.env.LINEAR_ACCESS_TOKEN
  : undefined;

const describeIf = runLive && apiKey ? describe : describe.skip;

describeIf('Live API Integration', () => {
  // Ensure real client gets real token
  process.env.LINEAR_ACCESS_TOKEN = apiKey!;

  let client: LinearClient;
  let testTeamId: string;
  const createdIssueIds: string[] = [];
  let workflowStates: { id: string; name: string; type: string }[] = [];

  const testContext = {
    sessionId: 'integration-test',
    linearProviderAccessToken: apiKey!,
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Setup & Teardown
  // ───────────────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    console.log('\n🔧 Setting up integration tests...');

    const clientOptions = apiKey?.startsWith('lin_')
      ? { apiKey }
      : { accessToken: apiKey };
    client = new LinearClient(clientOptions);

    // Find the "Tests" team
    const teams = await client.teams();
    const testTeam = teams.nodes.find((t) => t.name === 'Tests');

    if (!testTeam) {
      throw new Error('Team "Tests" not found. Please create it in Linear.');
    }

    testTeamId = testTeam.id;
    console.log(`✓ Found team: ${testTeam.name} (${testTeam.id})`);

    // Get workflow states for the team
    const states = await testTeam.states();
    workflowStates = states.nodes.map((s) => ({
      id: s.id,
      name: s.name,
      type: (s as unknown as { type: string }).type,
    }));
    console.log(`✓ Found ${workflowStates.length} workflow states`);
  }, 30000);

  afterAll(async () => {
    // Cleanup all created issues
    if (createdIssueIds.length > 0) {
      console.log(`\n🧹 Cleaning up ${createdIssueIds.length} issues...`);
      for (const id of createdIssueIds) {
        try {
          await client.deleteIssue(id);
        } catch {
          // Issue might already be deleted
        }
      }
      console.log('✓ Cleanup complete');
    }
  }, 60000);

  // Helper to track created issues for cleanup
  const trackIssue = (id: string) => {
    if (id && !createdIssueIds.includes(id)) {
      createdIssueIds.push(id);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // CRUD Operations
  // ───────────────────────────────────────────────────────────────────────────

  describe('CRUD Operations', () => {
    let testIssueId: string;
    let testIssueIdentifier: string;

    it('CREATE: should create an issue', async () => {
      const title = `Integration Test - Create ${Date.now()}`;

      const result = await createIssuesTool.handler(
        {
          items: [
            {
              teamId: testTeamId,
              title,
              description: 'Created by integration test',
              priority: 3,
            },
          ],
        },
        testContext,
      );

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as any;
      expect(structured.summary.succeeded).toBe(1);

      testIssueId = structured.results[0].id;
      testIssueIdentifier = structured.results[0].identifier;
      trackIssue(testIssueId);

      console.log(`  ✓ Created issue ${testIssueIdentifier}`);
    });

    it('READ: should fetch the created issue by ID', async () => {
      const result = await getIssuesTool.handler(
        {
          ids: [testIssueId],
        },
        testContext,
      );

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as any;
      expect(structured.summary.succeeded).toBe(1);
      expect(structured.results[0].issue.id).toBe(testIssueId);
    });

    it('READ: should fetch issue by identifier (e.g., TES-123)', async () => {
      const result = await getIssuesTool.handler(
        {
          ids: [testIssueIdentifier],
        },
        testContext,
      );

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as any;
      expect(structured.summary.succeeded).toBe(1);
    });

    it('UPDATE: should update the issue title and priority', async () => {
      const newTitle = `Updated Title ${Date.now()}`;

      const result = await updateIssuesTool.handler(
        {
          items: [
            {
              id: testIssueId,
              title: newTitle,
              priority: 1, // Urgent
            },
          ],
        },
        testContext,
      );

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as any;
      expect(structured.summary.succeeded).toBe(1);

      // Verify the update
      const issue = await client.issue(testIssueId);
      expect(issue.title).toBe(newTitle);
      expect(issue.priority).toBe(1);
    });

    it('LIST: should find the issue in list results', async () => {
      const result = await listIssuesTool.handler(
        {
          teamId: testTeamId,
          limit: 50,
        },
        testContext,
      );

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as any;
      const found = structured.items.find((i: any) => i.id === testIssueId);
      expect(found).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Filtering
  // ───────────────────────────────────────────────────────────────────────────

  describe('Filtering', () => {
    let urgentIssueId: string;
    let lowPriorityIssueId: string;

    beforeAll(async () => {
      // Create issues with different priorities for filtering tests
      const result = await createIssuesTool.handler(
        {
          items: [
            {
              teamId: testTeamId,
              title: `Filter Test - Urgent ${Date.now()}`,
              priority: 1,
            },
            {
              teamId: testTeamId,
              title: `Filter Test - Low ${Date.now()}`,
              priority: 4,
            },
          ],
        },
        testContext,
      );

      const structured = result.structuredContent as any;
      urgentIssueId = structured.results[0].id;
      lowPriorityIssueId = structured.results[1].id;
      trackIssue(urgentIssueId);
      trackIssue(lowPriorityIssueId);

      console.log(`  ✓ Created filter test issues`);
    }, 30000);

    it('should filter by priority (urgent only)', async () => {
      const result = await listIssuesTool.handler(
        {
          teamId: testTeamId,
          filter: { priority: { eq: 1 } },
          limit: 50,
        },
        testContext,
      );

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as any;

      // All returned issues should be urgent
      for (const item of structured.items) {
        expect(item.priority).toBe(1);
      }

      // Our urgent issue should be in results
      const found = structured.items.find((i: any) => i.id === urgentIssueId);
      expect(found).toBeDefined();
    });

    it('should filter by title search (containsIgnoreCase)', async () => {
      const result = await listIssuesTool.handler(
        {
          teamId: testTeamId,
          filter: { title: { containsIgnoreCase: 'Filter Test' } },
          limit: 50,
        },
        testContext,
      );

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as any;

      // Should find at least our 2 filter test issues
      expect(structured.items.length).toBeGreaterThanOrEqual(2);

      // All results should contain "Filter Test" in title
      for (const item of structured.items) {
        expect(item.title.toLowerCase()).toContain('filter test');
      }
    });

    it('should filter by workflow state type', async () => {
      // Find a "backlog" state
      const backlogState = workflowStates.find((s) => s.type === 'backlog');
      if (!backlogState) {
        console.log('  ⚠ No backlog state found, skipping test');
        return;
      }

      const result = await listIssuesTool.handler(
        {
          teamId: testTeamId,
          filter: { state: { type: { eq: 'backlog' } } },
          limit: 50,
        },
        testContext,
      );

      expect(result.isError).toBeFalsy();
      // Just verify it doesn't error - actual results depend on workspace data
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Pagination
  // ───────────────────────────────────────────────────────────────────────────

  describe('Pagination', () => {
    const paginationIssueIds: string[] = [];

    beforeAll(async () => {
      // Create 5 issues to test pagination
      const items = Array.from({ length: 5 }, (_, i) => ({
        teamId: testTeamId,
        title: `Pagination Test ${i + 1} - ${Date.now()}`,
        priority: 4,
      }));

      const result = await createIssuesTool.handler({ items }, testContext);
      const structured = result.structuredContent as any;

      for (const r of structured.results) {
        if (r.id) {
          paginationIssueIds.push(r.id);
          trackIssue(r.id);
        }
      }

      console.log(`  ✓ Created ${paginationIssueIds.length} pagination test issues`);
    }, 60000);

    it('should return limited results with nextCursor', async () => {
      const result = await listIssuesTool.handler(
        {
          teamId: testTeamId,
          filter: { title: { containsIgnoreCase: 'Pagination Test' } },
          limit: 2,
        },
        testContext,
      );

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as any;

      expect(structured.items.length).toBeLessThanOrEqual(2);
      // If we have more than 2 issues, we should have a cursor
      if (paginationIssueIds.length > 2) {
        expect(structured.nextCursor).toBeDefined();
      }
    });

    it('should fetch next page using cursor', async () => {
      // First page
      const page1 = await listIssuesTool.handler(
        {
          teamId: testTeamId,
          filter: { title: { containsIgnoreCase: 'Pagination Test' } },
          limit: 2,
        },
        testContext,
      );

      const structured1 = page1.structuredContent as any;

      if (!structured1.nextCursor) {
        console.log('  ⚠ No next page available, skipping cursor test');
        return;
      }

      // Second page
      const page2 = await listIssuesTool.handler(
        {
          teamId: testTeamId,
          filter: { title: { containsIgnoreCase: 'Pagination Test' } },
          limit: 2,
          cursor: structured1.nextCursor,
        },
        testContext,
      );

      expect(page2.isError).toBeFalsy();
      const structured2 = page2.structuredContent as any;

      // Page 2 should have different items than page 1
      const page1Ids = new Set(structured1.items.map((i: any) => i.id));
      for (const item of structured2.items) {
        expect(page1Ids.has(item.id)).toBe(false);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Error Handling
  // ───────────────────────────────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('should handle non-existent issue gracefully', async () => {
      const result = await getIssuesTool.handler(
        {
          ids: ['non-existent-uuid-12345'],
        },
        testContext,
      );

      // Should not throw, but report error in results
      const structured = result.structuredContent as any;
      expect(structured.summary.failed).toBe(1);
      expect(structured.results[0].success).toBe(false);
      expect(structured.results[0].error).toBeDefined();
    });

    it('should handle invalid filter gracefully', async () => {
      // Linear API throws on invalid filter fields
      // Our tool should either catch this or let it propagate
      // Either way, the system should not crash
      try {
        const result = await listIssuesTool.handler(
          {
            teamId: testTeamId,
            filter: { invalidField: { eq: 'test' } } as any,
            limit: 10,
          },
          testContext,
        );

        // If it didn't throw, it should have isError or empty results
        expect(result).toBeDefined();
      } catch (error) {
        // Expected: Linear rejects invalid filter fields
        expect((error as Error).message).toContain('invalidField');
      }
    });

    it('should handle update of non-existent issue', async () => {
      const result = await updateIssuesTool.handler(
        {
          items: [
            {
              id: 'non-existent-uuid-67890',
              title: 'Should fail',
            },
          ],
        },
        testContext,
      );

      const structured = result.structuredContent as any;
      expect(structured.summary.failed).toBe(1);
      expect(structured.results[0].success).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Rate Limiting / Retry Behavior
  // ───────────────────────────────────────────────────────────────────────────

  describe('Rate Limiting & Retry', () => {
    it('should handle rapid sequential requests', async () => {
      // Create 5 issues in rapid succession to test rate limiting
      const startTime = Date.now();
      const results: any[] = [];

      for (let i = 0; i < 5; i++) {
        const result = await createIssuesTool.handler(
          {
            items: [
              {
                teamId: testTeamId,
                title: `Rate Limit Test ${i + 1} - ${Date.now()}`,
                priority: 4,
              },
            ],
          },
          testContext,
        );

        const structured = result.structuredContent as any;
        results.push(structured);

        if (structured.results[0]?.id) {
          trackIssue(structured.results[0].id);
        }
      }

      const duration = Date.now() - startTime;
      console.log(`  ✓ Created 5 issues in ${duration}ms`);

      // All should succeed (retry logic should handle any transient 429s)
      const successCount = results.filter((r) => r.summary.succeeded === 1).length;
      expect(successCount).toBe(5);
    }, 60000);

    it('should handle batch operations', async () => {
      // Create multiple issues in a single batch
      const items = Array.from({ length: 3 }, (_, i) => ({
        teamId: testTeamId,
        title: `Batch Test ${i + 1} - ${Date.now()}`,
        priority: 4,
      }));

      const result = await createIssuesTool.handler({ items }, testContext);

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as any;
      expect(structured.summary.succeeded).toBe(3);
      expect(structured.summary.failed).toBe(0);

      // Track for cleanup
      for (const r of structured.results) {
        if (r.id) trackIssue(r.id);
      }
    }, 30000);
  });
});
