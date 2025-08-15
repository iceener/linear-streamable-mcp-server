import { randomUUID } from 'node:crypto';
import type { HttpBindings } from '@hono/node-server';
import type { MiddlewareHandler } from 'hono';
import { config } from '../../config/env.ts';
import { getLinearTokensByRsToken } from '../../core/tokens.ts';
import { validateOrigin, validateProtocolVersion } from '../../utils/security.ts';

export function createMcpSecurityMiddleware(): MiddlewareHandler<{
  Bindings: HttpBindings;
}> {
  return async (c, next) => {
    try {
      validateOrigin(c.req.raw.headers);
      validateProtocolVersion(c.req.raw.headers);

      const challenge = () => {
        // Reuse incoming session if present, else mint one so clients can correlate OAuth
        const incomingSid = c.req.header('Mcp-Session-Id');
        const sid = incomingSid?.trim() ? incomingSid : randomUUID();

        // Point clients to RS discovery and include ?sid= to carry it through to AS
        const md = new URL('/.well-known/oauth-protected-resource', c.req.url);
        md.searchParams.set('sid', sid);

        c.header(
          'WWW-Authenticate',
          `Bearer realm="MCP", authorization_uri="${md.toString()}"`,
        );
        // Surface the session id even on 401 so clients can reuse it on next calls
        c.header('Mcp-Session-Id', sid);

        return c.json(
          {
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Unauthorized' },
            id: null,
          },
          401,
        );
      };

      if (config.AUTH_ENABLED) {
        // Challenge with WWW-Authenticate when missing Authorization, and bind a session id
        const auth = c.req.header('Authorization');
        if (!auth) {
          return challenge();
        }

        // In RS-only mode, a Bearer token must be one we minted; unmapped → challenge.
        if (config.AUTH_REQUIRE_RS) {
          const bearerMatch = auth.match(/^\s*Bearer\s+(.+)$/i);
          const rs = bearerMatch?.[1];
          if (rs) {
            const mapped = getLinearTokensByRsToken(rs);
            if (!mapped && !config.AUTH_ALLOW_LINEAR_BEARER) {
              return challenge();
            }
          }
        }
      }

      return next();
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
  };
}
