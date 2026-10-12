import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { User } from './users.ts';
import { authorContext, profileContext, siteAuthorContext } from './authors.ts';

/** A user, with as much or as little profile as a case needs. */
function user(username: string, profile?: User['profile']): User {
  return {
    id: username.length,
    username,
    ...(profile === undefined ? {} : { profile }),
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

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
      // Every profile link is published rel="me" whether or not the Links box
      // typed it, which is what that box is for (TASK-114).
      links: [{ label: 'Home', href: 'https://ada.example', rel: 'me' }],
    });
  });

  it('adds rel="me" to a profile link, once, whatever it was typed with (TASK-114)', () => {
    const typed = [
      { label: 'Home', href: 'https://ada.example' },
      { label: 'Mastodon', href: 'https://example.social/@ada', rel: 'me' },
      { label: 'Their post', href: 'https://example.com/post', rel: 'nofollow author' },
    ];

    assert.deepEqual(profileContext(user('ada', { links: typed })).links, [
      { label: 'Home', href: 'https://ada.example', rel: 'me' },
      { label: 'Mastodon', href: 'https://example.social/@ada', rel: 'me' },
      { label: 'Their post', href: 'https://example.com/post', rel: 'me nofollow author' },
    ]);
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

  it('carries the job title and the location the profile holds (TASK-79 AC #5)', () => {
    const employed = [
      user('ada', { displayName: 'Ada Lovelace', jobTitle: 'Analyst', location: 'London' }),
    ];

    assert.deepEqual(authorContext(employed, 'ada'), {
      username: 'ada',
      name: 'Ada Lovelace',
      url: '/author/ada/',
      jobTitle: 'Analyst',
      location: 'London',
    });
    assert.equal(authorContext(users, 'ada')?.jobTitle, undefined, 'and neither key otherwise');
    assert.equal(authorContext(users, 'ada')?.location, undefined);
  });
});

describe('what a theme is given as `siteAuthor` (TASK-79 AC #1)', () => {
  const users = [user('ada', { displayName: 'Ada Lovelace', bio: 'Wrote the first program.' })];

  it('is the profile behind the site author setting when it names a user', () => {
    assert.deepEqual(siteAuthorContext(users, 'Ada Lovelace'), profileContext(users[0] as User));
    assert.deepEqual(siteAuthorContext(users, 'ada'), profileContext(users[0] as User));
  });

  it('is nobody at all when the setting names nobody this site has', () => {
    // Unlike a byline, which prints the name a file gives whether or not
    // anybody answers to it: the site author is identity, and a name with no
    // profile behind it has nothing for a theme to print but itself.
    assert.equal(siteAuthorContext(users, 'Joe Blog'), undefined);
    assert.equal(siteAuthorContext(users, undefined), undefined);
    assert.equal(siteAuthorContext(users, '  '), undefined);
    assert.equal(siteAuthorContext([], 'ada'), undefined);
  });
});
