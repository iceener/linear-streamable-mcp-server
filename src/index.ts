import { buildHttpApp } from './http/app.js';
import { defaultOAuthProxyBaseUrl } from './http/auth.js';
import { buildAuthApp } from './http/auth-app.js';
import { parseConfig } from './shared/config/env.js';
import { FileTokenStore } from './shared/storage/file.js';
import { sharedLogger as logger } from './shared/utils/logger.js';

const config = parseConfig(process.env as Record<string, unknown>);
const tokenStore = new FileTokenStore(config.RS_TOKENS_FILE, config.RS_TOKENS_ENC_KEY);
const oauthProxyBaseUrl = defaultOAuthProxyBaseUrl(config, false);
const runtime = buildHttpApp(config, {
  runtimeName: 'bun',
  tokenStore,
  oauthProxyBaseUrl,
});
const server = Bun.serve({
  hostname: config.HOST,
  port: config.PORT,
  fetch: runtime.fetch,
});

const authServer = config.AUTH_ENABLED
  ? Bun.serve({
      hostname: config.HOST,
      port: config.PORT + 1,
      fetch: buildAuthApp(config, tokenStore, oauthProxyBaseUrl).fetch,
    })
  : undefined;

logger.info('server', {
  message: 'Linear MCP server started',
  url: config.MCP_PUBLIC_URL.href,
  protocol: '2026-07-28',
  legacyMode: config.MCP_LEGACY_MODE,
  authEnabled: config.AUTH_ENABLED,
  oauthUrl: authServer ? oauthProxyBaseUrl.href : undefined,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server', { message: 'Shutting down', signal });

  const stops = [server.stop(false), authServer?.stop(false)].filter(
    (value): value is Promise<void> => value !== undefined,
  );
  await runtime.close();
  tokenStore.flush();
  tokenStore.stopCleanup();
  await Promise.all(stops);
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
