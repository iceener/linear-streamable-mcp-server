import type { LinearClient } from '@linear/sdk';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type {
  AuthInfo,
  CallToolResult,
  ClientCapabilities,
  McpHttpHandler,
  McpServerFactory,
} from '@modelcontextprotocol/server';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Hono } from 'hono';
import { MemoryOAuthAuthority } from '../src/oauth/authority';
import { createOAuthProxy, type OAuthProxy, type OAuthProxyOptions } from '../src/oauth/proxy';
import { MemoryTokenStore } from '../src/oauth/token-store';
import { PROVIDER_TOKEN } from '../src/oauth/verifier';
import { type App, createApp } from '../src/platform/app';
import { type Config, parseConfig } from '../src/platform/config';
import type { LogFields, Logger } from '../src/platform/logger';
import { createServer, type Deps } from '../src/server';
import type { LinearClientFactory } from '../src/services/linear';
import { LINEAR_SCOPES, linearOAuth } from '../src/services/linear-oauth';
import { fixtureServer } from './fixture';
import { TEST_SETTINGS } from './settings';

export const PUBLIC_URL = 'http://127.0.0.1:3000/mcp';

export function testConfig(env: Record<string, string> = {}): Config {
  return parseConfig({ NODE_ENV: 'test', MCP_PUBLIC_URL: PUBLIC_URL, ...TEST_SETTINGS, ...env });
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  fields: LogFields;
}

/** Records entries instead of printing them, so tests can assert on what was logged. */
export function memoryLogger(entries: LogEntry[] = [], context: LogFields = {}): Logger {
  const log =
    (level: LogEntry['level']) =>
    (message: string, fields: LogFields = {}) => {
      entries.push({ level, message, fields: { ...context, ...fields } });
    };
  return {
    debug: log('debug'),
    info: log('info'),
    warning: log('warning'),
    error: log('error'),
    child: (fields) => memoryLogger(entries, { ...context, ...fields }),
  };
}

/** Answers one request, or `undefined` to fail the test as an unexpected request. */
export type FetchRoute = (request: Request) => Response | undefined | Promise<Response | undefined>;

/**
 * A `fetch` for the OAuth proxy, standing in for Linear's token endpoint. Every request is
 * recorded; one the route doesn't answer throws, so nothing reaches the network.
 */
export function fakeFetch(route: FetchRoute = () => undefined): typeof fetch & {
  requests: Request[];
} {
  const requests: Request[] = [];
  const fetchFake = async (input: string | URL | Request, init?: RequestInit) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    requests.push(request.clone() as Request);
    const response = await route(request);
    if (!response) throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    return response;
  };
  return Object.assign(fetchFake as typeof fetch, { requests });
}

/** The proxy's client at Linear in tests. */
export const LINEAR_CLIENT = { clientId: 'linear-client', clientSecret: 'linear-secret' };

/**
 * An OAuth proxy backed by memory, with Linear answered by `options.fetch`, configured as
 * `createDeps` configures it: issued tokens carry no client binding.
 */
export function testProxy(
  options: Partial<OAuthProxyOptions> & Pick<OAuthProxyOptions, 'config' | 'logger'>,
): OAuthProxy {
  return createOAuthProxy({
    provider: linearOAuth,
    credentials: LINEAR_CLIENT,
    redirectAllowlist: [],
    encryptionKey: undefined,
    bindGrants: false,
    tokens: new MemoryTokenStore(),
    authority: new MemoryOAuthAuthority(),
    fetch: fakeFetch(),
    ...options,
  });
}

/** What the platform passes to tools for a caller the proxy verified. */
export function signedIn(linearToken: string, scopes: string[] = [...LINEAR_SCOPES]): AuthInfo {
  return {
    token: '',
    clientId: 'client-1',
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    resource: new URL(PUBLIC_URL),
    extra: { [PROVIDER_TOKEN]: linearToken },
  };
}

export interface TestDeps extends Deps {
  logs: LogEntry[];
}

export function testDeps(overrides: Partial<Deps> = {}): TestDeps {
  const logs: LogEntry[] = [];
  const config = overrides.config ?? testConfig();
  const logger = memoryLogger(logs);
  return {
    config,
    logger,
    // No Linear client unless a test passes one: `callTool`, or `linearFactory`.
    linear: linearFactory(),
    oauth: testProxy({ config, logger }),
    ...overrides,
    logs,
  };
}

