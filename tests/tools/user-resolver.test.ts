import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { LinearClient } from '@linear/sdk';
import {
  clearUserCache,
  type ResolvedUser,
  resolveUserByEmail,
  resolveUserByName,
} from '../../src/tools/shared/user-resolver';

function mockClient(users: ResolvedUser[]) {
  const client = new LinearClient({ apiKey: 'synthetic-test-key' });
  const lookup = spyOn(client, 'users').mockResolvedValue({
    nodes: users,
  } as unknown as Awaited<ReturnType<LinearClient['users']>>);
  return { client, lookup };
}

afterEach(() => {
  clearUserCache();
});

// Kept from the checkpoint's audit fix: the user list that assignee names resolve against is
// cached per Linear client, and clients are per Linear token (src/services/linear.ts).
describe('provider principal isolation', () => {
  test("exact and ambiguous assignees never reuse another account's users", async () => {
    const alice = mockClient([
      { id: 'alice-one', name: 'Alex One', email: 'alex@alice.example' },
      { id: 'alice-two', name: 'Alex Two', email: 'alex-two@alice.example' },
    ]);
    const bob = mockClient([{ id: 'bob-one', name: 'Alex Bob', email: 'alex@bob.example' }]);
    const ambiguous = await resolveUserByName(alice.client, 'Alex');
    expect(ambiguous.candidates?.map((candidate) => candidate.id)).toEqual([
      'alice-one',
      'alice-two',
    ]);
    const resolved = await resolveUserByName(bob.client, 'Alex');
    expect(resolved.user?.id).toBe('bob-one');
    expect(bob.lookup).toHaveBeenCalledTimes(1);
    expect(await resolveUserByEmail(bob.client, 'alex@alice.example')).toMatchObject({
      success: false,
    });
    expect(JSON.stringify(resolved)).not.toContain('alice-');
    expect(alice.lookup).toHaveBeenCalledTimes(1);
    expect(bob.lookup).toHaveBeenCalledTimes(1);
    clearUserCache();
    await resolveUserByEmail(bob.client, 'alex@bob.example');
    expect(bob.lookup).toHaveBeenCalledTimes(2);
  });
});
