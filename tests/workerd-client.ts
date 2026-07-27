import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const baseUrl = new URL(process.env.MCP_TEST_URL ?? 'http://127.0.0.1:8787/mcp');
const expectedTools = [
  'workspace_metadata',
  'list_issues',
  'get_issues',
  'create_issues',
  'update_issues',
  'list_teams',
  'list_users',
  'list_comments',
  'add_comments',
  'update_comments',
  'list_cycles',
  'list_projects',
  'create_projects',
  'update_projects',
  'show_issues_ui',
];

function equal(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
    );
  }
}

async function validate(mode: 'modern' | 'legacy'): Promise<void> {
  const client = new Client(
    { name: `workerd-${mode}`, version: '1.0.0' },
    mode === 'modern'
      ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      : undefined,
  );
  const transport = new StreamableHTTPClientTransport(baseUrl);
  try {
    await client.connect(transport);
    equal(client.getProtocolEra(), mode, `${mode} era`);
    equal(
      (await client.listTools()).tools.map((tool) => tool.name),
      expectedTools,
      `${mode} tools`,
    );
    equal(
      (await client.listResources()).resources.map((resource) => resource.uri),
      ['ui://linear/issues'],
      `${mode} resources`,
    );
    equal((await client.listPrompts()).prompts, [], `${mode} prompts`);
    const resource = await client.readResource({ uri: 'ui://linear/issues' });
    const text = resource.contents[0];
    if (
      !text ||
      !('text' in text) ||
      !text.text.includes('<title>Linear Issues</title>')
    ) {
      throw new Error(`${mode} issues UI resource is missing`);
    }
    const ui = await client.callTool({ name: 'show_issues_ui', arguments: {} });
    const structured = ui.structuredContent as Record<string, unknown> | undefined;
    if (structured?.action !== 'show_issues_ui') {
      throw new Error(`${mode} issues UI tool failed`);
    }
  } finally {
    await client.close();
  }
}

await validate('modern');
await validate('legacy');
console.log('workerd modern+legacy MCP validation passed');