/** Hands out `client` for every Linear token, and records the tokens it was asked for. */
export function linearFactory(client?: unknown): LinearClientFactory & { tokens: string[] } {
  const tokens: string[] = [];
  const factory = (token: string) => {
    tokens.push(token);
    if (!client) throw new Error('This test gives the tools no Linear client');
    return client as LinearClient;
  };
  return Object.assign(factory, { tokens });
}

const open: Array<{ close(): Promise<void> }> = [];

/** Close `resource` in the next `cleanup()`. */
export function track<T extends { close(): Promise<void> }>(resource: T): T {
  open.push(resource);
  return resource;
}

/** Close every client, handler and app the test opened. Call from `afterEach`. */
export async function cleanup(): Promise<void> {
  // Last opened first: clients before the handlers serving them (docs/testing.md).
  for (const resource of open.splice(0).reverse()) await resource.close();
}

export interface ConnectOptions {
  deps?: Deps;
  /** The verified caller, as the bearer gate would pass it. Omit for an anonymous caller. */
  authInfo?: AuthInfo;
  era?: 'modern' | 'legacy';
  capabilities?: ClientCapabilities;
}

/**
 * An SDK client talking to `createServer` in process, through the same `createMcpHandler`
 * the app deploys, with no HTTP shell in between. This is how to test a tool.
 */
export async function connect(options: ConnectOptions = {}): Promise<Client> {
  const handler: McpHttpHandler = track(createMcpHandler(createServer(options.deps ?? testDeps())));

  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    {
      versionNegotiation: { mode: options.era === 'legacy' ? 'legacy' : 'auto' },
      ...(options.capabilities && { capabilities: options.capabilities }),
    },
  );
  const authInfo = options.authInfo;
  await client.connect(
    new StreamableHTTPClientTransport(new URL(PUBLIC_URL), {
      fetch: (url, init) =>
        handler.fetch(new Request(String(url), init), authInfo ? { authInfo } : undefined),
    }),
  );
  return track(client);
}

export interface TestAppOptions {
  deps?: Deps;
  /** Defaults to the fixture server, so platform tests don't depend on the samples. */
  server?: (deps: Deps) => McpServerFactory;
  routes?: (app: Hono, deps: Deps) => void;
}

/** The full app (Host/Origin guards, auth, CORS) as a fetch function, for HTTP-level tests. */
export function testApp(config: Config = testConfig(), options: TestAppOptions = {}): App {
  return track(
    createApp(config, {
      deps: options.deps ?? testDeps({ config }),
      server: options.server ?? fixtureServer,
      ...(options.routes && { routes: options.routes }),
    }),
  );
}

/** A raw JSON-RPC POST, with the headers a 2026-07-28 client sends. */
export function post(
  app: App,
  body: { method: string; [key: string]: unknown },
  headers: Record<string, string | null> = {},
): Promise<Response> {
  const merged = new Headers({
    Host: '127.0.0.1:3000',
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2026-07-28',
    'Mcp-Method': body.method,
  });
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) merged.delete(name);
    else merged.set(name, value);
  }
  return app.fetch(
    new Request(PUBLIC_URL, { method: 'POST', headers: merged, body: JSON.stringify(body) }),
  );
}

/** A 2026-07-28 request message: protocol metadata travels in `_meta` on every request. */
export function message(method: string, params: Record<string, unknown> = {}, id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  };
}

export function textOf(result: { content?: unknown }): string {
  const [first] = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return first?.type === 'text' ? (first.text ?? '') : '';
}

export interface CallToolOptions {
  /** The Linear client the tools get, usually a mock (tests/mocks/linear-client.ts). */
  linear?: unknown;
  deps?: Partial<Deps>;
  /** Defaults to a signed-in caller with a Linear token. `null` calls anonymously. */
  authInfo?: AuthInfo | null;
}

/**
 * Call one tool in process, through the SDK client and server, as a signed-in user whose
 * Linear client is `options.linear`. Returns the result the client receives.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  options: CallToolOptions = {},
): Promise<CallToolResult> {
  const deps = testDeps({ linear: linearFactory(options.linear), ...options.deps });
  const authInfo =
    options.authInfo === null ? undefined : (options.authInfo ?? signedIn('linear-token'));
  const client = await connect({ deps, ...(authInfo && { authInfo }) });
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}
