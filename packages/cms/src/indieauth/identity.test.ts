/**
 * Which user a typed me URL names (TASK-157, decision-23).
 *
 * An author URL names that user; the site root names the site author only on
 * a solo author site; every other URL, and the root of a multi-author site,
 * names nobody. A variant that differs only in http or https, a `www.`
 * prefix, the case of the host or a missing trailing slash is the same URL.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { User } from '../admin/accounts.ts';
import { userForMe } from './identity.ts';

const ADA: User = { id: 1, username: 'ada', createdAt: '2026-09-01T00:00:00.000Z' };
const BOB: User = { id: 2, username: 'bob', createdAt: '2026-09-01T00:00:00.000Z' };
const USERS = [ADA, BOB];

const SOLO = { author: 'ada', soloAuthor: true };
const SHARED = { author: 'ada', soloAuthor: false };

function who(
  me: string,
  settings: { author: string; soloAuthor: boolean } = SOLO,
  baseUrl = 'https://blog.example',
): string | undefined {
  return userForMe(me, { baseUrl, users: USERS, settings })?.username;
}

describe('userForMe', () => {
  it('reads the root of a solo author site as the site author', () => {
    for (const me of [
      'https://blog.example/',
      'https://blog.example',
      'http://blog.example/',
      'https://www.blog.example/',
      'HTTPS://Blog.Example/',
    ]) {
      assert.equal(who(me), 'ada', me);
    }
  });

  it('reads the root of a multi-author site as nobody', () => {
    assert.equal(who('https://blog.example/', SHARED), undefined);
    assert.equal(who('https://blog.example', SHARED), undefined);
  });

  it('reads the root as nobody when the author setting names no user', () => {
    assert.equal(who('https://blog.example/', { author: 'carol', soloAuthor: true }), undefined);
    assert.equal(who('https://blog.example/', { author: '', soloAuthor: true }), undefined);
  });

  it('reads an author URL as that user, solo or not', () => {
    for (const settings of [SOLO, SHARED]) {
      assert.equal(who('https://blog.example/author/bob/', settings), 'bob');
      assert.equal(who('https://blog.example/author/bob', settings), 'bob');
      assert.equal(who('http://www.blog.example/author/bob/', settings), 'bob');
      assert.equal(who('https://blog.example/author/ada/', settings), 'ada');
    }
  });

  it('reads every other URL as nobody', () => {
    for (const me of [
      'https://blog.example/author/carol/',
      'https://blog.example/author/Bob/',
      'https://blog.example/author/',
      'https://blog.example/author/bob/page/2/',
      'https://blog.example/author/bob/feed/',
      'https://blog.example/2026/09/hello/',
      'https://blog.example/?author=2',
      'https://blog.example/author/bob/?x=1',
      'https://blog.example/#me',
      'https://ada:secret@blog.example/',
      'https://blog.example:8443/',
      'https://other.example/',
      'https://evil.blog.example/',
      'https://blog.example.evil/',
      'ftp://blog.example/',
      'blog.example',
      '',
      'not a url',
    ]) {
      assert.equal(who(me), undefined, me);
    }
  });

  it('takes a www. prefix off either side of the comparison', () => {
    assert.equal(who('https://blog.example/', SOLO, 'https://www.blog.example'), 'ada');
    assert.equal(
      who('https://www.blog.example/author/bob/', SOLO, 'https://www.blog.example'),
      'bob',
    );
  });

  it('keeps the port of a site served on one', () => {
    assert.equal(who('http://localhost:3000/author/bob/', SOLO, 'http://localhost:3000'), 'bob');
    assert.equal(who('http://localhost/author/bob/', SOLO, 'http://localhost:3000'), undefined);
  });

  it('reads the paths under a base URL that has one', () => {
    assert.equal(who('https://blog.example/notes/', SOLO, 'https://blog.example/notes'), 'ada');
    assert.equal(who('https://blog.example/notes', SOLO, 'https://blog.example/notes'), 'ada');
    assert.equal(
      who('https://blog.example/notes/author/bob/', SOLO, 'https://blog.example/notes'),
      'bob',
    );
    assert.equal(who('https://blog.example/', SOLO, 'https://blog.example/notes'), undefined);
    assert.equal(
      who('https://blog.example/author/bob/', SOLO, 'https://blog.example/notes'),
      undefined,
    );
  });
});
