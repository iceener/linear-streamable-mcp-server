# Linear MCP Server

This server is a remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [Linear](https://linear.app). A model can use it to find, read, create and update issues, comments and projects, and to read teams, users and cycles. The server runs on **Cloudflare Workers** and on **Bun**. It uses the [MCP server template](https://github.com/iceener/streamable-mcp-server-template) 2.1 and the official MCP TypeScript SDK 2.3.0.

The server URL is the deployed Worker's `MCP_PUBLIC_URL`, for example `https://linear-mcp.<subdomain>.workers.dev/mcp`.

The server uses protocol version `2026-07-28`. It also accepts clients that use the 2025 protocol versions.

<img src="docs/comparison-hd.gif" width="800" alt="The Linear MCP server in use" />

> [!WARNING]
> You connect this server to your MCP client at your own risk. A model can make mistakes. Examine what the tools do, and examine the changes in Linear. The write tools change issues, comments and projects in your workspace.

## Tools

| Tool | Function |
|---|---|
| `workspace_metadata` | Shows the IDs that other tools need: the viewer, teams, workflow states, labels, projects and favorites. Use it first. |
| `list_issues` | Finds issues with GraphQL-style filters, keywords, `assignedToMe`, a team or a project. The results are pages. |
| `get_issues` | Shows up to 50 issues in detail, by UUID or by identifier (`ENG-123`). |
| `create_issues` | Makes up to 50 issues. Accepts names for states, labels, assignees, projects and priorities. `dry_run` checks the input only. |
| `update_issues` | Changes up to 50 issues, and reports each change. It can archive and unarchive issues. |
| `list_teams` | Lists the teams. |
| `list_users` | Lists the users. |
| `list_comments` | Lists the comments on an issue. |
| `add_comments` | Adds up to 50 comments. |
| `update_comments` | Changes the text of up to 50 comments. It cannot delete comments. |
| `list_cycles` | Lists the cycles of a team that uses cycles. |
| `list_projects` | Finds projects with filters. The results are pages. |
| `create_projects` | Makes up to 50 projects. |
| `update_projects` | Changes up to 50 projects. |
| `show_issues_ui` | Opens the interactive issues dashboard, the resource `ui://linear/issues`, in hosts that show MCP UI resources. |

The server cannot delete issues, comments or projects. It can archive issues.

## Connect a client

Use the server URL and the Streamable HTTP transport. The client signs you in with Linear the first time.

| Client | Procedure |
|---|---|
| Claude | In **Settings → Connectors**, add a custom connector with the server URL. |
| Claude Code | Run `claude mcp add --transport http linear <server URL>`. |
| MCP Inspector | Run `bun run inspector`. Select **Streamable HTTP**. Enter the server URL. |

Alice and Wonderlands use the same URL.

## Authentication

The server is its own OAuth authorization server, in front of Linear's OAuth. MCP clients do not receive Linear tokens.

1. The client registers at `/register` and signs the user in at `/authorize`. The client must use PKCE S256.
2. The server sends the user to Linear. Linear asks for the scopes `read` and `write`.
3. Linear returns the user to the server's `/oauth/callback`. The server keeps the Linear tokens, encrypted.
4. The client gets a code, and exchanges the code at `/token` for an access token and a refresh token. These tokens are opaque and have meaning only for this server.
5. On each MCP request, the server finds the Linear token for the access token. If the Linear token expires in less than one minute and Linear issued a refresh token, the server refreshes it first. The tools use the Linear token. They do not see the client's token.

Every MCP request needs the scopes `read` and `write`. For the complete flow, the storage and the redirect rules, refer to [docs/oauth.md](docs/oauth.md).

## Configuration

The deployment settings are in `wrangler.production.jsonc` (Workers; gitignored, with `wrangler.production.example.jsonc` as its shape) or `.env` (Bun). `.env.example` describes all variables.

| Variable | Production value | Function |
|---|---|---|
| `MCP_PUBLIC_URL` | `https://linear-mcp.<subdomain>.workers.dev/mcp` | The public URL of the MCP endpoint. It is also the resource that tokens are issued for. |
| `MCP_ALLOWED_HOSTS` | `linear-mcp.<subdomain>.workers.dev` | The `Host` headers that the server accepts. |
| `MCP_ALLOWED_ORIGIN_HOSTNAMES` | The server host, `claude.ai`, `claude.com`, and the hosts of the operator's own browser clients | The browser origins that the server accepts. |
| `AUTH_MODE` | `oauth` | The server checks the tokens that it issued. |
| `OAUTH_ISSUER_URL`, `OAUTH_AUTHORIZATION_URL`, `OAUTH_TOKEN_URL`, `OAUTH_REGISTRATION_URL` | This server's origin, `/authorize`, `/token` and `/register` | The authorization server that clients use. The server does not start if they name another server. |
| `OAUTH_SCOPES` | `read write` | The scopes that every MCP request must have. |
| `PROXY_REDIRECT_ALLOWLIST` | Alice, Claude and Wonderlands callbacks | The client redirect URIs that the proxy accepts, in addition to native loopback URIs. |
| `MCP_MAX_REQUEST_BYTES` | `1048576` | The largest MCP request body. |
| `MCP_LEGACY_MODE` | `stateless` | The server also accepts 2025-era clients. |
| `LINEAR_MCP_INCLUDE_JSON_IN_CONTENT` | Not set (`false`) | If `true`, the tools also give the model each structured result as JSON text. |

Secrets:

| Secret | Function |
|---|---|
| `PROVIDER_CLIENT_ID` | The client ID of the server's Linear OAuth application. |
| `PROVIDER_CLIENT_SECRET` | The client secret of the server's Linear OAuth application. |
| `RS_TOKENS_ENC_KEY` | 32 random bytes, base64url. The key encrypts the stored tokens. Production does not start without it. If you change it, all users must sign in again. |

Linear's endpoints and scopes are constants in `src/services/linear-oauth.ts`. For the setup at Linear and at Cloudflare, refer to [docs/deploy.md](docs/deploy.md).

## Development

Requirements: [Bun](https://bun.sh) 1.4 or later, and Node.js 22.18 or later.

1. Install the dependencies:

   ```sh
   bun install
   ```

2. Copy `.env.example` to `.env`. Set `PROVIDER_CLIENT_ID`, `PROVIDER_CLIENT_SECRET` and `RS_TOKENS_ENC_KEY`. In the Linear OAuth application, add the callback URL `http://127.0.0.1:3000/oauth/callback`.
3. Start the server:

   ```sh
   bun run dev
   ```

   The server URL is `http://127.0.0.1:3000/mcp`. To use the Cloudflare local runtime, run `bun run dev:worker` (port 8787). Put its secrets in `.dev.vars`.

4. Before you commit, run the checks:

   ```sh
   bun run check
   bun run test:smoke
   ```

`bun run check` does the type check, the lint check and the tests. `bun run test:smoke` starts the real server on Bun and on workerd. It signs in through a Linear stand-in on loopback and calls the tools. No test uses the network. The tests against the real Linear API run only on request: `RUN_LINEAR_LIVE_TESTS=true LINEAR_TEST_TOKEN=… bun run test:live`. They make and delete issues in a team named "Tests".

| Script | Function |
|---|---|
| `bun run dev` | Starts the server on Bun. |
| `bun run dev:worker` | Starts the server in the Cloudflare local runtime. |
| `bun run check` | Type check, lint check, tests, and the check of the generated Worker types. |
| `bun run test:smoke` | Smoke tests on Bun and on workerd. |
| `bun run test:live` | Tests against the real Linear API (opt-in). |
| `bun run deploy` | Deploys with the gitignored `wrangler.production.jsonc` (`wrangler deploy --config wrangler.production.jsonc`). |
| `bun run types:worker` | Makes the Worker types again after a change to `wrangler.jsonc`. |

## Project structure

```
src/
  server.ts       Identity, instructions, Runtime, Deps, and the hooks that connect the OAuth proxy
  settings.ts     The Linear OAuth application, the encryption key, the redirect allowlist
  tools/          One file for each tool; shared/ has schemas, resolvers and helpers
  resources/      The issues dashboard (ui://linear/issues)
  services/       linear.ts: Linear clients; linear-oauth.ts: Linear as the OAuth provider
  oauth/          The OAuth proxy. It is the same for every provider (docs/oauth.md)
  platform/       Template code. Do not change it
  bun.ts          Entry point for Bun: file storage
  worker.ts       Entry point for Workers: KV and the NativeOAuthAuthority Durable Object
tests/            Tests for the tools, the proxy and the platform; fixtures from before 1.1.0
scripts/          Smoke tests and the Linear stand-in
docs/             The OAuth proxy, deployment, and the tool design rules (rules.md)
```

For the template's concepts (the request path, `defineTool`, the error policy, the configuration checks), refer to the [template documentation](https://github.com/iceener/streamable-mcp-server-template#documentation).

## License

[MIT](LICENSE)
