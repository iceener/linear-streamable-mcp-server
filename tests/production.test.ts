import { expect, test } from 'bun:test';
import { MemoryOAuthAuthority } from '../src/oauth/authority';
import { MemoryTokenStore } from '../src/oauth/token-store';
import { ConfigError, parseConfig } from '../src/platform/config';
import { createDeps } from '../src/server';
import { LINEAR_SCOPES } from '../src/services/linear-oauth';
import { Settings } from '../src/settings';
import { memoryLogger } from './helpers';
import {
  DEVELOPMENT,
  describePrivate,
  digestOf,
  EXAMPLE,
  PRIVATE,
  PRODUCTION_VARS,
  servedAs,
  shapeOf,
  type WranglerConfig,
} from './production-config';

/** The deployed Worker's secrets. Renaming one signs every user out or breaks sign-in. */
const DEPLOYED_SECRETS = ['PROVIDER_CLIENT_ID', 'PROVIDER_CLIENT_SECRET', 'RS_TOKENS_ENC_KEY'];

/** The stand-in production vars, from wrangler.production.example.jsonc. */
function productionVars(): Record<string, string> {
  return { ...PRODUCTION_VARS };
}

test('the production vars, with the deployed secrets, are a valid configuration', () => {
  const config = parseConfig({
    ...productionVars(),
    PROVIDER_CLIENT_ID: 'id',
    PROVIDER_CLIENT_SECRET: 'secret',
    RS_TOKENS_ENC_KEY: Buffer.alloc(32).toString('base64url'),
  });
  expect(config.environment).toBe('production');
  expect(config.auth.mode).toBe('oauth');
  expect(config.publicUrl.href).toBe('https://linear-mcp.example.workers.dev/mcp');
});

test('every deployed secret is declared in src/settings.ts', () => {
  expect(Object.keys(Settings.shape)).toEqual(expect.arrayContaining(DEPLOYED_SECRETS));
});

test('tokens need exactly the scopes Linear is asked for: read and write', () => {
  // OAUTH_SCOPES is what every MCP request must carry (before: OAUTH_REQUIRED_SCOPES); the
  // proxy asks Linear for LINEAR_SCOPES. If they drifted apart, new tokens would get 403.
  expect(productionVars().OAUTH_SCOPES?.split(' ')).toEqual([...LINEAR_SCOPES]);
  expect([...LINEAR_SCOPES]).toEqual(['read', 'write']);
});

test('the Linear client ID and secret are set together', () => {
  expect(() => parseConfig({ PROVIDER_CLIENT_ID: 'id' })).toThrow(ConfigError);
  expect(() =>
    parseConfig({ PROVIDER_CLIENT_ID: 'id', PROVIDER_CLIENT_SECRET: 's' }),
  ).not.toThrow();
});

test('the redirect allowlist is a trimmed, de-duplicated list', () => {
  const config = parseConfig({
    PROXY_REDIRECT_ALLOWLIST: ' alice://oauth/callback, https://a.example/,alice://oauth/callback',
  });
  expect(config.settings.PROXY_REDIRECT_ALLOWLIST).toEqual([
    'alice://oauth/callback',
    'https://a.example/',
  ]);
});

test('production refuses to start without RS_TOKENS_ENC_KEY, as before', () => {
  const config = parseConfig({
    ...productionVars(),
    PROVIDER_CLIENT_ID: 'id',
    PROVIDER_CLIENT_SECRET: 'secret',
  });
  const runtime = { tokens: new MemoryTokenStore(), authority: new MemoryOAuthAuthority() };
  expect(() => createDeps(config, memoryLogger(), runtime)).toThrow(ConfigError);
  expect(() =>
    createDeps(
      parseConfig({
        ...productionVars(),
        RS_TOKENS_ENC_KEY: Buffer.alloc(32).toString('base64url'),
      }),
      memoryLogger(),
      runtime,
    ),
  ).not.toThrow();
});

