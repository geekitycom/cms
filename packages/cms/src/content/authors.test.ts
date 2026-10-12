import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { authorNames, userForAuthor } from './authors.ts';

interface TestUser {
  readonly id: number;
  readonly username: string;
  readonly profile?: { readonly displayName?: string | undefined } | undefined;
}

function user(username: string, profile?: TestUser['profile']): TestUser {
  return { id: username.length, username, ...(profile === undefined ? {} : { profile }) };
}

describe('which user a post’s author names (AC #2)', () => {
  const users = [
    user('ada', { displayName: 'Ada Lovelace' }),
    user('grace', { displayName: 'Grace Hopper' }),
  ];

  it('is the user whose username it is', () => {
    assert.equal(userForAuthor(users, 'ada')?.username, 'ada');
  });

  it('is the one user whose display name it is, for a file written before this', () => {
    assert.equal(userForAuthor(users, 'Ada Lovelace')?.username, 'ada');
  });

  it('is nobody when two users answer to the same display name', () => {
    const ambiguous = [
      user('ada', { displayName: 'A. Lovelace' }),
      user('augusta', { displayName: 'A. Lovelace' }),
    ];
    assert.equal(userForAuthor(ambiguous, 'A. Lovelace'), undefined);
  });

  it('prefers a username over somebody else’s display name', () => {
    const collision = [user('ada'), user('grace', { displayName: 'ada' })];
    assert.equal(userForAuthor(collision, 'ada')?.username, 'ada');
  });

  it('is nobody for a name nobody answers to, and for no name at all', () => {
    assert.equal(userForAuthor(users, 'Charles Babbage'), undefined);
    assert.equal(userForAuthor(users, undefined), undefined);
    assert.equal(userForAuthor(users, ''), undefined);
  });
});

describe('which stored names read as one user', () => {
  it('is the username, and the display name when that resolves back', () => {
    const users = [
      user('ada', { displayName: 'Ada Lovelace' }),
      user('grace', { displayName: 'Grace Hopper' }),
    ];
    assert.deepEqual(authorNames(users, users[0] as TestUser), ['ada', 'Ada Lovelace']);
  });

  it('leaves out a display name another user’s username has taken', () => {
    const users = [user('ada'), user('grace', { displayName: 'ada' })];
    assert.deepEqual(authorNames(users, users[1] as TestUser), ['grace']);
  });

  it('leaves out a display name two users share', () => {
    const users = [
      user('ada', { displayName: 'A. Lovelace' }),
      user('augusta', { displayName: 'A. Lovelace' }),
    ];
    assert.deepEqual(authorNames(users, users[0] as TestUser), ['ada']);
  });

  it('never lists the same name twice', () => {
    const users = [user('ada', { displayName: 'ada' })];
    assert.deepEqual(authorNames(users, users[0] as TestUser), ['ada']);
  });
});
