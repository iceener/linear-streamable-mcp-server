# Linear MCP Server

Streamable HTTP MCP server for Linear — manage issues, projects, teams, cycles, and comments.

Author: [overment](https://x.com/_overment)

> [!WARNING]
> You connect this server to your MCP client at your own responsibility. Language models can make mistakes, misinterpret instructions, or perform unintended actions. Review tool outputs, verify changes (e.g., with `list_issues`), and prefer small, incremental writes.
>
> The HTTP/OAuth layer is designed for convenience during development, not production-grade security. If deploying remotely, harden it: proper token validation, secure storage, TLS termination, strict CORS/origin checks, rate limiting, audit logging, and compliance with Linear's terms.

## Comparison

Below is a comparison between the official Linear MCP (top) and this MCP (bottom).

<img src="docs/comparison-hd.gif" width="800" />

## Notice

This repo works in two ways:
- As a **Node/Hono server** for local workflows
- As a **Cloudflare Worker** for remote interactions

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
- ✅ **Dual Runtime** — Node.js/Bun or Cloudflare Workers
- ✅ **Production Ready** — Encrypted token storage, rate limiting, multi-user support

### Design Principles

- **LLM-friendly**: Tools are simplified and unified, not 1:1 API mirrors
- **Batch-first**: Create/update operations accept arrays to minimize tool calls
- **Discovery-first**: `workspace_metadata` returns all IDs needed for subsequent calls
- **Clear feedback**: Every response includes human-readable summaries with diffs

---

## Installation

Prerequisites: [Bun](https://bun.sh/), [Node.js 24+](https://nodejs.org), [Linear](https://linear.app) account. For remote: a [Cloudflare](https://dash.cloudflare.com) account.

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
AUTH_STRATEGY=bearer
BEARER_TOKEN=lin_api_xxxx  # Your Linear API key
```

```bash
bun dev
# MCP: http://127.0.0.1:3000/mcp
```

Connect to your MCP client:

**Claude Desktop / Cursor:**

```json
{
  "mcpServers": {
    "linear": {
      "command": "bunx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp",
        "--header",
        "Authorization: Bearer ${LINEAR_API_KEY}"
      ]
    }
  }
}
```

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
AUTH_REQUIRE_RS=true
AUTH_ALLOW_DIRECT_BEARER=false
```

When enabled, requests without `Authorization` or with non-mapped tokens receive `401` with `WWW-Authenticate` so OAuth can start.

---

### 3. Cloudflare Worker (Local Dev)

```bash
bun x wrangler dev --local | cat
```

With OAuth:

```bash
bun x wrangler secret put PROVIDER_CLIENT_ID
bun x wrangler secret put PROVIDER_CLIENT_SECRET
bun x wrangler dev --local | cat
```

Endpoint: `http://127.0.0.1:8787/mcp`

---

### 4. Cloudflare Worker (Deploy)

1. Create KV namespace:

```bash
bun x wrangler kv:namespace create TOKENS
```

2. Update `wrangler.toml` with KV namespace ID

3. Set secrets:

```bash
bun x wrangler secret put PROVIDER_CLIENT_ID
bun x wrangler secret put PROVIDER_CLIENT_SECRET

# Generate encryption key (32-byte base64url):
openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
bun x wrangler secret put RS_TOKENS_ENC_KEY
```

> **Note:** `RS_TOKENS_ENC_KEY` encrypts OAuth tokens stored in KV (AES-256-GCM).

4. Update redirect URI and allowlist in `wrangler.toml`

5. Add Workers URL to your Linear OAuth app's redirect URIs

6. Deploy:

```bash
bun x wrangler deploy
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
  orderBy?: "updatedAt" | "createdAt" | "priority";
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

- `list_my_issues` — Issues assigned to current user
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

// Then list issues
{
  "name": "list_my_issues",
  "arguments": {
    "filter": { "dueDate": { "eq": "2025-08-15" } },
    "orderBy": "updatedAt",
    "limit": 20
  }
}
```

**Response:**
```
My issues: 1 (limit 20). Preview:
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
| `/mcp` | GET | SSE stream (Node.js only) |
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
bun dev           # Start with hot reload
bun run typecheck # TypeScript check
bun run lint      # Lint code
bun run build     # Production build
bun start         # Run production
```

---

## Architecture

```
src/
├── shared/
│   ├── tools/
│   │   └── linear/         # Tool definitions (work in Node + Workers)
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
├── index.ts                # Node.js entry
└── worker.ts               # Workers entry
```

---

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