test('LINEAR_MCP_INCLUDE_JSON_IN_CONTENT is a boolean flag, off by default', () => {
  expect(parseConfig({}).settings.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT).toBe(false);
  for (const value of ['true', '1', 'YES', 'on'])
    expect(
      parseConfig({ LINEAR_MCP_INCLUDE_JSON_IN_CONTENT: value }).settings
        .LINEAR_MCP_INCLUDE_JSON_IN_CONTENT,
    ).toBe(true);
  expect(() => parseConfig({ LINEAR_MCP_INCLUDE_JSON_IN_CONTENT: 'maybe' })).toThrow(ConfigError);
});

/** The callbacks of the public clients. Every production allowlist lists them. */
const CLIENT_CALLBACKS = [
  'alice://oauth/callback',
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  'http://127.0.0.1:*/oauth/callback',
];

test('the production Worker: name, workers.dev, KV, Durable Object, migrations', () => {
  expect(EXAMPLE.name).toBe('linear-mcp');
  expect(EXAMPLE.workers_dev).toBe(true);
  expect(EXAMPLE.kv_namespaces?.map((namespace) => namespace.binding)).toEqual(['TOKENS']);
  expect(EXAMPLE.durable_objects).toEqual({
    bindings: [{ name: 'OAUTH_AUTHORITY', class_name: 'NativeOAuthAuthority' }],
  });
  // Applied in production. Only ever append. Development has the same list.
  expect(EXAMPLE.migrations).toEqual([
    { tag: 'v1-native-oauth-authority', new_sqlite_classes: ['NativeOAuthAuthority'] },
  ]);
  expect(DEVELOPMENT.migrations).toEqual(EXAMPLE.migrations);
});

test('production runs the same code and runtime as development', () => {
  expect(shapeOf(EXAMPLE).runtime).toEqual(shapeOf(DEVELOPMENT).runtime);
});

test("the redirect allowlist lists the public clients' callbacks", () => {
  expect(productionVars().PROXY_REDIRECT_ALLOWLIST?.split(',')).toEqual(
    expect.arrayContaining(CLIENT_CALLBACKS),
  );
});

test('the provider client ID and secret are trimmed, as before 1.1.0', () => {
  const { settings } = parseConfig({
    ...productionVars(),
    PROVIDER_CLIENT_ID: ' client-id\n',
    PROVIDER_CLIENT_SECRET: 'client-secret\n',
  });
  expect(settings.PROVIDER_CLIENT_ID).toBe('client-id');
  expect(settings.PROVIDER_CLIENT_SECRET).toBe('client-secret');
});

describePrivate('wrangler.production.jsonc, the deployed configuration', () => {
  const real = PRIVATE as WranglerConfig;
  const secrets = {
    PROVIDER_CLIENT_ID: 'id',
    PROVIDER_CLIENT_SECRET: 'secret',
    RS_TOKENS_ENC_KEY: Buffer.alloc(32).toString('base64url'),
  };

  test("has the example's shape: the same keys, vars, list lengths, bindings and migrations", () => {
    expect(shapeOf(real)).toEqual(shapeOf(EXAMPLE));
  });

  test("serves what the example serves, and lists the public clients' callbacks", () => {
    expect(servedAs(parseConfig({ ...real.vars, ...secrets }))).toEqual(
      servedAs(parseConfig({ ...EXAMPLE.vars, ...secrets })),
    );
    expect(real.vars.PROXY_REDIRECT_ALLOWLIST?.split(',')).toEqual(
      expect.arrayContaining(CLIENT_CALLBACKS),
    );
  });

  test('is unchanged since the last deliberate production change', () => {
    // Any edit to wrangler.production.jsonc changes this digest. Update it in the same commit
    // as a deliberate production change; the values themselves stay out of the repository.
    expect(digestOf(real)).toBe('a89e9684d57fb92a54912c08d99e9869bf6edc6adf6794a1a08515c60fc9e181');
  });
});
