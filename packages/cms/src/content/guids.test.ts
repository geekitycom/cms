import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import type { Document } from './document.ts';
import {
  commentPageHref,
  feedGuid,
  isKey,
  postObjectId,
  repliesKey,
  webmentionKey,
} from './guids.ts';

const BASE = 'https://example.com/blog/';

function document(overrides: Partial<Document> = {}): Document {
  return {
    type: 'post',
    path: 'posts/2026-09-01-hello.md',
    slug: 'hello',
    permalink: '/2026/09/hello/',
    title: 'Hello',
    date: '2026-09-01T10:00:00.000Z',
    tags: [],
    categories: [],
    draft: false,
    extra: {},
    body: '',
    html: '',
    hash: '',
    ...overrides,
  };
}

describe('postObjectId', () => {
  it('is the permalink, absolute on the base URL', () => {
    assert.equal(postObjectId(document(), BASE), 'https://example.com/blog/2026/09/hello/');
  });

  it('is the id the file already names, for a post that brought one', () => {
    const migrated = document({ activitypub: { id: 'https://example.com/?p=813' } });
    assert.equal(postObjectId(migrated, BASE), 'https://example.com/?p=813');
  });

  it('is the permalink when the stored id is not a URL', () => {
    const typed = document({ activitypub: { id: 'not a url' } });
    assert.equal(postObjectId(typed, BASE), 'https://example.com/blog/2026/09/hello/');
  });
});

describe('feedGuid', () => {
  it('is a migrated document’s stored guid, trimmed', () => {
    const migrated = document({ extra: { guid: ' https://example.com/?p=7 ' } });
    assert.equal(feedGuid(migrated, BASE), 'https://example.com/?p=7');
  });

  it('is a post’s object id when it stores no guid', () => {
    const post = document({ activitypub: { id: 'https://example.com/?p=813' } });
    assert.equal(feedGuid(post, BASE), 'https://example.com/?p=813');
  });

  it('is a page’s permalink, whatever id it names', () => {
    const page = document({
      type: 'page',
      permalink: '/about/',
      activitypub: { id: 'https://example.com/?page_id=2' },
    });
    assert.equal(feedGuid(page, BASE), 'https://example.com/blog/about/');
  });

  it('ignores a stored guid that is not a URL', () => {
    const post = document({ extra: { guid: 'abc' } });
    assert.equal(feedGuid(post, BASE), 'https://example.com/blog/2026/09/hello/');
  });
});

describe('repliesKey', () => {
  it('is the first 16 hex digits of the SHA-256 of the guid', () => {
    const guid = 'https://example.com/blog/2026/09/hello/';
    const digest = createHash('sha256').update(guid).digest('hex');
    assert.equal(repliesKey(guid), digest.slice(0, 16));
    assert.match(repliesKey(guid), /^[0-9a-f]{16}$/);
  });
});

describe('commentPageHref', () => {
  it('is the comment’s own page under /comment/', () => {
    assert.equal(commentPageHref('0123456789abcdef'), '/comment/0123456789abcdef/');
  });
});

describe('webmentionKey', () => {
  it('is the replies key of the source and the post it was sent to', () => {
    assert.equal(
      webmentionKey('https://other.example/note', '/2026/09/hello/'),
      repliesKey('https://other.example/note /2026/09/hello/'),
    );
  });

  it('tells apart one source mentioning two posts', () => {
    const source = 'https://other.example/note';
    assert.notEqual(webmentionKey(source, '/a/'), webmentionKey(source, '/b/'));
  });

  it('is undefined for a webmention with no source', () => {
    assert.equal(webmentionKey(null, '/a/'), undefined);
    assert.equal(webmentionKey('', '/a/'), undefined);
  });
});

describe('isKey', () => {
  it('accepts sixteen lowercase hex digits', () => {
    assert.equal(isKey(repliesKey('anything')), true);
  });

  it('refuses anything else', () => {
    for (const value of [
      '',
      'ABCDEF0123456789',
      '0123456789abcde',
      '0123456789abcdef0',
      'g123456789abcdef',
    ]) {
      assert.equal(isKey(value), false, value);
    }
  });
});
