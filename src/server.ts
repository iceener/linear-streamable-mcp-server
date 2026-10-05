/**
 * The project's half of the template. `platform/` relies on exactly these exports:
 * `serverInfo`, `SERVER_ICON_PATH`, `SERVER_ICON_SVG`, `Runtime`, `Deps`, `createDeps`,
 * `createServer`, `createVerifier`, `oauthMetadata` and `routes`. Change what they contain,
 * but keep their names and shapes.
 */
import {
  type CacheHint,
  McpServer,
  type McpServerFactory,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import type { Hono } from 'hono';
import type { OAuthAuthority } from './oauth/authority';
import { createOAuthProxy, type OAuthProxy } from './oauth/proxy';
import type { TokenStore } from './oauth/token-store';
import { type Config, ConfigError, type OAuthConfig } from './platform/config';
import type { Logger } from './platform/logger';
import { prompts } from './prompts';
import { resources } from './resources';
import { createLinearClientFactory, type LinearClientFactory } from './services/linear';
import { linearOAuth } from './services/linear-oauth';
import { tools } from './tools';

/** Who this server is. */
export const serverInfo = {
  name: 'linear-mcp',
  title: 'Linear',
  version: '1.1.0',
  description: 'Linear issue and project management for MCP clients.',
};

/** Sent to clients on connect. Many hosts add it to the model's system prompt. */
const instructions = `Use these tools to list and manage Linear issues, projects, teams, and users.

Quick start
- Call 'workspace_metadata' first to fetch canonical identifiers you will reuse across tools. It will include your viewer id: use that as 'assigneeId' when you want to assign items to yourself.
- Then use 'list_issues' with teamId/projectId and filters (or q/keywords) to locate targets. Use 'list_issues' for both discovery and precise lookups (including by id/identifier) — prefer orderBy='updatedAt'.
- To modify, use 'update_issues' / 'update_projects', then verify with 'list_issues'.
- For teams with cycles enabled, use 'list_cycles' to browse planning cycles.

Default recency window
- If a date range is not provided when listing issues, default to the current week in the viewer's timezone (Mon 00:00 → Sun 23:59:59.999), using updatedAt for recency. Mention the timezone surfaced by the client in your reasoning and outputs.

Account identifiers (returned by 'workspace_metadata')
- viewer: { id, name, email, displayName, avatarUrl, timezone, createdAt }
- teams: Array<{ id, key, name, description?, defaultIssueEstimate? }>
- workflowStatesByTeam: Record<teamId, Array<{ id, name, type }>>
- labelsByTeam: Record<teamId, Array<{ id, name, color?, description? }>>
- projects: Array<{ id, name, state, teamId?, leadId?, targetDate?, createdAt }>

How to chain safely
- teamId: filter in 'list_issues'; pass to 'create_issues'; use workflowStatesByTeam[teamId] to find stateId for 'update_issues'.
- projectId: filter in 'list_issues'; pass to create/update issue payloads.
- stateId: set via 'update_issues'. Resolve by name → id using workflowStatesByTeam.
- labelIds: pass to create/update; resolve from labelsByTeam.

Handling assignees and failures
- To assign to yourself, prefer using your viewer id from 'workspace_metadata' as 'assigneeId'.
- If a create or update fails with 'assigneeId ... could not be found', either:
  - Re-run 'workspace_metadata' and verify the correct team/project and user id, or
  - Use 'list_users' to fetch users and pick the right id.

Filtering (list_issues)
  - 'filter' supports GraphQL-style comparators and relationship fields. Comparators: { eq, neq, lt, lte, gt, gte, in, nin, containsIgnoreCase, startsWith, endsWith, null }. Common examples:
  - Team/project: { team: { id: { eq: teamId } } } or { project: { id: { eq: projectId } } }
  - State type: { state: { type: { eq: "started" } } }
  - Assignee email: { assignee: { email: { eqIgnoreCase: "name@acme.com" } } }
  - Title case-insensitive contains: { title: { containsIgnoreCase: "search" } }
  - Labels (use names from your workspace): { labels: { name: { in: ["LabelA", "LabelB"] } } }
- Or use q/keywords for keyword search (default matchMode='all' requires ALL tokens; use 'any' for broad search).
- Use workspace_metadata first to discover team/project/label/user names and IDs.

Pagination
- List tools return { cursor, nextCursor, limit }. Pass nextCursor to fetch the next page.
- Prefer small limits and refine filters instead of broad scans.

Safety & writes
- Do not guess ids. Always take ids from 'workspace_metadata' or a read tool.
- Batch writes default to sequential; keep batches small and verify with 'list_issues'.
- 'update_issues' ignores empty strings (e.g., dueDate: ""): only valid fields are sent.
`;

export const SERVER_ICON_PATH = '/icon.svg';
export const SERVER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Linear MCP server">
  <rect width="64" height="64" rx="12" fill="#111827"/>
  <path d="M16 36l12 12M16 28l20 20M18 20l26 26M26 16l22 22M36 16l12 12" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
</svg>`;

/**
 * Where the OAuth proxy keeps its state, handed in by the entry points: Workers KV and the
 * `NativeOAuthAuthority` Durable Object from `src/worker.ts`, files from `src/bun.ts`.
 */
export interface Runtime {
  tokens: TokenStore;
  authority: OAuthAuthority;
}

/** Everything tools, resources and prompts may use. Built once, shared by every request. */
export interface Deps {
  config: Config;
  logger: Logger;
  /** A Linear client acting with one user's Linear access token. */
  linear: LinearClientFactory;
  /** This server as the OAuth authorization server, in front of Linear (docs/oauth.md). */
  oauth: OAuthProxy;
}

export function createDeps(config: Config, logger: Logger, runtime: Runtime): Deps {
  const { settings } = config;
  if (!settings.RS_TOKENS_ENC_KEY && config.environment === 'production') {
    // Stored records hold Linear tokens; production never writes them unencrypted.
    throw new ConfigError(['RS_TOKENS_ENC_KEY is required in production']);
  }
  return {
    config,
    logger,
    linear: createLinearClientFactory(),
    oauth: createOAuthProxy({
      config,
      logger,
      provider: linearOAuth,
      credentials: {
        clientId: settings.PROVIDER_CLIENT_ID,
        clientSecret: settings.PROVIDER_CLIENT_SECRET,
      },
      redirectAllowlist: settings.PROXY_REDIRECT_ALLOWLIST,
      encryptionKey: settings.RS_TOKENS_ENC_KEY,
      // Linear's records have never carried a client binding, and refresh never asked for
      // one. New records keep that layout and that behavior (docs/oauth.md).
      bindGrants: false,
      tokens: runtime.tokens,
      authority: runtime.authority,
    }),
  };
}

/**
 * How bearer tokens are checked when `AUTH_MODE=oauth`: they are the opaque tokens the proxy
 * issued. The verifier looks them up, refreshes the Linear token when it is about to expire,
 * and puts it in `authInfo.extra` for the tools.
 */
export function createVerifier(_oauth: OAuthConfig, deps: Deps): OAuthTokenVerifier {
  return deps.oauth.verifier;
}

/**
 * The authorization server metadata (RFC 8414) published at
 * /.well-known/oauth-authorization-server: this server's own endpoints.
 */
export function oauthMetadata(oauth: OAuthConfig, deps: Deps): OAuthMetadata {
  return deps.oauth.metadata(oauth);
}

/** The proxy's endpoints and Linear's callback, behind the platform's Host and Origin checks. */
export function routes(app: Hono, deps: Deps): void {
  if (deps.config.auth.mode === 'oauth') deps.oauth.mount(app, deps.config.auth, serverInfo.title);
}

/** Lists only change on deploy, and are the same for every caller. */
const LIST_CACHE: CacheHint = { ttlMs: 60_000, cacheScope: 'public' };

/**
 * The SDK calls this factory once per HTTP request and serves that request with the fresh
 * `McpServer` it returns. Keep it cheap and free of I/O: shared clients live in `deps`.
 */
export function createServer(deps: Deps): McpServerFactory {
  const icons = [
    {
      src: new URL(SERVER_ICON_PATH, deps.config.publicUrl).href,
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    },
  ];

  return () => {
    const server = new McpServer(
      { ...serverInfo, icons },
      {
        instructions,
        // Lists change only on deploy, and each request has its own server instance, so there
        // is nothing to notify about. Prompts stay advertised, with an empty list, as before.
        capabilities: {
          tools: { listChanged: false },
          prompts: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
        },
        cacheHints: {
          'server/discover': LIST_CACHE,
          'tools/list': LIST_CACHE,
          'prompts/list': LIST_CACHE,
          'resources/list': LIST_CACHE,
          'resources/templates/list': LIST_CACHE,
        },
        // Reject tool arguments with more array elements and object members than this, before
        // schema validation runs. create_issues and update_issues take 50 items of about 20
        // fields each, plus label lists, so the template's 1,000 would refuse a full batch.
        maxToolInputElements: 10_000,
      },
    );

    for (const primitive of [...tools, ...resources, ...prompts]) {
      primitive.register(server, deps);
    }
    return server;
  };
}
