import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Linear on loopback, for the smoke tests: the OAuth token endpoint and the one GraphQL query
 * the smoke client makes (`list_teams`). It runs under Bun and Node. Requests for Linear reach
 * it through `toMock` (workerd) or the client factory's `apiUrl` (Bun), so nothing leaves the
 * machine.
 */
export const LINEAR_HOSTS = ['api.linear.app', 'linear.app'];
export const MOCK_TEAM = { id: 'team-smoke', key: 'SMK', name: 'Smoke' };

export interface MockLinear {
  origin: string;
  /** Grant types the token endpoint received, in order. */
  grants: string[];
  /** Hold the token endpoint's answers this long, to race concurrent callbacks. */
  tokenDelayMs: number;
  /** Answer the token endpoint with this status instead, once. */
  failNextToken: boolean;
  /** Hold GraphQL answers this long, to test quiet connections. */
  delayMs: number;
  /** GraphQL queries answered, so a run can prove they reached the mock. */
  queries: number;
  close(): Promise<void>;
}

export async function startMockLinear(clientId: string, clientSecret: string): Promise<MockLinear> {
  const mock: MockLinear = {
    origin: '',
    grants: [],
    tokenDelayMs: 0,
    failNextToken: false,
    delayMs: 0,
    queries: 0,
    close: async () => {},
  };
  const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url ?? '/', 'http://mock');
    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      const form = new URLSearchParams(await text(request));
      if (request.headers.authorization !== basic) return send(401, { error: 'invalid_client' });
      mock.grants.push(form.get('grant_type') ?? '');
      await new Promise((resolve) => setTimeout(resolve, mock.tokenDelayMs));
      if (mock.failNextToken) {
        mock.failNextToken = false;
        return send(400, { error: 'invalid_grant', error_description: 'mock provider secret' });
      }
      return send(200, {
        access_token: 'linear-access',
        refresh_token: 'linear-refresh',
        expires_in: 86_399,
        scope: 'read write',
        token_type: 'Bearer',
      });
    }
    if (request.method === 'POST' && url.pathname === '/graphql') {
      if (request.headers.authorization !== 'Bearer linear-access') {
        return send(401, { errors: [{ message: 'Authentication required' }] });
      }
      const { query } = JSON.parse(await text(request)) as { query: string };
      mock.queries += 1;
      await new Promise((resolve) => setTimeout(resolve, mock.delayMs));
      if (/\bteams\b/.test(query)) {
        return send(200, {
          data: {
            teams: {
              nodes: [MOCK_TEAM],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      return send(200, { errors: [{ message: 'not mocked' }] });
    }
    send(404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mock.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  mock.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return mock;
}

/** The same request, sent to the mock instead of Linear. Other hosts are refused. */
export async function toMock(request: Request, mock: MockLinear): Promise<Request> {
  const url = new URL(request.url);
  if (!LINEAR_HOSTS.includes(url.hostname)) {
    throw new Error(`The smoke test blocked a request to ${url.origin}`);
  }
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
  return new Request(`${mock.origin}${url.pathname}${url.search}`, {
    method: request.method,
    headers: request.headers,
    ...(body !== undefined && { body }),
  });
}

function text(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}
