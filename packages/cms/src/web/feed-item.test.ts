import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Document } from '../content/document.ts';
import type { SiteData } from './context.ts';
import { FEED_ITEM_REVISION, feedItem, feedItems } from './feed-item.ts';
import type { FeedItemContext } from './feed-item.ts';

/**
 * A post, as the index would hand one to a feed.
 *
 * The fixtures are written out here rather than read off disk because the
 * derivation is a pure function of a document and a site: what it does with a
 * stored id or a missing description should be readable in the test that
 * proves it.
 */
function post(overrides: Partial<Document> = {}): Document {
  return {
    type: 'post',
    path: 'posts/2026-09-02-hello.md',
    slug: 'hello',
    permalink: '/2026/09/hello/',
    title: 'Hello, World!',
    date: '2026-09-02T09:00:00Z',
    tags: ['releases', 'meta'],
    categories: ['engineering'],
    draft: false,
    extra: {},
    body: 'A *file-first* CMS.',
    html: '<p>A <em>file-first</em> CMS.</p>\n',
    hash: 'abc',
    ...overrides,
  };
}

const SITE: SiteData = { title: 'Geekity Demo', url: 'https://example.com', author: 'The Site' };

const CONTEXT: FeedItemContext = { site: SITE, baseUrl: 'https://example.com' };

describe('a feed item', () => {
  it('names the post by its ActivityStreams object id and links to its permalink', () => {
    const item = feedItem(post(), CONTEXT);

    assert.equal(item.id, 'https://example.com/2026/09/hello/');
    assert.equal(item.link, 'https://example.com/2026/09/hello/');
    assert.equal(item.title, 'Hello, World!');
  });

  it('keeps the id a migrated post already carries, while the link stays the permalink', () => {
    const item = feedItem(post({ activitypub: { id: 'https://example.com/?p=813' } }), CONTEXT);

    assert.equal(item.id, 'https://example.com/?p=813');
    assert.equal(item.link, 'https://example.com/2026/09/hello/');
  });

  it('carries both taxonomies as one list of terms, categories first, in file order', () => {
    const item = feedItem(post({ categories: ['engineering', 'notes'], tags: ['web'] }), CONTEXT);

    assert.deepEqual([...item.terms], ['engineering', 'notes', 'web']);
  });

  it('has no terms at all for a post filed under nothing', () => {
    const item = feedItem(post({ categories: [], tags: [] }), CONTEXT);

    assert.deepEqual([...item.terms], []);
  });

  it('summarises with the description the author wrote', () => {
    const item = feedItem(post({ description: 'A short summary.' }), CONTEXT);

    assert.equal(item.summary, 'A short summary.');
  });

  it('summarises a post that carries no description with its first paragraph', () => {
    const item = feedItem(
      post({ html: '<p>Fish &amp; chips, twice.</p>\n<p>A second paragraph.</p>\n' }),
      CONTEXT,
    );

    assert.equal(item.summary, 'Fish & chips, twice.');
  });

  it('carries the publish and modification instants, and neither when there is no date', () => {
    const dated = feedItem(post({ updated: '2026-09-03T10:00:00Z' }), CONTEXT);
    assert.equal(dated.published?.toISOString(), '2026-09-02T09:00:00.000Z');
    assert.equal(dated.updated?.toISOString(), '2026-09-03T10:00:00.000Z');

    const undated = feedItem(post({ date: undefined }), CONTEXT);
    assert.equal(undated.published, undefined);
    assert.equal(undated.updated, undefined);
  });

  it('ignores a date that is not one', () => {
    const item = feedItem(post({ date: 'the day before yesterday' }), CONTEXT);

    assert.equal(item.published, undefined);
  });

  it('credits the post’s own author, and falls back to the site’s for the creator', () => {
    const own = feedItem(post({ author: 'Andrew Shell' }), CONTEXT);
    assert.equal(own.author, 'Andrew Shell');
    assert.equal(own.creator, 'Andrew Shell');

    const anonymous = feedItem(post(), CONTEXT);
    assert.equal(anonymous.author, undefined);
    assert.equal(anonymous.creator, 'The Site');
  });

  it('carries the rendered body and the Markdown it was written from', () => {
    const item = feedItem(post(), CONTEXT);

    assert.equal(item.html, '<p>A <em>file-first</em> CMS.</p>\n');
    assert.equal(item.markdown, 'A *file-first* CMS.');
  });

  it('names what a reply answers, and nothing for a post that answers nothing', () => {
    const reply = feedItem(post({ inReplyTo: 'https://remote.example/notes/1' }), CONTEXT);
    assert.equal(reply.inReplyTo, 'https://remote.example/notes/1');

    assert.equal('inReplyTo' in feedItem(post(), CONTEXT), false);
  });

  it('is no reply when its in-reply-to is not an absolute http(s) URL', () => {
    for (const inReplyTo of ['', 'not a url', '/2026/09/local/', 'mailto:me@example.com']) {
      const item = feedItem(post({ inReplyTo }), CONTEXT);
      assert.equal('inReplyTo' in item, false, `${JSON.stringify(inReplyTo)} is no reply target`);
    }
  });

  it('is at revision 4, so feeds cached before replies named their target are refetched', () => {
    assert.equal(FEED_ITEM_REVISION, 4);
  });

  it('points at its comments, counted, only when the feed resolved the counts', () => {
    assert.equal(feedItem(post(), CONTEXT).comments, undefined);

    const counted = feedItem(post(), {
      ...CONTEXT,
      commentCounts: new Map([['/2026/09/hello/', 3]]),
    });
    assert.deepEqual(counted.comments, {
      page: 'https://example.com/2026/09/hello/#comments',
      feed: 'https://example.com/2026/09/hello/feed/',
      count: 3,
    });

    const uncounted = feedItem(post(), { ...CONTEXT, commentCounts: new Map() });
    assert.equal(uncounted.comments?.count, 0);
  });

  it('resolves every URL against a site that lives in a subdirectory', () => {
    const item = feedItem(post(), {
      site: SITE,
      baseUrl: 'https://example.com/blog/',
      commentCounts: new Map(),
    });

    assert.equal(item.id, 'https://example.com/blog/2026/09/hello/');
    assert.equal(item.link, 'https://example.com/blog/2026/09/hello/');
    assert.equal(item.comments?.feed, 'https://example.com/blog/2026/09/hello/feed/');
  });

  it('derives one item per document, in the order it was given them', () => {
    const items = feedItems(
      [post({ title: 'Newer' }), post({ title: 'Older', permalink: '/2026/08/older/' })],
      CONTEXT,
    );

    assert.deepEqual(
      items.map((item) => item.title),
      ['Newer', 'Older'],
    );
    assert.equal(items[1]?.link, 'https://example.com/2026/08/older/');
  });
});
