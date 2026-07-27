import { readFileSync } from 'node:fs';
import type { LinearClient } from '@linear/sdk';
import {
  Client,
  type FetchLike,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type { AuthInfo, OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildHttpApp, type HttpRuntime } from '../src/http/app.js';
import { buildAuthApp } from '../src/http/auth-app.js';
import { createOpaqueLinearTokenVerifier } from '../src/shared/auth/opaque-verifier.js';
import { parseConfig, type UnifiedConfig } from '../src/shared/config/env.js';
import { MemoryTokenStore } from '../src/shared/storage/memory.js';
import {
  createMockLinearClient,
  type MockLinearClient,
} from './mocks/linear-client.js';

vi.unmock('../src/services/linear/client.js');

interface Exchange {
  method: string;
  requestHeaders: Headers;
  status: number;
  responseHeaders: Headers;
}

interface TestConnection {
  client: Client;
  exchanges: Exchange[];
}

const activeRuntimes = new Set<HttpRuntime>();
const activeClients = new Set<Client>();

const baseline = JSON.parse(
  readFileSync(new URL('./snapshots/pre-v2-contract.json', import.meta.url), 'utf8'),
) as {
  tools: Array<Record<string, unknown>>;
  resources: Array<Record<string, unknown>>;
};

const expectedToolOrder = baseline.tools.map((tool) => String(tool.name));

function testConfig(overrides: Record<string, unknown> = {}): UnifiedConfig {
  return parseConfig({
    NODE_ENV: 'test',
    MCP_PUBLIC_URL: 'http://localhost:3000/mcp',
    MCP_ALLOWED_HOSTS: 'localhost',
    MCP_ALLOWED_ORIGIN_HOSTNAMES: 'localhost',
    AUTH_ENABLED: 'false',
    ...overrides,
  });
}

function mockAsLinearClient(client: MockLinearClient): LinearClient {
  return client as never;
}

function createRuntime(
  config = testConfig(),
  options: {
    store?: MemoryTokenStore;
    verifier?: OAuthTokenVerifier;
    mockClient?: MockLinearClient;
    linearClientFactory?: (
      providerToken: string | undefined,
      clientId: string | undefined,
    ) => LinearClient;
    onToolContext?: Parameters<typeof buildHttpApp>[1]['onToolContext'];
  } = {},
): HttpRuntime {
  const store = options.store ?? new MemoryTokenStore();
  const runtime = buildHttpApp(config, {
    runtimeName: 'test',
    tokenStore: store,
    ...(options.verifier ? { verifier: options.verifier } : {}),
    ...(options.onToolContext ? { onToolContext: options.onToolContext } : {}),
    linearClientFactory:
      options.linearClientFactory ??
      (() => mockAsLinearClient(options.mockClient ?? createMockLinearClient())),
  });
  activeRuntimes.add(runtime);
  return runtime;
}

function runtimeFetch(
  runtime: HttpRuntime,
  exchanges: Exchange[],
  token?: string,
): FetchLike {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Host', 'localhost:3000');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await runtime.fetch(new Request(url, { ...init, headers }));
    exchanges.push({
      method: init?.method ?? 'GET',
      requestHeaders: new Headers(headers),
      status: response.status,
      responseHeaders: new Headers(response.headers),
    });
    return response;
  };
}

async function connect(
  runtime: HttpRuntime,
  mode: 'modern' | 'legacy',
  token?: string,
): Promise<TestConnection> {
  const exchanges: Exchange[] = [];
  const client = new Client(
    { name: `linear-test-${mode}`, version: '1.0.0' },
    mode === 'modern'
      ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      : undefined,
  );
  const transport = new StreamableHTTPClientTransport(
    new URL('http://localhost:3000/mcp'),
    {
      fetch: runtimeFetch(runtime, exchanges, token),
      ...(token ? { authProvider: { token: async () => token } } : {}),
    },
  );
  await client.connect(transport);
  activeClients.add(client);
  return { client, exchanges };
}

