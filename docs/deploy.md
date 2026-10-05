# Deploy

The production server is the Cloudflare Worker `linear-mcp`, on `workers.dev`. Its URL is `MCP_PUBLIC_URL`, for example `https://linear-mcp.<subdomain>.workers.dev/mcp`. For the template's general deployment notes, refer to the template's `docs/deploy.md`.

## Linear

The server uses one Linear OAuth application (Linear: **Settings → API → OAuth applications**).

- **Callback URL:** `/oauth/callback` on the origin of `MCP_PUBLIC_URL`. This URL is registered at Linear. Do not change the path or the host. For local development, also add `http://127.0.0.1:3000/oauth/callback` (Bun) or `http://127.0.0.1:8787/oauth/callback` (`wrangler dev`).
- **Scopes:** `read` and `write`. They are in `src/services/linear-oauth.ts`, and in `OAUTH_SCOPES` in `wrangler.production.jsonc`. The two lists must be the same; `tests/production.test.ts` checks this.
- **Client authentication:** HTTP Basic at `https://api.linear.app/oauth/token`, with the grant in a form body.

## Cloudflare

`wrangler.jsonc` is for `bun run dev:worker`. It works only on loopback.

`wrangler.production.jsonc` is the production Wrangler config: the Worker name, the account, the variables, the KV namespace and the Durable Object. It is gitignored, because it names the deployed Worker and its storage. `wrangler.production.example.jsonc` has the same shape with stand-in values. To deploy your own copy, copy the example to `wrangler.production.jsonc` and put in your values. `bun run deploy` runs `wrangler deploy --config wrangler.production.jsonc`.

Where the real file exists, `tests/production.test.ts` checks it: it must have the example's shape, serve what the example serves, and match a pinned SHA-256 digest. A deliberate change to the file needs the new digest in that test, in the same commit. Without the file, those tests are skipped.

The production config has these bindings. Do not change them:

| Binding | Value |
|---|---|
| KV namespace `TOKENS` | The namespace that holds the signed-in users' tokens. Its ID is in `wrangler.production.jsonc`. |
| Durable Object `OAUTH_AUTHORITY` | class `NativeOAuthAuthority` |
| Migrations | `v1-native-oauth-authority` (applied). Only add new tags after it. |

The production secrets:

| Secret | Value |
|---|---|
| `PROVIDER_CLIENT_ID` | The Linear OAuth application's client ID. |
| `PROVIDER_CLIENT_SECRET` | The Linear OAuth application's client secret. |
| `RS_TOKENS_ENC_KEY` | 32 random bytes, base64url. Do not change it: all stored tokens use it. The Worker does not start without it. |

To set a secret, run `bunx wrangler secret put NAME --config wrangler.production.jsonc`. To make a new key for a new deployment, run `openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'`.

## Deploy

1. Run the checks:

   ```sh
   bun run check
   bun run test:smoke
   ```

2. Examine the bindings without a deploy:

   ```sh
   CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false bunx wrangler deploy --dry-run --config wrangler.production.jsonc --outdir /tmp/linear-mcp-dryrun
   ```

   The list must show `env.TOKENS`, with the namespace ID from `wrangler.production.jsonc`, and `env.OAUTH_AUTHORITY (NativeOAuthAuthority)`.

3. Deploy:

   ```sh
   bun run deploy
   ```

   A deploy replaces all vars with the vars in `wrangler.production.jsonc`. Vars that are not in the file are removed. Secrets stay.

4. Examine the deployed server:

   ```sh
   ORIGIN=$(bun -e "console.log(new URL(Bun.JSONC.parse(await Bun.file('wrangler.production.jsonc').text()).vars.MCP_PUBLIC_URL).origin)")
   curl -s "$ORIGIN/.well-known/oauth-authorization-server"
   curl -s -o /dev/null -w '%{http_code}\n' -X POST "$ORIGIN/mcp"
   ```

   The first command shows the issuer, `$ORIGIN`. The second shows `401`.

5. Connect a client and call `workspace_metadata` or `list_teams`.

## Logs

The Worker writes JSON logs to Workers Logs. A tool error that the model sees as "internal error (reference …)" has its details in the logs under that reference. Linear API errors are shown to the model as `Tool error: <Linear's message>` and are not logged. OAuth failures that clients see as `503 server_error` are logged as `OAuth request failed`, with the path. A failed Linear refresh is logged as `Linear token refresh failed; using the current token`. A token store that can't be read is logged as `Could not check an access token`; the client gets `500`. KV write failures are logged as warnings that name the kind of record only.
