import {
  hostHeaderValidationResponse,
  originValidationResponse,
} from '@modelcontextprotocol/server';
import type { UnifiedConfig } from '../shared/config/env.js';

const ALLOWED_CORS_HEADERS = new Set([
  'accept',
  'authorization',
  'baggage',
  'content-type',
  'mcp-method',
  'mcp-name',
  'mcp-protocol-version',
  'traceparent',
  'tracestate',
]);

function requestedCorsHeaders(request: Request): string[] {
  const value = request.headers.get('access-control-request-headers');
  if (!value) return [];
  return value
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
}

function appendVary(headers: Headers, value: string): void {
  const values = new Set(
    (headers.get('Vary') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  values.add(value);
  headers.set('Vary', [...values].join(', '));
}

export function requestSecurityResponse(
  request: Request,
  config: UnifiedConfig,
): Response | undefined {
  return (
    hostHeaderValidationResponse(request, config.MCP_ALLOWED_HOSTS) ??
    originValidationResponse(request, config.MCP_ALLOWED_ORIGIN_HOSTNAMES)
  );
}

export function corsPreflightResponse(request: Request): Response {
  const origin = request.headers.get('Origin');
  if (!origin) return new Response(null, { status: 204 });

  const method = request.headers.get('access-control-request-method');
  if (method && method.toUpperCase() !== 'POST') {
    return new Response('CORS method not allowed', { status: 405 });
  }

  const requestedHeaders = requestedCorsHeaders(request);
  const invalidHeader = requestedHeaders.find(
    (header) => !ALLOWED_CORS_HEADERS.has(header) && !header.startsWith('mcp-param-'),
  );
  if (invalidHeader) {
    return new Response(`CORS header not allowed: ${invalidHeader}`, {
      status: 400,
    });
  }

  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': requestedHeaders.join(', '),
    'Access-Control-Max-Age': '600',
  });
  appendVary(headers, 'Origin');
  appendVary(headers, 'Access-Control-Request-Headers');
  appendVary(headers, 'Access-Control-Request-Method');
  return new Response(null, { status: 204, headers });
}

/** Add CORS headers without buffering or disturbing SSE responses. */
export function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get('Origin');
  if (!origin) return response;

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate');
  appendVary(headers, 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