function textFromContent(content: unknown): string | undefined {
  if (!content || typeof content !== 'object' || !('text' in content)) {
    return undefined;
  }
  return typeof content.text === 'string' ? content.text : undefined;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 2_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for event')), timeoutMs);
    }),
  ]);
}

function normalizeZod4SchemaDelta(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeZod4SchemaDelta);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          key !== '$schema' &&
          key !== 'propertyNames' &&
          key !== 'additionalProperties',
      )
      .map(([key, entry]) => [key, normalizeZod4SchemaDelta(entry)]),
  );
}

function preservedToolContract(tool: Record<string, unknown>) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: normalizeZod4SchemaDelta(tool.inputSchema),
    annotations: tool.annotations,
  };
}

afterEach(async () => {
  await Promise.all([...activeClients].map((client) => client.close()));
  await Promise.all([...activeRuntimes].map((runtime) => runtime.close()));
  activeClients.clear();
  activeRuntimes.clear();
});

describe('MCP 2026-07-28 Linear contract', () => {
  test('serves the exact tool snapshot, structured output, resources, and empty prompts', async () => {
    const mockClient = createMockLinearClient();
    const runtime = createRuntime(testConfig(), { mockClient });
    const { client, exchanges } = await connect(runtime, 'modern');

    expect(client.getProtocolEra()).toBe('modern');
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    expect(client.getServerCapabilities()).toEqual({
      prompts: { listChanged: true },
      resources: { listChanged: true, subscribe: true },
      tools: { listChanged: true },
    });

    const tools = await client.listTools();
    expect(tools.ttlMs).toBe(60_000);
    expect(tools.cacheScope).toBe('private');
    expect(tools.tools.map((tool) => tool.name)).toEqual(expectedToolOrder);
    expect(tools.tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
    expect(tools.tools.map((tool) => preservedToolContract(tool))).toEqual(
      baseline.tools.map(preservedToolContract),
    );

    const success = await client.callTool({
      name: 'list_issues',
      arguments: { limit: 1 },
    });
    expect(success.isError).not.toBe(true);
    expect(success.structuredContent).toMatchObject({
      items: expect.any(Array),
      limit: 1,
    });

    mockClient._calls.rawRequest.length = 0;
    vi.mocked(mockClient.client.rawRequest).mockRejectedValueOnce(
      new Error('mocked GraphQL unavailable'),
    );
    const failure = await client.callTool({
      name: 'list_issues',
      arguments: { limit: 1 },
    });
    expect(failure.isError).toBe(true);
    expect(textFromContent(failure.content[0])).toContain('mocked GraphQL unavailable');

    const resources = await client.listResources();
    expect(resources.resources).toEqual(baseline.resources);
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates).toEqual([]);
    const ui = await client.readResource({ uri: 'ui://linear/issues' });
    expect(ui.ttlMs).toBe(60_000);
    expect(ui.cacheScope).toBe('private');
    expect(textFromContent(ui.contents[0])).toContain('<title>Linear Issues</title>');

    const uiTool = await client.callTool({
      name: 'show_issues_ui',
      arguments: { assignedToMe: true },
    });
    expect(uiTool.structuredContent).toMatchObject({
      action: 'show_issues_ui',
      filters: { assignedToMe: true },
    });
    expect(uiTool._meta).toMatchObject({
      ui: { resourceUri: 'ui://linear/issues' },
    });

    const prompts = await client.listPrompts();
    expect(prompts.prompts).toEqual([]);
    expect(client.getServerCapabilities()?.completions).toBeUndefined();

    const modernExchanges = exchanges.filter(
      (exchange) =>
        exchange.requestHeaders.get('MCP-Protocol-Version') === '2026-07-28',
    );
    expect(modernExchanges.length).toBeGreaterThan(1);
    expect(
      modernExchanges.every(
        (exchange) =>
          exchange.requestHeaders.has('Mcp-Method') &&
          !exchange.responseHeaders.has('Mcp-Session-Id'),
      ),
    ).toBe(true);
  });

  test('serves the SDK stateless legacy fallback without session state', async () => {
    const runtime = createRuntime();
    const { client, exchanges } = await connect(runtime, 'legacy');

    expect(client.getProtocolEra()).toBe('legacy');
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(false);
    expect(client.getServerCapabilities()?.resources?.subscribe).toBe(false);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expectedToolOrder);
    const result = await client.callTool({
      name: 'show_issues_ui',
      arguments: {},
    });
    expect(result.structuredContent).toMatchObject({ action: 'show_issues_ui' });
    expect(
      exchanges.some(
        (exchange) => exchange.method === 'GET' && exchange.status === 405,
      ),
    ).toBe(true);
    expect(
      exchanges.every((exchange) => !exchange.responseHeaders.has('Mcp-Session-Id')),
    ).toBe(true);
  });

  test('uses public subscription and cancellation APIs', async () => {
    const mockClient = createMockLinearClient();
    let requestSignal: AbortSignal | undefined;
    const runtime = createRuntime(testConfig(), {
      mockClient,
      onToolContext: (context) => {
        requestSignal = context.signal;
      },
    });
    const { client } = await connect(runtime, 'modern');

    let received: (() => void) | undefined;
    const updated = new Promise<void>((resolve) => {
      received = resolve;
    });
    client.setNotificationHandler(
      'notifications/resources/updated',
      async (notification) => {
        if (notification.params?.uri === 'ui://linear/issues') received?.();
      },
    );
    const subscription = await client.listen({
      resourceSubscriptions: ['ui://linear/issues'],
    });
    expect(subscription.honoredFilter).toEqual({
      resourceSubscriptions: ['ui://linear/issues'],
    });
    runtime.notify.resourceUpdated('ui://linear/issues');
    await withTimeout(updated);
    await subscription.close();

    vi.mocked(mockClient.teams).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                nodes: [],
                pageInfo: { hasNextPage: false },
              }),
            500,
          );
        }),
    );
    const controller = new AbortController();
    const pending = client.callTool(
      { name: 'list_teams', arguments: {} },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow();
    expect(requestSignal?.aborted).toBe(true);
  });
});

