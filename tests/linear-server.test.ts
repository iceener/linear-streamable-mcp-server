import { afterEach, describe, expect, test } from 'bun:test';
import { NetworkLinearError } from '@linear/sdk';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { AuthInfo, ServerContext } from '@modelcontextprotocol/server';
import { MemoryTokenStore } from '../src/oauth/token-store';
import type { App } from '../src/platform/app';
import { createServer } from '../src/server';
import { tools } from '../src/tools';
import { type LinearContext, withLinear } from '../src/tools/shared/linear';
import {
  callTool,
  cleanup,
  linearFactory,
  PUBLIC_URL,
  testApp,
  testConfig,
  testDeps,
  testProxy,
  textOf,
  track,
} from './helpers';
import { createMockLinearClient } from './mocks/linear-client';
import { PROXY_ENV } from './oauth/fixture';

afterEach(cleanup);

/**
 * Ported from the checkpoint's protocol suite: the Linear server through the whole app, with
 * the OAuth proxy verifying the caller and the Linear client mocked. The template's own suites
 * (http, sdk-contract, auth) cover the transport rules it also checked.
 */
const IN_FIVE_MINUTES = () => Date.now() + 300_000;

async function storeWithUsers(): Promise<MemoryTokenStore> {
  const tokens = new MemoryTokenStore();
  for (const [access, linear, scopes] of [
    ['mcp-alice', 'linear-alice', ['read', 'write']],
    ['mcp-bob', 'linear-bob', ['read', 'write']],
    ['mcp-limited', 'linear-limited', ['read']],
  ] as const) {
    await tokens.storeRsMapping(
      access,
      {
        access_token: linear,
        refresh_token: `${linear}-refresh-secret`,
        expires_at: IN_FIVE_MINUTES(),
        scopes: [...scopes],
      },
      `${access}-refresh`,
    );
  }
  return tokens;
}

function linearApp(tokens: MemoryTokenStore, linear = linearFactory(createMockLinearClient())) {
  const config = testConfig(PROXY_ENV);
  const deps = testDeps({ config, linear });
  deps.oauth = testProxy({ config, logger: deps.logger, tokens });
  return { app: testApp(config, { deps, server: createServer }), linear };
}

async function connectTo(app: App, token: string, era: 'modern' | 'legacy' = 'modern') {
  const client = new Client(
    { name: 'linear-test', version: '1.0.0' },
    { versionNegotiation: { mode: era === 'modern' ? 'auto' : 'legacy' } },
  );
  const exchanges: Array<{ method: string; status: number; session: boolean }> = [];
  await client.connect(
    new StreamableHTTPClientTransport(new URL(PUBLIC_URL), {
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Host', '127.0.0.1:3000');
        headers.set('Authorization', `Bearer ${token}`);
        const response = await app.fetch(new Request(String(url), { ...init, headers }));
        exchanges.push({
          method: init?.method ?? 'GET',
          status: response.status,
          session: response.headers.has('Mcp-Session-Id'),
        });
        return response;
      },
    }),
  );
  return { client: track(client), exchanges };
}

