// Test-only child process for cold-start.test.ts: each run builds the real Bun runtime anew
// (token file and authority files, as src/bun.ts does), answers one request, and exits.
import { join } from 'node:path';
import { FileOAuthAuthority } from '../../src/oauth/authority-file';
import { FileTokenStore } from '../../src/oauth/token-store-file';
import { createApp } from '../../src/platform/app';
import { parseConfig } from '../../src/platform/config';
import { createLogger } from '../../src/platform/logger';

const input = JSON.parse(await Bun.stdin.text()) as {
  directory: string;
  key: string;
  path: string;
  body?: Record<string, unknown>;
};
const origin = 'https://linear-mcp.example';
const config = parseConfig({
  NODE_ENV: 'production',
  LOG_LEVEL: 'error',
  MCP_PUBLIC_URL: `${origin}/mcp`,
  AUTH_MODE: 'oauth',
  OAUTH_ISSUER_URL: origin,
  OAUTH_AUTHORIZATION_URL: `${origin}/authorize`,
  OAUTH_TOKEN_URL: `${origin}/token`,
  OAUTH_REGISTRATION_URL: `${origin}/register`,
  OAUTH_SCOPES: 'read write',
  PROVIDER_CLIENT_ID: 'provider-client',
  PROVIDER_CLIENT_SECRET: 'provider-secret',
  RS_TOKENS_ENC_KEY: input.key,
  RS_TOKENS_FILE: join(input.directory, 'tokens.json'),
});
globalThis.fetch = Object.assign(
  async (url: string | URL | Request, init?: RequestInit) => {
    if (
      String(url) !== 'https://api.linear.app/oauth/token' ||
      new Headers(init?.headers).get('authorization') !==
        `Basic ${btoa('provider-client:provider-secret')}` ||
      new URLSearchParams(String(init?.body)).get('redirect_uri') !== `${origin}/oauth/callback`
    ) {
      throw new Error('Unexpected outbound request');
    }
    return Response.json({
      access_token: 'cold-linear-access',
      refresh_token: 'cold-linear-refresh',
      expires_in: 3600,
      scope: 'read write',
    });
  },
  { preconnect: globalThis.fetch.preconnect },
);
const logger = createLogger(config.logLevel);
const tokens = new FileTokenStore(
  config.settings.RS_TOKENS_FILE,
  config.settings.RS_TOKENS_ENC_KEY,
  logger,
);
const authority = new FileOAuthAuthority(`${config.settings.RS_TOKENS_FILE}.oauth-authority`);
await authority.cleanupExpired();
const app = createApp(config, { runtime: { tokens, authority } });
try {
  const response = await app.fetch(
    new Request(`${origin}${input.path}`, {
      method: input.body ? 'POST' : 'GET',
      headers: { Host: 'linear-mcp.example', 'Content-Type': 'application/json' },
      ...(input.body && { body: JSON.stringify(input.body) }),
    }),
  );
  tokens.flush();
  process.stdout.write(
    JSON.stringify({
      status: response.status,
      location: response.headers.get('location'),
      body: await response.text(),
    }),
  );
} finally {
  await app.close();
}