describe('HTTP transport security', () => {
  test('enforces method, Host, Origin, CORS, body, and SDK header errors', async () => {
    const runtime = createRuntime(testConfig({ MCP_MAX_REQUEST_BYTES: '1024' }));

    const get = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'GET',
        headers: { Host: 'localhost:3000' },
      }),
    );
    expect(get.status).toBe(405);

    const untrustedHost = await runtime.fetch(
      new Request('http://localhost:3000/health', {
        headers: { Host: 'evil.example' },
      }),
    );
    expect(untrustedHost.status).toBe(403);

    const untrustedOrigin = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
    );
    expect(untrustedOrigin.status).toBe(403);
    expect(untrustedOrigin.headers.has('Access-Control-Allow-Origin')).toBe(false);

    const preflight = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'OPTIONS',
        headers: {
          Host: 'localhost:3000',
          Origin: 'http://localhost:8080',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers':
            'authorization, content-type, mcp-param-tenant',
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:8080',
    );

    const oversized = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          'Content-Type': 'application/json',
        },
        body: 'x'.repeat(1_025),
      }),
    );
    expect(oversized.status).toBe(413);

    const discover = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': {
            name: 'raw-test',
            version: '1.0.0',
          },
        },
      },
    });
    const mismatch = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: discover,
      }),
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ error: { code: -32020 } });
  });
});

