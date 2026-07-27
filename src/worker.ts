import { preloadSchemas } from '@modelcontextprotocol/server';
import { initializeWorkerTokenStore } from './adapters/http-workers/index.js';
import { buildHttpApp, type HttpRuntime } from './http/app.js';
import { parseConfig } from './shared/config/env.js';

preloadSchemas();

export function createWorkerRuntime(env: Env): HttpRuntime | undefined {
  const config = parseConfig({ ...env });
  const tokenStore = initializeWorkerTokenStore(env, config);
  if (!tokenStore) return undefined;
  return buildHttpApp(config, {
    runtimeName: 'cloudflare-workers',
    tokenStore,
    mountOAuthRoutes: true,
  });
}

let runtime: HttpRuntime | undefined;

export default {
  fetch(request, env) {
    runtime ??= createWorkerRuntime(env);
    if (!runtime) {
      return Promise.resolve(
        new Response('Server misconfigured: TOKENS binding unavailable', {
          status: 503,
        }),
      );
    }
    return runtime.fetch(request);
  },
} satisfies ExportedHandler<Env>;
