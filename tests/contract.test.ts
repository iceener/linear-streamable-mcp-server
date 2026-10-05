import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import before from './fixtures/contract-before.json';
import { cleanup, connect, linearFactory, PUBLIC_URL, signedIn, testDeps } from './helpers';

afterEach(cleanup);

/**
 * The MCP contract clients relied on before the template migration, recorded from the deployed
 * code in `fixtures/contract-before.json`. Names, order, input schemas, output schemas,
 * annotations and descriptions must match exactly. Every other difference is deliberate and
 * listed here (and in CHANGELOG.md).
 */
const TITLES: Record<string, string> = {
  workspace_metadata: 'Discover IDs (Use First)',
  list_issues: 'List Issues',
  get_issues: 'Get Issues (Batch)',
  create_issues: 'Create Issues (Batch)',
  update_issues: 'Update Issues (Batch)',
  list_teams: 'List Teams',
  list_users: 'List Users',
  list_comments: 'List Comments',
  add_comments: 'Add Comments (Batch)',
  update_comments: 'Update Comments (Batch)',
  list_cycles: 'List Cycles',
  list_projects: 'List Projects',
  create_projects: 'Create Projects (Batch)',
  update_projects: 'Update Projects (Batch)',
  show_issues_ui: 'Show Issues Dashboard',
};

/** The one team the recording's Linear stand-in answered with. */
const RECORDED_TEAMS = {
  nodes: [{ id: 'team-1', key: 'ENG', name: 'Engineering', description: null }],
  pageInfo: { hasNextPage: false, endCursor: null },
};

function signedInClient(era: 'modern' | 'legacy') {
  const linear = linearFactory({ teams: async () => RECORDED_TEAMS });
  return connect({ era, deps: testDeps({ linear }), authInfo: signedIn('linear-token') });
}

/** Drop the SDK's own metadata from a recorded answer. */
function withoutMeta<T extends Record<string, unknown>>(value: T): Omit<T, '_meta'> {
  const { _meta, ...rest } = value;
  if (_meta && typeof _meta === 'object') {
    const { 'io.modelcontextprotocol/serverInfo': _server, ...own } = _meta as Record<
      string,
      unknown
    >;
    return (Object.keys(own).length > 0 ? { ...rest, _meta: own } : rest) as Omit<T, '_meta'>;
  }
  return rest;
}

for (const era of ['modern', 'legacy'] as const) {
  describe(`${era} contract`, () => {
    const recorded = before[era];
    const recordedTools = recorded['tools/list'].tools as unknown as Array<Record<string, unknown>>;

    test('the same tools, in the same order, with the same schemas, annotations and descriptions', async () => {
      const client = await signedInClient(era);
      const { tools } = await client.listTools();

      expect(tools.map((tool) => tool.name)).toEqual(
        recordedTools.map((tool) => String(tool.name)),
      );
      for (const [index, tool] of tools.entries()) {
        const old = recordedTools[index] as Record<string, unknown>;
        expect(tool.inputSchema).toEqual(old.inputSchema as typeof tool.inputSchema);
        expect(tool.outputSchema).toEqual(old.outputSchema as typeof tool.outputSchema);
        expect(tool.annotations).toEqual(old.annotations as typeof tool.annotations);
        expect(tool.description).toBe(old.description as string);
        // Added: a display title. Nothing else is new.
        expect(tool.title).toBe(TITLES[tool.name] as string);
        expect(Object.keys(tool).sort()).toEqual([...Object.keys(old), 'title'].sort());
      }
    });

    test('identity, capabilities and instructions, with the deliberate differences', async () => {
      const client = await signedInClient(era);
      const { name, title, description } = recorded.serverInfo;

      expect(client.getServerVersion()).toEqual({
        name,
        title,
        description,
        // Changed: the version, and an icon served from the public origin.
        version: '1.1.0',
        icons: [
          { src: new URL('/icon.svg', PUBLIC_URL).href, mimeType: 'image/svg+xml', sizes: ['any'] },
        ],
      });
      // Changed: no change streams in either era. The lists only change on deploy, and the
      // server never sent a list-changed or resource-updated notification.
      expect(recorded.capabilities).toEqual(
        era === 'modern'
          ? {
              prompts: { listChanged: true },
              resources: { subscribe: true, listChanged: true },
              tools: { listChanged: true },
            }
          : {
              prompts: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              tools: { listChanged: false },
            },
      );
      expect(client.getServerCapabilities()).toEqual({
        tools: { listChanged: false },
        prompts: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      });
      // The instructions are the same text.
      expect(client.getInstructions()).toBe(recorded.instructions as string);
    });

    test('the same resource, no templates and no prompts', async () => {
      const client = await signedInClient(era);

      expect((await client.listResources()).resources).toEqual(
        recorded['resources/list'].resources,
      );
      expect((await client.listResourceTemplates()).resourceTemplates).toEqual([]);
      expect((await client.listPrompts()).prompts).toEqual([]);
      expect(recorded['resources/templates/list'].resourceTemplates).toEqual([]);
      expect(recorded['prompts/list'].prompts).toEqual([]);
    });

    test('the recorded calls answer the same', async () => {
      const client = await signedInClient(era);
      const calls = recorded.calls;

      const teams = await client.callTool({ name: 'list_teams', arguments: {} });
      expect(withoutMeta(teams)).toEqual(withoutMeta(calls.list_teams));

      const ui = await client.callTool({
        name: 'show_issues_ui',
        arguments: { stateType: 'started' },
      });
      expect(withoutMeta(ui)).toEqual(withoutMeta(calls.show_issues_ui));

      const page = await client.readResource({ uri: 'ui://linear/issues' });
      expect(
        page.contents.map((content) => ({
          uri: content.uri,
          mimeType: content.mimeType,
          textLength: 'text' in content ? content.text.length : undefined,
          textSha256: createHash('sha256')
            .update('text' in content ? content.text : '')
            .digest('hex'),
        })),
      ).toEqual(calls['resources/read'].contents);
    });
  });
}

test('the tool list is cacheable by every caller: it is the same for everyone', async () => {
  expect(before.modern['tools/list']).toMatchObject({ ttlMs: 60_000, cacheScope: 'private' });
  const client = await connect();
  expect(await client.listTools()).toMatchObject({ ttlMs: 60_000, cacheScope: 'public' });
});
