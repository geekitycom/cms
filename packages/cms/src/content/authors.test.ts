import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  accountOf,
  AUTHOR_BASE,
  authorHref,
  authorNames,
  parseAuthorPath,
  userForAuthor,
} from './authors.ts';

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

describe('where an author archive lives', () => {
  it('is /author/{username}/, paginated like the home page', () => {
    assert.equal(AUTHOR_BASE, 'author');
    assert.equal(authorHref('ada'), '/author/ada/');
    assert.equal(authorHref('ada', 0), '/author/ada/');
    assert.equal(authorHref('ada', 1), '/author/ada/page/2/');
  });

  it('escapes a username that needs it, so the URL is one segment', () => {
    assert.equal(authorHref('ada.lovelace'), '/author/ada.lovelace/');
  });
});

describe('reading a path as an author archive', () => {
  it('reads the archive and its later pages', () => {
    assert.deepEqual(parseAuthorPath('/author/ada/'), { username: 'ada', pageNumber: 0 });
    assert.deepEqual(parseAuthorPath('/author/ada/page/3/'), { username: 'ada', pageNumber: 2 });
  });

  it('reads page/1/ as the archive itself, so the caller can collapse it', () => {
    assert.deepEqual(parseAuthorPath('/author/ada/page/1/'), { username: 'ada', pageNumber: 0 });
  });

  it('is undefined for anything that is not one', () => {
    for (const pathname of [
      '/',
      '/author/',
      '/author/ada',
      '/author/ada/feed/',
      '/author/ada/page/',
      '/author/ada/page/0/',
      '/author/ada/page/two/',
      '/author/ada/extra/',
      '/tag/ada/',
    ]) {
      assert.equal(parseAuthorPath(pathname), undefined, pathname);
    }
  });
});

describe('the account a user answers for', () => {
  it('is the username at the site’s host, port and all', () => {
    assert.equal(accountOf('ada', 'https://example.com/blog/'), 'ada@example.com');
    assert.equal(accountOf('ada', 'http://localhost:3000'), 'ada@localhost:3000');
  });

  it('is at localhost for a site with no base URL yet', () => {
    assert.equal(accountOf('ada', ''), 'ada@localhost');
  });
});
