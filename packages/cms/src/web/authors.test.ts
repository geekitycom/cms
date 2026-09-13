import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { User } from '../admin/accounts.ts';
import {
  AUTHOR_BASE,
  authorContext,
  authorFeedHref,
  authorHref,
  authorNames,
  parseAuthorPath,
  profileContext,
  userForAuthor,
} from './authors.ts';

/** A user, with as much or as little profile as a case needs. */
function user(username: string, profile?: User['profile']): User {
  return {
    id: username.length,
    username,
    ...(profile === undefined ? {} : { profile }),
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

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

  it('hangs the three feeds off the archive, RSS at the bare feed', () => {
    assert.equal(authorFeedHref('ada', 'rss'), '/author/ada/feed/');
    assert.equal(authorFeedHref('ada', 'atom'), '/author/ada/feed/atom/');
    assert.equal(authorFeedHref('ada', 'json'), '/author/ada/feed/json/');
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
    assert.deepEqual(authorNames(users, users[0] as User), ['ada', 'Ada Lovelace']);
  });

  it('leaves out a display name another user’s username has taken', () => {
    const users = [user('ada'), user('grace', { displayName: 'ada' })];
    assert.deepEqual(authorNames(users, users[1] as User), ['grace']);
  });

  it('leaves out a display name two users share', () => {
    const users = [
      user('ada', { displayName: 'A. Lovelace' }),
      user('augusta', { displayName: 'A. Lovelace' }),
    ];
    assert.deepEqual(authorNames(users, users[0] as User), ['ada']);
  });

  it('never lists the same name twice', () => {
    const users = [user('ada', { displayName: 'ada' })];
    assert.deepEqual(authorNames(users, users[0] as User), ['ada']);
  });
});

describe('what a theme is given as `author`', () => {
  const users = [
    user('ada', {
      displayName: 'Ada Lovelace',
      bio: 'Wrote the first program.',
      avatar: '/uploads/ada.jpg',
      links: [{ label: 'Home', href: 'https://ada.example' }],
    }),
  ];

  it('is the profile and the archive URL for a name that resolves', () => {
    assert.deepEqual(authorContext(users, 'Ada Lovelace'), {
      username: 'ada',
      name: 'Ada Lovelace',
      url: '/author/ada/',
      bio: 'Wrote the first program.',
      avatar: '/uploads/ada.jpg',
      links: [{ label: 'Home', href: 'https://ada.example' }],
    });
  });

  it('is the username when the user wrote no display name', () => {
    assert.deepEqual(authorContext([user('grace')], 'grace'), {
      username: 'grace',
      name: 'grace',
      url: '/author/grace/',
    });
  });

  it('is the bare name, with nowhere to go, for a name that resolves to nobody', () => {
    assert.deepEqual(authorContext(users, 'Charles Babbage'), { name: 'Charles Babbage' });
  });

  it('is nothing at all for a document that names no author', () => {
    assert.equal(authorContext(users, undefined), undefined);
    assert.equal(authorContext(users, '  '), undefined);
  });

  it('is the same shape when the archive already knows the user', () => {
    assert.deepEqual(profileContext(users[0] as User), authorContext(users, 'ada'));
  });
});
