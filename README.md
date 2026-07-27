# Linear MCP Server

Streamable HTTP MCP server for Linear — manage issues, projects, teams, cycles, and comments.

Author: [overment](https://x.com/_overment)

> [!WARNING]
> You connect this server to your MCP client at your own responsibility. Language models can make mistakes, misinterpret instructions, or perform unintended actions. Review tool outputs, verify changes (e.g., with `list_issues`), and prefer small, incremental writes.
>
> Remote deployments must use HTTPS, strict Host/Origin allowlists, encrypted token storage, and production observability. The server validates opaque MCP Resource Server tokens against its stored mapping and never forwards an inbound MCP bearer token to Linear.

## Comparison

Below is a comparison between the official Linear MCP (top) and this MCP (bottom).

<img src="docs/comparison-hd.gif" width="800" />

## Notice

This repo works in two ways:
- As a fetch-native **Bun server** for local workflows
- As a fetch-native **Cloudflare Worker** for remote interactions

> [!IMPORTANT]
> This branch targets the `2026-07-28` protocol candidate with exact `@modelcontextprotocol/server@2.0.0-beta.5` and `@modelcontextprotocol/client@2.0.0-beta.5`. It is release-candidate validation, not a claim of final specification conformance.

Both runtimes create one MCP handler per process/isolate and a fresh `McpServer` for every request. Modern requests are sessionless; legacy `2025-11-25` clients use the SDK's stateless fallback.

For production Cloudflare deployments, see [Remote Model Context Protocol servers (MCP)](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp).

## Motivation

I'm a big fan of [Linear](https://linear.app) and use it daily. At the time of writing, the official MCP server isn't fully optimized for language models. This server is built with key goals in mind:

- Let LLMs find Team IDs, Project IDs, Status IDs, or User IDs in a **single action** (`workspace_metadata`) instead of multiple tool calls
- Include clear MCP instructions and schema descriptions that cut API jargon
- Map API responses into **human-readable feedback** — useful for both the LLM and user
- Provide hints and suggestions for next steps, plus tips on recovering from errors
- Support **batch actions** (e.g., `create_issues` instead of `create_issue`) so the LLM can perform multiple steps in one go
- Prefetch related values — return both a status ID and actual status name for an issue
- Hide tools not enabled in a given team's settings (like `list_cycles`) to reduce noise

In short, it's not a direct mirror of Linear's API — it's tailored so AI agents know exactly how to use it effectively.

## Features

- ✅ **Issues** — List, search, create, update (state, assignee, labels, priority, etc.)
- ✅ **Projects** — List, create, update projects
- ✅ **Teams & Users** — Discover workspace structure
- ✅ **Cycles** — Browse sprint/cycle planning
- ✅ **Comments** — List and add comments on issues
- ✅ **OAuth 2.1** — Secure PKCE flow with RS token mapping
- ✅ **Dual Runtime** — Bun or Cloudflare Workers
- ✅ **Production Ready** — Encrypted token storage, rate limiting, multi-user support

### Design Principles

- **LLM-friendly**: Tools are simplified and unified, not 1:1 API mirrors
- **Batch-first**: Create/update operations accept arrays to minimize tool calls
- **Discovery-first**: `workspace_metadata` returns all IDs needed for subsequent calls
- **Clear feedback**: Every response includes human-readable summaries with diffs

---

## Installation

Prerequisites: [Bun](https://bun.sh/), a [Linear](https://linear.app) account, and—when deploying remotely—a [Cloudflare](https://dash.cloudflare.com) account.

### Ways to Run (Pick One)

1. **Local (API key)** — Fastest start
2. **Local + OAuth** — For multi-user or token refresh
3. **Cloudflare Worker (wrangler dev)** — Local Worker testing
4. **Cloudflare Worker (deploy)** — Remote production

---

### 1. Local (API Key) — Quick Start

Run the server with your Linear Personal Access Token from [Settings → Security](https://linear.app/settings/account/security).

```bash
git clone <repo>
cd linear-mcp
bun install
cp env.example .env
```

Edit `.env`:

```env
PORT=3000
AUTH_ENABLED=false
AUTH_STRATEGY=none
LINEAR_ACCESS_TOKEN=lin_api_xxxx
```

```bash
bun run dev
# MCP: http://127.0.0.1:3000/mcp
```

Connect the MCP client to `http://localhost:3000/mcp` without forwarding the Linear token as an MCP bearer credential. `LINEAR_ACCESS_TOKEN` is deployment-scoped provider authorization; it is not MCP caller authentication.

---

### 2. Local + OAuth

More advanced — requires creating an OAuth application in Linear.

1. Create an OAuth app at [Linear Settings → API → OAuth Applications](https://linear.app/settings/api)
2. Set redirect URIs:
   ```
   http://127.0.0.1:3001/oauth/callback
   alice://oauth/callback
   ```
3. Copy Client ID and Secret

```bash
cp env.example .env
```

Edit `.env`:

```env
PORT=3000
AUTH_ENABLED=true

PROVIDER_CLIENT_ID=your_client_id
PROVIDER_CLIENT_SECRET=your_client_secret

OAUTH_SCOPES=read write
OAUTH_REDIRECT_URI=alice://oauth/callback
OAUTH_REDIRECT_ALLOWLIST=alice://oauth/callback,http://127.0.0.1:3001/oauth/callback
   ```

```bash
bun dev
# MCP: http://127.0.0.1:3000/mcp
# OAuth: http://127.0.0.1:3001
```

> **Tip:** The Authorization Server runs on PORT+1.

**Claude Desktop:**

```json
{
  "mcpServers": {
    "linear": {
      "command": "bunx",
      "args": ["mcp-remote", "http://localhost:3000/mcp", "--transport", "http-only"],
      "env": { "NO_PROXY": "127.0.0.1,localhost" }
    }
  }
}
```

#### RS-Only Mode (Recommended for Remote)

Enable these flags to require RS-minted bearer tokens:

```env
```

When enabled, requests without `Authorization` or with non-mapped tokens receive `401` with `WWW-Authenticate` so OAuth can start.

---

### 3. Cloudflare Worker (Local Dev)

```bash
bun run dev:worker
```

With OAuth, configure the Linear application credentials as Worker secrets:

```bash
bunx wrangler secret put PROVIDER_CLIENT_ID --config wrangler.jsonc
bunx wrangler secret put PROVIDER_CLIENT_SECRET --config wrangler.jsonc
bun run dev:worker
```

Endpoint: `http://127.0.0.1:8787/mcp`

---

### 4. Cloudflare Worker (Deploy)

1. Create KV namespace:

```bash
bunx wrangler kv namespace create TOKENS --config wrangler.jsonc
```

2. Configure the `TOKENS` binding in `wrangler.jsonc` (or let Wrangler provision it)

3. Set secrets:

```bash
bunx wrangler secret put PROVIDER_CLIENT_ID --config wrangler.jsonc
bunx wrangler secret put PROVIDER_CLIENT_SECRET --config wrangler.jsonc

# Generate encryption key (32-byte base64url):
openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
bunx wrangler secret put RS_TOKENS_ENC_KEY --config wrangler.jsonc
```

> **Note:** `RS_TOKENS_ENC_KEY` encrypts OAuth tokens stored in KV (AES-256-GCM).

4. Update the redirect URI and allowlist in `wrangler.jsonc`

5. Set `MCP_PUBLIC_URL`, Host/Origin allowlists, and the Worker callback URL in `wrangler.jsonc`; add the callback to the Linear OAuth app

6. Deploy:

```bash
bun run deploy
```

Endpoint: `https://<worker-name>.<account>.workers.dev/mcp`

---

## Client Configuration

**MCP Inspector (quick test):**

```bash
bunx @modelcontextprotocol/inspector
# Connect to: http://localhost:3000/mcp
```

**Claude Desktop / Cursor:**

```json
{
  "mcpServers": {
    "linear": {
      "command": "bunx",
      "args": ["mcp-remote", "http://127.0.0.1:3000/mcp", "--transport", "http-only"],
      "env": { "NO_PROXY": "127.0.0.1,localhost" }
    }
  }
}
```

For Cloudflare, replace URL with `https://<worker-name>.<account>.workers.dev/mcp`.

---

## Tools

### `workspace_metadata`

Discover workspace entities and IDs. **Call this first** when you don't know IDs.

```ts
// Input
{
  include?: ("profile"|"teams"|"workflow_states"|"labels"|"projects"|"favorites")[];
  teamIds?: string[];
  project_limit?: number;
  label_limit?: number;
}

// Output
{
  viewer: { id, name, email, displayName, timezone };
  teams: Array<{ id, key, name, cyclesEnabled, defaultIssueEstimate }>;
  workflowStatesByTeam: Record<teamId, Array<{ id, name, type }>>;
  labelsByTeam: Record<teamId, Array<{ id, name, color }>>;
  projects: Array<{ id, name, state, teamId, leadId, targetDate }>;
}
```

### `list_issues`

Search and filter issues with powerful GraphQL filtering.

```ts
// Input
{
  teamId?: string;
  projectId?: string;
  filter?: IssueFilter;        // GraphQL-style: { state: { type: { eq: "started" } } }
  q?: string;                  // Title search tokens
  keywords?: string[];         // Alternative to q
  includeArchived?: boolean;
  orderBy?: "updatedAt" | "createdAt";
  limit?: number;              // 1-100
  cursor?: string;             // Pagination
  fullDescriptions?: boolean;
}

// Output
{
  items: Array<{
    id, identifier, title, description?,
    stateId, stateName, projectId?, projectName?,
    assigneeId?, assigneeName?, labels[], dueDate?, url
  }>;
  cursor?: string;
  nextCursor?: string;
  limit: number;
}
```

### `create_issues`

Create multiple issues in one call.

```ts
{
  items: Array<{
    teamId: string;
    title: string;
    description?: string;
    stateId?: string;
    labelIds?: string[];
    assigneeId?: string;       // Defaults to current viewer
    projectId?: string;
    priority?: number;         // 0-4
    estimate?: number;
    dueDate?: string;          // YYYY-MM-DD
    parentId?: string;
  }>;
  parallel?: boolean;
}
```

### `update_issues`

Update issues in batch (state, labels, assignee, metadata).

```ts
{
  items: Array<{
    id: string;
    title?: string;
    description?: string;
    stateId?: string;
    labelIds?: string[];
    addLabelIds?: string[];     // Incremental add
    removeLabelIds?: string[];  // Incremental remove
    assigneeId?: string;
    projectId?: string;
    priority?: number;
    estimate?: number;
    dueDate?: string;
    archived?: boolean;
  }>;
  parallel?: boolean;
}
```

### Other Tools

- `get_issues` — Fetch issues by ID (batch)
- `list_projects` / `create_projects` / `update_projects` — Manage projects
- `list_teams` / `list_users` — Discover workspace structure
- `list_cycles` — Browse team cycles (if enabled)
- `list_comments` / `add_comments` — Issue comments

---

## Examples

### 1. List my issues due today

```json
// First, get viewer info
{ "name": "workspace_metadata", "arguments": { "include": ["profile"] } }

// Then list issues assigned to me
{
  "name": "list_issues",
  "arguments": {
    "assignedToMe": true,
    "filter": { "dueDate": { "eq": "2025-08-15" } },
    "orderBy": "updatedAt",
    "limit": 20
  }
}
```

**Response:**
```
Issues: 1 (limit 20). Preview:
- [OVE-142 — Publish release notes](https://linear.app/.../OVE-142) — state Done; due 2025-08-15
```

### 2. Create an issue and add it to a project

```json
// Discover IDs first
{ "name": "workspace_metadata", "arguments": { "include": ["teams", "projects"] } }

// Create (assigneeId defaults to current viewer)
{
  "name": "create_issues",
  "arguments": {
    "items": [{
      "title": "Release Alice v3.8",
      "teamId": "TEAM_ID",
      "projectId": "PROJECT_ID",
      "dueDate": "2025-08-18",
      "priority": 2
    }]
  }
}
```

**Response:**
```
Created issues: 1 / 1. OK: item[0].
Next: Use list_issues to verify details.
```

### 3. Batch update: reschedule + mark as Done

```json
// Resolve workflow states first
{ "name": "workspace_metadata", "arguments": { "include": ["workflow_states"], "teamIds": ["TEAM_ID"] } }

// Update both issues
{
  "name": "update_issues",
  "arguments": {
    "items": [
      { "id": "RELEASE_UUID", "dueDate": "2025-08-16" },
      { "id": "MEETING_UUID", "stateId": "DONE_STATE_ID" }
    ]
  }
}
```

**Response:**
```
Updated issues: 2 / 2. OK: RELEASE_UUID, MEETING_UUID
- [OVE-231 — Release Alice v3.8] Due date: 2025-08-18 → 2025-08-16
- [OVE-224 — Team meeting] State: Current → Done
```

---

## HTTP Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/mcp` | POST | MCP JSON-RPC 2.0 |
| `/mcp` | GET / DELETE | `405` (modern and stateless legacy HTTP do not expose session endpoints) |
| `/health` | GET | Health check |
| `/.well-known/oauth-authorization-server` | GET | OAuth AS metadata |
| `/.well-known/oauth-protected-resource` | GET | OAuth RS metadata |

OAuth (PORT+1):
- `GET /authorize` — Start OAuth flow
- `GET /oauth/callback` — Provider callback
- `POST /token` — Token exchange
- `POST /revoke` — Revoke tokens

---

## Development

```bash
bun run dev       # Start with hot reload
bun run typecheck # TypeScript check
bun run lint      # Lint code
bun run build     # Production build
bun start         # Run production
```

---

## Testing

The project uses a two-layer testing strategy:

### Unit Tests (Mock)

Fast tests using mocked Linear API responses. Tests all logic, validation, and edge cases without network calls.

```bash
bun run test          # Run unit, protocol, storage, and configured live tests
bun run test:watch    # Watch mode
bun run test:coverage # With coverage report
```

### Integration Tests (Live API)

Real API tests that verify the actual Linear connection works. Creates issues in a "Tests" team and cleans up after.

**Setup:**

1. Create a team named "Tests" in your Linear workspace
2. Add your Linear API key to `.env`:
   ```env
   PROVIDER_API_KEY=lin_api_xxxx
   ```

**Run:**

```bash
bun run test:integration  # ~45 seconds
```

**What it tests:**

| Category | Tests | Purpose |
|----------|-------|---------|
| CRUD | 5 | Create, Read, Update, List operations |
| Filtering | 3 | Priority, title search, workflow state filters |
| Pagination | 2 | Limit and cursor behavior |
| Errors | 3 | Non-existent issues, invalid filters |
| Rate Limiting | 2 | Rapid requests, batch operations |

### Testing Strategy

| Layer | Speed | Purpose |
|-------|-------|---------|
| **Unit/Mock** | ⚡️ Fast | Logic correctness, validation, edge cases |
| **Integration** | 🐢 Slow | API contract, real data mapping |
| **TypeScript** | 🛡️ Build | SDK type alignment |

Run unit tests on every change. Run integration tests before releases or after SDK upgrades.

### MCP v2 validation

`bun run test:protocol` uses the official beta.5 client in modern and legacy modes. It verifies the 15-tool snapshot and order, structured outputs, mocked GraphQL success/failure, the issues UI resource, cache hints, subscriptions, cancellation, transport security, OAuth metadata/errors, provider-token separation, and concurrent principal isolation.

The dated protocol is still a release candidate. Re-run the complete Bun and workerd matrix against final packages before claiming final conformance.

---

## Architecture

```
src/
├── shared/
│   ├── tools/
│   │   └── linear/         # Tool definitions (work in Bun + Workers)
│   │       ├── workspace-metadata.ts
│   │       ├── list-issues.ts
│   │       ├── create-issues.ts
│   │       ├── update-issues.ts
│   │       ├── projects.ts
│   │       ├── comments.ts
│   │       ├── cycles.ts
│   │       └── shared/     # Formatting, validation, snapshots
│   ├── oauth/              # OAuth flow (PKCE, discovery)
│   └── storage/            # Token storage (file, KV, memory)
├── services/
│   └── linear/
│       └── client.ts       # LinearClient wrapper with auth
├── schemas/
│   ├── inputs.ts           # Zod input schemas
│   └── outputs.ts          # Zod output schemas
├── config/
│   └── metadata.ts         # Server & tool descriptions
├── index.ts                # Bun entry
└── worker.ts               # Workers entry
```

---

## Credential and rollback model

The MCP access token, Linear access token, and Linear refresh token are separate credentials. The opaque MCP verifier places only `linearProviderAccessToken` in `AuthInfo.extra`; tools never read or forward `authInfo.token`, and refresh tokens remain in file/KV storage.

The migration does not change OAuth record shapes or KV key names. File records remain `{ version: 1, encrypted, records }`, and KV mappings remain under `rs:access:*` and `rs:refresh:*`. Rolling back to the recorded pre-v2 SHA can read records written by this candidate, and this candidate can read pre-v2 records. No destructive storage migration is required.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Workspace does not exist" | Verify your OAuth app is in the correct Linear workspace. Check PROVIDER_CLIENT_ID. |
| "Unauthorized" | Complete OAuth flow. Tokens may have expired. |
| "State not found" | Use `workspace_metadata` to get valid stateIds for the team. |
| "Rate limited" | Linear has strict rate limits. Wait and retry. |
| OAuth doesn't start (Worker) | `curl -i -X POST https://<worker>/mcp` should return `401` with `WWW-Authenticate`. |
| Tools empty in Claude | Ensure Worker returns JSON Schema for `tools/list`; use `mcp-remote`. |

---

## License

MIT
