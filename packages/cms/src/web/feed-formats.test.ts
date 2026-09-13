import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { atomEntry } from './feed-atom.ts';
import type { FeedItem } from './feed-item.ts';
import { jsonFeedItem } from './feed-json.ts';
import { rssItem } from './feed-rss.ts';

/**
 * One item, given to all three serialisers.
 *
 * The point of the fixture is that it is the same object each time, and after
 * TASK-64 the point of the assertions is that the three formats say the same
 * things about it: the item's id names the post in all three, its terms are
 * listed whole in all three, and its summary is printed by all three.
 * decision-12 is what they agree on.
 *
 * This one is a migrated post: its id is the `?p=813` WordPress gave it, which
 * is a name rather than an address, so RSS marks the guid `isPermaLink="false"`.
 */
const ITEM: FeedItem = {
  id: 'https://example.com/?p=813',
  link: 'https://example.com/2026/09/hello/',
  title: 'Hello & <Goodbye>',
  published: new Date('2026-09-02T09:00:00Z'),
  updated: new Date('2026-09-03T10:00:00Z'),
  author: 'Andrew Shell',
  creator: 'Andrew Shell',
  terms: ['engineering', 'releases', 'meta'],
  summary: 'A short summary.',
  html: '<p>A <em>file-first</em> CMS.</p>\n',
  markdown: 'A *file-first* CMS.',
  comments: {
    page: 'https://example.com/2026/09/hello/#comments',
    feed: 'https://example.com/2026/09/hello/feed/',
    count: 3,
  },
};

/**
 * A post born on the CMS with nothing optional: no dates, no author, no terms,
 * and a summary that had to be excerpted. Its id is its permalink, so RSS
 * marks the guid `isPermaLink="true"`.
 */
const BARE: FeedItem = {
  id: 'https://example.com/2026/09/bare/',
  link: 'https://example.com/2026/09/bare/',
  title: 'Bare',
  terms: [],
  summary: 'Nothing much.',
  html: '<p>Nothing much.</p>\n',
  markdown: 'Nothing much.',
};

describe('an RSS item', () => {
  it('renders the whole item, keyed by its object id', () => {
    assert.deepEqual(rssItem(ITEM), [
      '    <item>',
      '      <title>Hello &amp; &lt;Goodbye&gt;</title>',
      '      <link>https://example.com/2026/09/hello/</link>',
      '      <guid isPermaLink="false">https://example.com/?p=813</guid>',
      '      <pubDate>Wed, 02 Sep 2026 09:00:00 GMT</pubDate>',
      '      <dc:creator>Andrew Shell</dc:creator>',
      '      <category>engineering</category>',
      '      <category>releases</category>',
      '      <category>meta</category>',
      '      <comments>https://example.com/2026/09/hello/#comments</comments>',
      '      <wfw:commentRss>https://example.com/2026/09/hello/feed/</wfw:commentRss>',
      '      <source:comments count="3" feedUrl="https://example.com/2026/09/hello/feed/"/>',
      '      <description>A short summary.</description>',
      '      <content:encoded><![CDATA[<p>A <em>file-first</em> CMS.</p>\n]]></content:encoded>',
      '      <source:markdown><![CDATA[A *file-first* CMS.]]></source:markdown>',
      '    </item>',
    ]);
  });

  it('marks the guid a permalink when the id is one, and leaves out the rest', () => {
    assert.deepEqual(rssItem(BARE), [
      '    <item>',
      '      <title>Bare</title>',
      '      <link>https://example.com/2026/09/bare/</link>',
      '      <guid isPermaLink="true">https://example.com/2026/09/bare/</guid>',
      '      <description>Nothing much.</description>',
      '      <content:encoded><![CDATA[<p>Nothing much.</p>\n]]></content:encoded>',
      '      <source:markdown><![CDATA[Nothing much.]]></source:markdown>',
      '    </item>',
    ]);
  });
});

describe('an Atom entry', () => {
  it('renders the same item, keyed by the same object id and carrying every term', () => {
    assert.deepEqual(atomEntry(ITEM), [
      '  <entry>',
      '    <id>https://example.com/?p=813</id>',
      '    <title>Hello &amp; &lt;Goodbye&gt;</title>',
      '    <updated>2026-09-03T10:00:00.000Z</updated>',
      '    <published>2026-09-02T09:00:00.000Z</published>',
      '    <link rel="alternate" type="text/html" href="https://example.com/2026/09/hello/"/>',
      '    <author>',
      '      <name>Andrew Shell</name>',
      '    </author>',
      '    <category term="engineering"/>',
      '    <category term="releases"/>',
      '    <category term="meta"/>',
      '    <summary type="text">A short summary.</summary>',
      '    <content type="html">&lt;p&gt;A &lt;em&gt;file-first&lt;/em&gt; CMS.&lt;/p&gt;\n</content>',
      '  </entry>',
    ]);
  });

  it('falls back to the epoch for an item with no instants, and still summarises', () => {
    assert.deepEqual(atomEntry(BARE), [
      '  <entry>',
      '    <id>https://example.com/2026/09/bare/</id>',
      '    <title>Bare</title>',
      '    <updated>1970-01-01T00:00:00.000Z</updated>',
      '    <link rel="alternate" type="text/html" href="https://example.com/2026/09/bare/"/>',
      '    <summary type="text">Nothing much.</summary>',
      '    <content type="html">&lt;p&gt;Nothing much.&lt;/p&gt;\n</content>',
      '  </entry>',
    ]);
  });

  it('carries no summary at all for an item there is nothing to summarise', () => {
    const entry = atomEntry({ ...BARE, summary: '', html: '' });

    assert.deepEqual(
      entry.filter((line) => line.includes('<summary')),
      [],
    );
  });
});

describe('a JSON Feed item', () => {
  it('renders the same item, in the order JSON Feed 1.1 lists its keys', () => {
    const item = jsonFeedItem(ITEM);

    assert.deepEqual(item, {
      // The object id names the item; the permalink is where it is read.
      id: 'https://example.com/?p=813',
      url: 'https://example.com/2026/09/hello/',
      title: 'Hello & <Goodbye>',
      content_html: '<p>A <em>file-first</em> CMS.</p>\n',
      summary: 'A short summary.',
      date_published: '2026-09-02T09:00:00.000Z',
      date_modified: '2026-09-03T10:00:00.000Z',
      tags: ['engineering', 'releases', 'meta'],
      authors: [{ name: 'Andrew Shell' }],
    });
    assert.deepEqual(Object.keys(item), [
      'id',
      'url',
      'title',
      'content_html',
      'summary',
      'date_published',
      'date_modified',
      'tags',
      'authors',
    ]);
  });

  it('leaves out every key the item has nothing for, but still summarises', () => {
    assert.deepEqual(jsonFeedItem(BARE), {
      id: 'https://example.com/2026/09/bare/',
      url: 'https://example.com/2026/09/bare/',
      title: 'Bare',
      content_html: '<p>Nothing much.</p>\n',
      summary: 'Nothing much.',
    });
  });

  it('carries no summary key at all for an item there is nothing to summarise', () => {
    assert.equal('summary' in jsonFeedItem({ ...BARE, summary: '', html: '' }), false);
  });
});
