# Changelog

## 1.1.0 — 2026-10-05

The server now follows the [MCP server template](https://github.com/iceener/streamable-mcp-server-template) 2.1 and uses `@modelcontextprotocol/server` 2.3.0. The OAuth proxy, the stored tokens and the tool contract are the same as before. `tests/fixtures/` records the deployed code (commit `2f723fd`); `tests/contract.test.ts`, `tests/routes.test.ts` and `tests/oauth/storage.test.ts` compare the server with it.

### Changed for clients

- **Tools** have titles (`Discover IDs (Use First)`, `List Issues`, …). Names, order, input schemas, output schemas, annotations and descriptions are the same.
- **Server identity:** version `1.1.0`, and an icon at `/icon.svg`. The instructions are the same text.
- **Capabilities:** `listChanged` and `subscribe` are `false` in both protocol eras. They were `true` for 2026-07-28 clients, but the server never sent a list-changed or resource-updated notification.
- **List caching:** lists are cacheable by every caller (`cacheScope: public`, was `private`). They are the same for every caller. The UI resource stays `private`.
- **Scopes:** a token whose stored record has no scopes now counts as having `read write`, the scopes the proxy asks Linear for. Before, such a token got `403 insufficient_scope` on every request. This includes tokens that a refresh had left without scopes, because Linear's refresh answer named none. When Linear's answer names no scope, the stored scopes are kept. Linear's `scope` is read as separate scopes whether it is a list, a comma-separated string or a space-separated string.
- **Tool errors:** a Linear API failure still reaches the model as `Tool error: <Linear's message>`. Any other failure inside a tool (a bug) answers `The <tool> tool failed with an internal error (reference …)` and is logged; before, the model saw the exception message.
- **Tool input size:** arguments with more than 10,000 array elements and object members are refused before the tool runs. A full batch of 50 items is far below this.
- **CORS on the OAuth endpoints:** an allowed browser origin (`MCP_ALLOWED_ORIGIN_HOSTNAMES`) can send a preflight to `/register` and `/token` (`204`) and read their answers. Before, the preflight answered `404` and the answers had no CORS headers.
- **Discovery aliases** (`/.well-known/oauth-protected-resource`, `/mcp/.well-known/oauth-protected-resource`, `/mcp/.well-known/oauth-authorization-server`) add `Access-Control-Allow-Origin: *`, as the standard locations do. They are still behind the Origin check.
- **Authorization server metadata** adds `client_id_metadata_document_supported: false`. Its absence meant the same.
- **Unknown paths** answer `404 {"error":"not_found"}` as JSON, not as plain text. `/health` reports the name and version.
- **A Worker that is configured wrong** (including a missing `TOKENS` or `OAUTH_AUTHORITY` binding) answers `500 {"error":"server_misconfigured"}` to every request (was `503 {"error":"server_error"}`).

### Changed for operators

- **Bun token file:** records loaded after a restart stay for a week, even when the provider access token has expired, and are refreshed on use. Before, they were dropped, and users signed in again after a restart.
- `wrangler.jsonc` for development, and the gitignored `wrangler.production.jsonc` for production, with `wrangler.production.example.jsonc` as its committed shape. `bun run deploy` is `wrangler deploy --config wrangler.production.jsonc`. A deploy replaces the vars; it no longer keeps vars that are not in the file (`--keep-vars`).
- Compatibility date `2026-09-08`.
- Bun serves MCP and OAuth on one port. The separate OAuth listener on `PORT + 1` is gone.
- Bun keeps tokens in `RS_TOKENS_FILE`, default `.data/tokens.json` (before: in memory, unless `RS_TOKENS_FILE` was set). The authority files stay in `<RS_TOKENS_FILE>.oauth-authority/`.
- A Linear refresh that the verifier stored is used for the request at once. Before, the verifier read the record again.
- KV failures are logged with the kind of record only, never the key or KV's message. OAuth failures that clients see as `503 server_error` are logged.
- Linear clients are kept per Linear token in a bounded cache (500), not an unbounded one.
- Tests use `bun:test`. The live Linear API suite runs only with `bun run test:live` and `RUN_LINEAR_LIVE_TESTS=true LINEAR_TEST_TOKEN=…`.

### Environment variables

| Before | Now |
|---|---|
| `AUTH_ENABLED=true` (`AUTH_STRATEGY=oauth`) | `AUTH_MODE=oauth` |
| `AUTH_DISCOVERY_URL` | `OAUTH_ISSUER_URL` (same value) |
| — | `OAUTH_AUTHORIZATION_URL`, `OAUTH_TOKEN_URL`, `OAUTH_REGISTRATION_URL`: this server's `/authorize`, `/token`, `/register` |
| `OAUTH_AUTHORIZATION_URL`, `OAUTH_TOKEN_URL`, `PROVIDER_ACCOUNTS_URL` (Linear's) | Constants in `src/services/linear-oauth.ts` (same URLs) |
| `OAUTH_SCOPES` (asked of Linear) | Constant `LINEAR_SCOPES` (`read write`) |
| `OAUTH_REQUIRED_SCOPES` (`AUTH_REQUIRE_RS=true`) | `OAUTH_SCOPES` (same value, `read write`): the scopes every request needs |
| `OAUTH_REDIRECT_ALLOWLIST` | `PROXY_REDIRECT_ALLOWLIST` (same value) |
| `OAUTH_REDIRECT_URI` | Removed. Its production value is also in the allowlist. |
| `OAUTH_REDIRECT_ALLOW_ALL` | Removed. It was only a production guard; no redirect check read it. |
| `OAUTH_REVOCATION_URL`, `OAUTH_EXTRA_AUTH_PARAMS` | Removed. They were never read for Linear. |
| `OAUTH_PROXY_BASE_URL` | Removed. It was not deployed. The OAuth endpoints are on the origin of `MCP_PUBLIC_URL`. |
| `MCP_NAME`, `MCP_TITLE`, `MCP_VERSION`, `MCP_INSTRUCTIONS` | `serverInfo` and `instructions` in `src/server.ts` (same name, title and text) |
| `MCP_PROTOCOL_VERSION`, `AUTH_ALLOW_DIRECT_BEARER`, `AUTH_REQUIRE_RS`, `RPS_LIMIT` | Removed. They were never read. |
| `CONCURRENCY_LIMIT` | Constant `5` in `src/tools/shared/linear.ts`, the old default. Production never set it. |
| `LINEAR_ACCESS_TOKEN`, `PROVIDER_API_KEY`, `BEARER_TOKEN`, `API_KEY`, `API_KEY_HEADER`, `CUSTOM_HEADERS`, `AUTH_STRATEGY`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `PROVIDER_API_URL` | Removed with the direct API-key mode. Production used the OAuth proxy only. `BEARER_TOKEN` now belongs to the template's `AUTH_MODE=bearer`. |
| `TOKENS_ENC_KEY` (fallback for `RS_TOKENS_ENC_KEY`) | Removed. Only `RS_TOKENS_ENC_KEY` is read; it was the deployed secret. |

Unchanged: the secrets `PROVIDER_CLIENT_ID`, `PROVIDER_CLIENT_SECRET` and `RS_TOKENS_ENC_KEY`, and `MCP_PUBLIC_URL`, `MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGIN_HOSTNAMES`, `MCP_LEGACY_MODE`, `MCP_MAX_REQUEST_BYTES`, `LOG_LEVEL`, `NODE_ENV`, `HOST`, `PORT`, `RS_TOKENS_FILE`, `LINEAR_MCP_INCLUDE_JSON_IN_CONTENT`.

### Removed

- The direct API-key mode (a Linear token from the environment). Production ran the OAuth proxy with `AUTH_ALLOW_DIRECT_BEARER=false`.
- The `list_my_issues` tool code. It was never registered; `list_issues` with `assignedToMe` does the same.
- The old adapters, `core/runtime.ts`, and the hand-written HTTP, security, body, logger and configuration modules. The template's `src/platform/` replaces them.
- The KV transaction and code methods. The authority Durable Object replaced them in 1.0.0.
- Dead helpers (`services/http-client.ts`, `utils/pagination.ts`, `schemas/common.ts`, `schemas/inputs.ts`, unused formatting and validation functions).
- `docs/api-vs-mcp.md` (a generated comparison with the Linear API), `env.example`, `docs/MCP_SDK_COMPATIBILITY.md`, `docs/MCP_2026_DEPLOYMENT.md`, `docs/ALICE_NATIVE_OAUTH.md`, three screenshots that nothing referenced, and the contract snapshots in `tests/snapshots/`. The facts that still apply are in `docs/oauth.md` and `docs/deploy.md`.
- The `wrangler.production.jsonc` and `vitest.config.ts` files.

## 1.0.0

The deployed version before the template migration: MCP SDK 2.0.0, the native OAuth authority (`NativeOAuthAuthority`), and the Linear tools.
