import { randomUUID } from 'node:crypto';
import type { HttpBindings } from '@hono/node-server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { toFetchResponse, toReqRes } from 'fetch-to-node';
import { Hono } from 'hono';
import { runWithRequestContext } from '../../core/context.ts';
import { logger } from '../../utils/logger.ts';

export function buildMcpRoutes(params: {
  server: McpServer;
  transports: Map<string, StreamableHTTPServerTransport>;
}) {
  const { server, transports } = params;
  const app = new Hono<{ Bindings: HttpBindings }>();

  const MCP_SESSION_HEADER = 'Mcp-Session-Id';

  app.post('/', async (c) => {
    const { req, res } = toReqRes(c.req.raw);

    try {
      const sessionIdHeader = c.req.header(MCP_SESSION_HEADER) ?? undefined;
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        body = undefined;
      }

      // Handle clients that probe unsupported namespaces: return empty lists
      if (
        body &&
        typeof body === 'object' &&
        (body as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
        typeof (body as { method?: unknown }).method === 'string' &&
        (body as { id?: unknown }).id !== undefined
      ) {
        const rpc = body as { id: string | number; method: string };
        if (rpc.method === 'resources/list') {
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: { resources: [] },
            }),
          );
          return toFetchResponse(res);
        }
        if (rpc.method === 'prompts/list') {
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: { prompts: [] },
            }),
          );
          return toFetchResponse(res);
        }
      }

      const isInitialize = Boolean(
        body && (body as { method?: string }).method === 'initialize',
      );

      let transport = sessionIdHeader ? transports.get(sessionIdHeader) : undefined;
      let didCreate = false;
      if (!transport) {
        const created = new StreamableHTTPServerTransport({
          sessionIdGenerator: isInitialize
            ? () => sessionIdHeader || randomUUID()
            : undefined,
          onsessioninitialized: isInitialize
            ? (sid: string) => {
                transports.set(sid, created);
                res.setHeader(MCP_SESSION_HEADER, sid);
              }
            : undefined,
        });
        transport = created;
        didCreate = true;
      }

      transport.onerror = (error) => {
        void logger.error('transport', {
          message: 'Transport error',
          error: (error as Error).message,
        });
      };

      if (didCreate) {
        await server.connect(transport);
      }

      // establish per-request context carrying session and auth headers
      const ctxHeaders: Record<string, string> | undefined = (
        c as unknown as {
          authHeaders?: Record<string, string>;
        }
      ).authHeaders;

      await runWithRequestContext(
        {
          sessionId: sessionIdHeader,
          authHeaders: ctxHeaders,
          abortSignal: (c.req.raw as unknown as { signal?: AbortSignal }).signal,
        },
        async () => {
          await transport?.handleRequest(req, res, body);
        },
      );

      res.on('close', () => {});
      return toFetchResponse(res);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('MCP POST /mcp error:', (error as Error).message);
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        },
        500,
      );
    }
  });

  app.get('/', async (c) => {
    const { req, res } = toReqRes(c.req.raw);
    const sessionIdHeader = c.req.header(MCP_SESSION_HEADER);
    if (!sessionIdHeader) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed - no session' },
          id: null,
        },
        405,
      );
    }
    try {
      const transport = transports.get(sessionIdHeader);
      if (!transport) {
        return c.text('Invalid session', 404);
      }
      const ctxHeaders: Record<string, string> | undefined = (
        c as unknown as {
          authHeaders?: Record<string, string>;
        }
      ).authHeaders;

      await runWithRequestContext(
        {
          sessionId: sessionIdHeader,
          authHeaders: ctxHeaders,
          abortSignal: (c.req.raw as unknown as { signal?: AbortSignal }).signal,
        },
        async () => {
          await transport.handleRequest(req, res);
        },
      );
      return toFetchResponse(res);
    } catch (_error) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        },
        500,
      );
    }
  });

  app.delete('/', async (c) => {
    const { req, res } = toReqRes(c.req.raw);
    const sessionIdHeader = c.req.header(MCP_SESSION_HEADER);
    if (!sessionIdHeader) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed - no session' },
          id: null,
        },
        405,
      );
    }
    try {
      const transport = transports.get(sessionIdHeader);
      if (!transport) {
        return c.text('Invalid session', 404);
      }
      const ctxHeaders: Record<string, string> | undefined = (
        c as unknown as {
          authHeaders?: Record<string, string>;
        }
      ).authHeaders;

      await runWithRequestContext(
        {
          sessionId: sessionIdHeader,
          authHeaders: ctxHeaders,
          abortSignal: (c.req.raw as unknown as { signal?: AbortSignal }).signal,
        },
        async () => {
          await transport.handleRequest(req, res);
        },
      );
      transports.delete(sessionIdHeader);
      transport.close();
      return toFetchResponse(res);
    } catch (_error) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        },
        500,
      );
    }
  });

  return app;
}