describe('opaque MCP tokens and Linear tokens stay apart', () => {
  test('tools get each caller its own Linear token, never the MCP token', async () => {
    const { app, linear } = linearApp(await storeWithUsers());
    const [alice, bob] = await Promise.all([
      connectTo(app, 'mcp-alice'),
      connectTo(app, 'mcp-bob'),
    ]);
    await Promise.all([
      alice.client.callTool({ name: 'list_teams', arguments: { limit: 1 } }),
      bob.client.callTool({ name: 'list_teams', arguments: { limit: 1 } }),
    ]);

    expect(linear.tokens.sort()).toEqual(['linear-alice', 'linear-bob']);
    expect(linear.tokens).not.toContain('mcp-alice');
    expect(linear.tokens).not.toContain('mcp-bob');
    expect(JSON.stringify(linear.tokens)).not.toContain('refresh-secret');
  });

  test('missing, unknown and under-scoped tokens are refused before any tool runs', async () => {
    const { app, linear } = linearApp(await storeWithUsers());
    const send = (token?: string) =>
      app.fetch(
        new Request(PUBLIC_URL, {
          method: 'GET',
          headers: { Host: '127.0.0.1:3000', ...(token && { Authorization: `Bearer ${token}` }) },
        }),
      );

    const missing = await send();
    expect(missing.status).toBe(401);
    expect(missing.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
    expect((await send('unknown-mcp-token')).status).toBe(401);
    const limited = await send('mcp-limited');
    expect(limited.status).toBe(403);
    expect(limited.headers.get('WWW-Authenticate')).toContain('insufficient_scope');
    expect(linear.tokens).toEqual([]);
  });

  test("a verifier's caller can't turn the MCP token into a Linear token", async () => {
    const config = testConfig(PROXY_ENV);
    const linear = linearFactory(createMockLinearClient());
    const deps = testDeps({ config, linear });
    deps.oauth = {
      ...testProxy({ config, logger: deps.logger }),
      verifier: {
        async verifyAccessToken(token): Promise<AuthInfo> {
          return {
            token,
            clientId: `client-${token}`,
            scopes: ['read', 'write'],
            expiresAt: Math.floor(Date.now() / 1_000) + 300,
            resource: new URL(PUBLIC_URL),
            extra: { providerAccessToken: `provider-${token}` },
          };
        },
      },
    };
    const app = testApp(config, { deps, server: createServer });
    const { client } = await connectTo(app, 'mcp-caller-token');
    await client.callTool({ name: 'list_users', arguments: { limit: 1 } });

    expect(linear.tokens).toEqual(['provider-mcp-caller-token']);
  });
});

describe('the Linear tools over MCP', () => {
  test('both eras: the tools in order, stateless, with list_issues and show_issues_ui working', async () => {
    const mock = createMockLinearClient();
    const { app } = linearApp(await storeWithUsers(), linearFactory(mock));
    for (const era of ['modern', 'legacy'] as const) {
      const { client, exchanges } = await connectTo(app, 'mcp-alice', era);
      expect(client.getProtocolEra()).toBe(era);
      expect(client.getNegotiatedProtocolVersion()).toBe(
        era === 'modern' ? '2026-07-28' : '2025-11-25',
      );
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(tools.map((tool) => tool.name));
      expect(listed.tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);

      const issues = await client.callTool({ name: 'list_issues', arguments: { limit: 1 } });
      expect(issues.isError).not.toBe(true);
      expect(issues.structuredContent).toMatchObject({ items: expect.any(Array), limit: 1 });

      const ui = await client.callTool({
        name: 'show_issues_ui',
        arguments: { assignedToMe: true },
      });
      expect(ui.structuredContent).toMatchObject({
        action: 'show_issues_ui',
        filters: { assignedToMe: true },
      });
      expect(ui._meta).toMatchObject({ ui: { resourceUri: 'ui://linear/issues' } });
      expect(exchanges.every((exchange) => !exchange.session)).toBe(true);
      if (era === 'legacy') {
        // The SDK's stateless fallback: no standalone GET stream.
        const get = await app.fetch(
          new Request(PUBLIC_URL, {
            method: 'GET',
            headers: {
              Host: '127.0.0.1:3000',
              Authorization: 'Bearer mcp-alice',
              Accept: 'text/event-stream',
            },
          }),
        );
        expect(get.status).toBe(405);
      }
    }
  });

  test('the issues dashboard resource is served as before', async () => {
    const { app } = linearApp(await storeWithUsers());
    const { client } = await connectTo(app, 'mcp-alice');
    const ui = await client.readResource({ uri: 'ui://linear/issues' });
    expect(ui).toMatchObject({ ttlMs: 60_000, cacheScope: 'private' });
    expect(ui.contents[0]).toMatchObject({ uri: 'ui://linear/issues', mimeType: 'text/html' });
    expect(textOf({ content: [{ type: 'text', ...ui.contents[0] }] })).toContain(
      '<title>Linear Issues</title>',
    );
    expect((await client.listPrompts()).prompts).toEqual([]);
    expect(client.getServerCapabilities()?.completions).toBeUndefined();
  });

  test('a Linear API failure reaches the model with its message, as before', async () => {
    const mock = createMockLinearClient();
    const failure = new NetworkLinearError({ message: 'mocked GraphQL unavailable' });
    mock.client.rawRequest = (async () => {
      throw failure;
    }) as never;
    const result = await callTool('list_issues', { limit: 1 }, { linear: mock });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Tool error: ${failure.message}`);
  });

  test('any other failure is a bug: logged, and the model gets a reference only', async () => {
    const mock = createMockLinearClient();
    mock.client.rawRequest = (async () => {
      throw new TypeError('secret detail https://api.linear.app?token=x');
    }) as never;
    const deps = testDeps({ linear: linearFactory(mock) });
    const result = await callTool('list_issues', { limit: 1 }, { linear: mock, deps });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/internal error \(reference [0-9a-f-]{36}\)/);
    expect(textOf(result)).not.toContain('secret detail');
  });

  test('LINEAR_MCP_INCLUDE_JSON_IN_CONTENT adds the structured result as JSON text', async () => {
    const mock = createMockLinearClient();
    const plain = await callTool('list_issues', { limit: 1 }, { linear: mock });
    expect(plain.content).toHaveLength(1);

    const config = testConfig({ LINEAR_MCP_INCLUDE_JSON_IN_CONTENT: 'true' });
    const withJson = await callTool(
      'list_issues',
      { limit: 1 },
      { linear: mock, deps: { config } },
    );
    expect(withJson.content).toHaveLength(2);
    const [, json] = withJson.content as Array<{ text: string }>;
    expect(JSON.parse(json?.text ?? '')).toEqual(withJson.structuredContent);
  });

  test('without a Linear token, a tool asks for sign-in, as before', async () => {
    const result = await callTool('list_teams', {}, { authInfo: null });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Tool error: Linear OAuth required: complete the OAuth flow to get an access token',
    );
  });
});

describe('cancellation', () => {
  test('a cancelled call is abandoned, and the tool sees its signal aborted', async () => {
    const mock = createMockLinearClient();
    mock.teams = (() => new Promise(() => {})) as never;
    const { app } = linearApp(await storeWithUsers(), linearFactory(mock));
    const { client } = await connectTo(app, 'mcp-alice');
    const controller = new AbortController();
    const pending = client.callTool(
      { name: 'list_teams', arguments: {} },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow();

    // withLinear hands every tool the request's signal.
    const request = new AbortController();
    let seen: LinearContext | undefined;
    const ctx = { mcpReq: { signal: request.signal }, http: {} } as unknown as ServerContext;
    await withLinear(ctx, testDeps(), async (linear) => {
      seen = linear;
    });
    request.abort();
    expect(seen?.signal.aborted).toBe(true);
  });
});
