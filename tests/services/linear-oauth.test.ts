import { describe, expect, test } from 'bun:test';
import {
  LINEAR_SCOPES,
  linearOAuth,
  readLinearTokenResponse,
} from '../../src/services/linear-oauth';

describe('Linear as the OAuth provider', () => {
  test("Linear's endpoints and scopes, as the server used them before", () => {
    expect(linearOAuth).toMatchObject({
      authorizationUrl: 'https://linear.app/oauth/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      scopes: ['read', 'write'],
      authorizationParams: {},
    });
    expect(LINEAR_SCOPES).toEqual(['read', 'write']);
  });

  test('scope is read from a space- or comma-separated string, or a list', () => {
    for (const scope of [
      'read write',
      'read,write',
      'read, write',
      ['read', 'write'],
      ['read,write'],
    ]) {
      expect(readLinearTokenResponse({ access_token: 'a', scope }).scopes).toEqual([
        'read',
        'write',
      ]);
    }
    expect(readLinearTokenResponse({ access_token: 'a' }).scopes).toEqual([]);
  });

  test('the rest is RFC 6749: lifetime defaults to an hour; no token is an error', () => {
    expect(readLinearTokenResponse({ access_token: 'a', refresh_token: 'r' })).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 3600,
      scopes: [],
    });
    expect(readLinearTokenResponse({ access_token: 'a', expires_in: 315_705_599 }).expiresIn).toBe(
      315_705_599,
    );
    expect(() => readLinearTokenResponse({})).toThrow('provider_no_token');
    expect(() => readLinearTokenResponse({ access_token: 'a', expires_in: 0 })).toThrow(
      'provider_token_error',
    );
  });
});