describe('active Linear OAuth proxy', () => {
  test('preserves authorize/callback/token routes and stored RS mappings', async () => {
    const config = testConfig({
      AUTH_ENABLED: 'true',
      PROVIDER_CLIENT_ID: 'linear-client-id',
      PROVIDER_CLIENT_SECRET: 'linear-client-secret',
      PROVIDER_ACCOUNTS_URL: 'https://linear.app/oauth',
      OAUTH_TOKEN_URL: 'https://api.linear.app/oauth/token',
      OAUTH_SCOPES: 'read write',
      OAUTH_REQUIRED_SCOPES: 'read write',
      OAUTH_REDIRECT_URI: 'http://localhost:9999/callback',
      OAUTH_REDIRECT_ALLOWLIST: 'http://localhost:9999/callback',
    });
    const store = new MemoryTokenStore();
    const app = buildAuthApp(config, store, new URL('http://localhost:3001'));
    const verifier = 'oauth-verifier-value';
    const challengeBytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(verifier),
    );
    const challenge = Buffer.from(challengeBytes).toString('base64url');

    const authorize = await app.fetch(
      new Request(
        `http://localhost:3001/authorize?${new URLSearchParams({
          response_type: 'code',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          redirect_uri: 'http://localhost:9999/callback',
          state: 'client-state',
          scope: 'read write',
        })}`,
        { headers: { Host: 'localhost:3001' } },
      ),
    );
    expect(authorize.status).toBe(302);
    const providerRedirect = new URL(authorize.headers.get('Location') ?? '');
    expect(providerRedirect.origin).toBe('https://linear.app');
    const compositeState = providerRedirect.searchParams.get('state');
    expect(compositeState).toBeTruthy();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          access_token: 'linear-provider-access',
          refresh_token: 'linear-provider-refresh-secret',
          expires_in: 3600,
          scope: 'read write',
        }),
      ),
    );
    try {
      const callback = await app.fetch(
        new Request(
          `http://localhost:3001/oauth/callback?${new URLSearchParams({
            code: 'linear-provider-code',
            state: compositeState ?? '',
          })}`,
          { headers: { Host: 'localhost:3001' } },
        ),
      );
      expect(callback.status).toBe(302);
      const clientRedirect = new URL(callback.headers.get('Location') ?? '');
      expect(clientRedirect.origin).toBe('http://localhost:9999');
      expect(clientRedirect.searchParams.get('state')).toBe('client-state');
      const authorizationCode = clientRedirect.searchParams.get('code');
      expect(authorizationCode).toBeTruthy();

      const token = await app.fetch(
        new Request('http://localhost:3001/token', {
          method: 'POST',
          headers: {
            Host: 'localhost:3001',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: authorizationCode ?? '',
            code_verifier: verifier,
          }),
        }),
      );
      expect(token.status).toBe(200);
      const issued = (await token.json()) as {
        access_token: string;
        refresh_token: string;
      };
      expect(issued.access_token).not.toBe('linear-provider-access');
      expect(issued.refresh_token).not.toBe('linear-provider-refresh-secret');
      const record = await store.getByRsAccess(issued.access_token);
      expect(record).toMatchObject({
        rs_access_token: issued.access_token,
        rs_refresh_token: issued.refresh_token,
        provider: {
          access_token: 'linear-provider-access',
          refresh_token: 'linear-provider-refresh-secret',
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('opaque MCP authentication and Linear authorization separation', () => {
  test('serves metadata and maps only validated provider access tokens per principal', async () => {
    const config = testConfig({
      AUTH_ENABLED: 'true',
      OAUTH_REQUIRED_SCOPES: 'read write',
    });
    const store = new MemoryTokenStore();
    const expiresAt = Date.now() + 300_000;
    await store.storeRsMapping(
      'mcp-alice',
      {
        access_token: 'linear-alice',
        refresh_token: 'refresh-alice-secret',
        expires_at: expiresAt,
        scopes: ['read', 'write'],
      },
      'rs-refresh-alice',
    );
    await store.storeRsMapping(
      'mcp-bob',
      {
        access_token: 'linear-bob',
        refresh_token: 'refresh-bob-secret',
        expires_at: expiresAt,
        scopes: ['read', 'write'],
      },
      'rs-refresh-bob',
    );
    await store.storeRsMapping(
      'mcp-limited',
      {
        access_token: 'linear-limited',
        expires_at: expiresAt,
        scopes: ['read'],
      },
      'rs-refresh-limited',
    );

    const verifier = createOpaqueLinearTokenVerifier(config, store);
    const authInfo = await verifier.verifyAccessToken('mcp-alice');
    expect(authInfo.extra).toEqual({
      linearProviderAccessToken: 'linear-alice',
    });
    expect(authInfo.extra).not.toHaveProperty('refresh_token');
    expect(authInfo.extra).not.toHaveProperty('refreshToken');

    const providerTokens: string[] = [];
    const runtime = createRuntime(config, {
      store,
      verifier,
      linearClientFactory: (providerToken) => {
        if (providerToken) providerTokens.push(providerToken);
        return mockAsLinearClient(createMockLinearClient());
      },
    });

    const metadata = await runtime.fetch(
      new Request('http://localhost:3000/.well-known/oauth-protected-resource/mcp', {
        headers: { Host: 'localhost:3000' },
      }),
    );
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: 'http://localhost:3000/mcp',
      scopes_supported: ['read', 'write'],
    });

    const missing = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'GET',
        headers: { Host: 'localhost:3000' },
      }),
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.get('WWW-Authenticate')).toContain('resource_metadata=');

    const invalid = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'GET',
        headers: {
          Host: 'localhost:3000',
          Authorization: 'Bearer unknown-mcp-token',
        },
      }),
    );
    expect(invalid.status).toBe(401);

    const insufficient = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'GET',
        headers: {
          Host: 'localhost:3000',
          Authorization: 'Bearer mcp-limited',
        },
      }),
    );
    expect(insufficient.status).toBe(403);
    expect(insufficient.headers.get('WWW-Authenticate')).toContain(
      'insufficient_scope',
    );

    const [alice, bob] = await Promise.all([
      connect(runtime, 'modern', 'mcp-alice'),
      connect(runtime, 'modern', 'mcp-bob'),
    ]);
    await Promise.all([
      alice.client.callTool({ name: 'list_teams', arguments: { limit: 1 } }),
      bob.client.callTool({ name: 'list_teams', arguments: { limit: 1 } }),
    ]);

    expect(providerTokens.sort()).toEqual(['linear-alice', 'linear-bob']);
    expect(providerTokens).not.toContain('mcp-alice');
    expect(providerTokens).not.toContain('mcp-bob');
  });

  test('custom verifier AuthInfo cannot make the MCP token a provider token', async () => {
    const config = testConfig({
      AUTH_ENABLED: 'true',
      OAUTH_REQUIRED_SCOPES: 'read',
    });
    const verifier: OAuthTokenVerifier = {
      async verifyAccessToken(token): Promise<AuthInfo> {
        return {
          token,
          clientId: `client-${token}`,
          scopes: ['read'],
          expiresAt: Math.floor(Date.now() / 1_000) + 300,
          resource: new URL(config.MCP_PUBLIC_URL.href),
          extra: { linearProviderAccessToken: `provider-${token}` },
        };
      },
    };
    const seen: Array<[string | undefined, string | undefined]> = [];
    const runtime = createRuntime(config, {
      verifier,
      linearClientFactory: (providerToken, clientId) => {
        seen.push([providerToken, clientId]);
        return mockAsLinearClient(createMockLinearClient());
      },
    });
    const { client } = await connect(runtime, 'modern', 'mcp-caller-token');
    await client.callTool({ name: 'list_users', arguments: { limit: 1 } });
    expect(seen).toEqual([['provider-mcp-caller-token', 'client-mcp-caller-token']]);
  });
});
