import { describe, expect, test } from 'bun:test';
import { createLinearClientFactory } from '../../src/services/linear';

describe('Linear clients', () => {
  test('one client per Linear token, so per-client caches never cross users', () => {
    const linear = createLinearClientFactory();
    const alice = linear('linear-alice');
    expect(linear('linear-alice')).toBe(alice);
    expect(linear('linear-bob')).not.toBe(alice);
  });

  test('the cache is bounded; the least recently used client goes first', () => {
    const linear = createLinearClientFactory({ maxClients: 2 });
    const first = linear('one');
    const second = linear('two');
    expect(linear('one')).toBe(first);
    linear('three');
    expect(linear('one')).toBe(first);
    expect(linear('two')).not.toBe(second);
  });

  test('`lin_` tokens go as API keys, others as OAuth access tokens, as before', () => {
    const linear = createLinearClientFactory();
    expect(linear('lin_api_example').options).toMatchObject({
      headers: { Authorization: 'lin_api_example' },
    });
    expect(linear('oauth-access').options).toMatchObject({
      headers: { Authorization: 'Bearer oauth-access' },
    });
  });

  test('the API URL can point elsewhere (the smoke tests use a loopback stand-in)', () => {
    const linear = createLinearClientFactory({ apiUrl: 'http://127.0.0.1:9/graphql' });
    expect(linear('token').options.apiUrl).toBe('http://127.0.0.1:9/graphql');
    expect(createLinearClientFactory()('token').options.apiUrl).toBe(
      'https://api.linear.app/graphql',
    );
  });
});
