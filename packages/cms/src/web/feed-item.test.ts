import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { User } from '../admin/accounts.ts';
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

const ANDREW: User = {
  id: 1,
  username: 'andrew',
  createdAt: '2026-09-01T00:00:00.000Z',
  profile: { displayName: 'Andrew Shell' },
};
const ADA: User = { id: 2, username: 'ada', createdAt: '2026-09-01T00:00:00.000Z' };

const SITE: SiteData = { title: 'Geekity Demo', url: 'https://example.com', author: 'andrew' };

const CONTEXT: FeedItemContext = {
  site: SITE,
  baseUrl: 'https://example.com',
  users: [ANDREW, ADA],
};

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
    const own = feedItem(post({ author: 'ada' }), CONTEXT);
    assert.equal(own.author, 'ada', 'a user with no display name goes by their username');
    assert.equal(own.creator, 'ada');

    const anonymous = feedItem(post(), CONTEXT);
    assert.equal(anonymous.author, undefined);
    assert.equal(anonymous.creator, 'Andrew Shell');
  });

  it('prints a username a post stores as that user’s display name (TASK-192 AC #8)', () => {
    const item = feedItem(post({ author: 'andrew' }), CONTEXT);

    assert.equal(item.author, 'Andrew Shell');
    assert.equal(item.creator, 'Andrew Shell');
  });

  it('prints an author that is nobody here as it is stored', () => {
    const item = feedItem(post({ author: 'A Guest' }), CONTEXT);

    assert.equal(item.author, 'A Guest');
    assert.equal(item.creator, 'A Guest');
  });

  it('credits the site title on a site with several authors (TASK-192 AC #4)', () => {
    const item = feedItem(post(), { ...CONTEXT, site: { ...SITE, author: undefined } });

    assert.equal(item.creator, 'Geekity Demo');
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

  it('is at revision 9, so feeds cached before a read post printed its read line are refetched', () => {
    assert.equal(FEED_ITEM_REVISION, 9);
  });

  it('opens a read post with the read line the page prints, and summarises with its words (TASK-233)', () => {
    const read = post({
      title: '',
      body: 'Loved it.',
      html: '<p>Loved it.</p>\n',
      extra: {
        'read-status': 'finished',
        'read-of': { name: 'Dune', author: 'Frank Herbert', uid: 'isbn:9780441013593' },
        photo: ['/uploads/2026/10/cover.jpg'],
      },
    });
    const item = feedItem(read, CONTEXT);

    assert.equal(
      item.html,
      '<p class="read-line"><data class="p-read-status" value="finished">Finished reading</data>: ' +
        '<span class="p-read-of h-cite"><cite class="p-name">Dune</cite> by ' +
        '<span class="p-author">Frank Herbert</span>, ' +
        '<data class="p-uid" value="isbn:9780441013593">ISBN: 9780441013593</data></span></p>\n' +
        '<figure><img src="https://example.com/uploads/2026/10/cover.jpg" alt=""></figure>' +
        '<p>Loved it.</p>\n',
    );
    assert.equal(item.summary, 'Finished reading: Dune by Frank Herbert, ISBN: 9780441013593');
  });

  it('names the post’s language when it differs from the feed’s (TASK-154 AC #3)', () => {
    const site = { ...CONTEXT, site: { ...SITE, language: 'en' } };

    assert.equal(feedItem(post({ extra: { lang: 'fr-ca' } }), site).language, 'fr-CA');
    assert.equal('language' in feedItem(post({ extra: { lang: 'en' } }), site), false);
    assert.equal('language' in feedItem(post(), site), false);
    // A tag that is not one is no language to declare.
    assert.equal('language' in feedItem(post({ extra: { lang: 'not a tag' } }), site), false);
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
      ...CONTEXT,
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
