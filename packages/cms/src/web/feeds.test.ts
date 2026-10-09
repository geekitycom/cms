import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveNothing } from '../admin/__testing__/harness.ts';
import { createUser, listUsers, setUserProfile } from '../admin/accounts.ts';
import { readSiteSettings, writeSiteJson } from '../admin/settings.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { child, childrenNamed, parseXml } from './__testing__/xml.ts';
import type { XmlElement } from './__testing__/xml.ts';

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/**
 * A CMS over a content directory holding `files`, already synced. Watching is
 * off so a request only ever sees what the scan indexed.
 */
async function site(
  files: Record<string, string>,
  config: GeekityConfig = {},
): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await temporaryDir('geekity-feed-content-');
  const dataDir = await temporaryDir('geekity-feed-data-');
  await writeTree(contentDir, files);

  const instance = createCms({
    contentDir,
    dataDir,
    watch: false,
    baseUrl: 'https://example.com',
    hostLookup: resolveNothing,
    ...config,
  });
  started.push(instance);
  await instance.sync();
  return { cms: instance, contentDir };
}

/** Point the site's feeds at another notify server, or at none. */
async function setNotifyServer(cms: Cms, notifyServer: string): Promise<void> {
  const contentDir = cms.config.contentDir;
  await writeSiteJson({ contentDir, settings: { ...readSiteSettings(contentDir), notifyServer } });
}

/** A post file. */
function post(
  title: string,
  options: {
    date: string;
    permalink: string;
    updated?: string;
    tags?: string[];
    categories?: string[];
    draft?: boolean;
    description?: string;
    author?: string;
    inReplyTo?: string;
    body?: string;
  },
): string {
  // Titles and descriptions are JSON-quoted, which YAML reads as a double
  // quoted scalar, so a fixture may carry quotes, angle brackets and ampersands.
  const lines = [
    `title: ${JSON.stringify(title)}`,
    `date: '${options.date}'`,
    `permalink: ${options.permalink}`,
  ];
  if (options.updated !== undefined) lines.push(`updated: '${options.updated}'`);
  if (options.tags !== undefined) {
    lines.push('tags:', ...options.tags.map((tag) => `  - ${tag}`));
  }
  if (options.categories !== undefined) {
    lines.push('categories:', ...options.categories.map((category) => `  - ${category}`));
  }
  if (options.draft === true) lines.push('draft: true');
  if (options.description !== undefined) {
    lines.push(`description: ${JSON.stringify(options.description)}`);
  }
  if (options.author !== undefined) lines.push(`author: ${options.author}`);
  if (options.inReplyTo !== undefined) {
    lines.push(`in-reply-to: ${JSON.stringify(options.inReplyTo)}`);
  }

  return `---\n${lines.join('\n')}\n---\n\n${options.body ?? 'Body.'}\n`;
}

/** The `<link>` with a given `rel`, asserting there is exactly one. */
function linkWithRel(element: XmlElement, rel: string): XmlElement {
  const found = childrenNamed(element, 'link').filter((link) => link.attributes['rel'] === rel);
  assert.equal(found.length, 1, `exactly one <link rel="${rel}"> inside <${element.name}>`);
  return found[0] as XmlElement;
}

/** The `<atom:link>` with a given `rel`, asserting there is exactly one. */
function atomLinkWithRel(element: XmlElement, rel: string): XmlElement {
  const found = childrenNamed(element, 'atom:link').filter(
    (link) => link.attributes['rel'] === rel,
  );
  assert.equal(found.length, 1, `exactly one <atom:link rel="${rel}"> inside <${element.name}>`);
  return found[0] as XmlElement;
}

/** The Atom feed at a URL, parsed. */
async function atom(cms: Cms, url: string): Promise<{ response: Response; feed: XmlElement }> {
  const response = await cms.app.request(url);
  const body = await response.text();
  return { response, feed: parseXml(body) };
}

/**
 * The RSS feed at a URL: the response, the `<rss>` element and its channel,
 * with what RSS 2.0 requires of every channel already asserted.
 */
async function rss(
  cms: Cms,
  url: string,
): Promise<{ response: Response; body: string; rss: XmlElement; channel: XmlElement }> {
  const response = await cms.app.request(url);
  const body = await response.text();
  const document = parseXml(body);

  // https://www.rssboard.org/rss-specification : the root is <rss version="2.0">
  // holding one <channel>, and a channel has a title, a link and a description.
  assert.equal(document.name, 'rss');
  assert.equal(document.attributes['version'], '2.0');
  const channel = child(document, 'channel');
  for (const required of ['title', 'link', 'description']) {
    assert.ok(child(channel, required).name === required, `the channel has a <${required}>`);
  }

  return { response, body, rss: document, channel };
}

function htmlText(html: string): string {
  assert.ok(!html.includes('<'), `no markup in ${JSON.stringify(html)}`);
  assert.ok(!/&(?!amp;|lt;|gt;)/.test(html), `no bare ampersand in ${JSON.stringify(html)}`);
  return html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

describe('the RSS feed', () => {
  it('serves a well-formed RSS 2.0 channel describing the site', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({
        title: 'Geekity Demo',
        tagline: 'A file-first site',
        author: 'Andrew Shell',
        language: 'en-GB',
        avatar: '/uploads/2026/09/me.png',
      }),
      'posts/2026-09-02-hello.md': post('Hello, World!', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hello/',
      }),
    });

    const { response, channel } = await rss(cms, '/feed/');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/rss+xml; charset=utf-8');

    assert.equal(child(channel, 'title').text, 'Geekity Demo');
    assert.equal(child(channel, 'link').text, 'https://example.com/');
    assert.equal(child(channel, 'description').text, 'A file-first site');
    assert.equal(child(channel, 'language').text, 'en-GB');
    assert.equal(child(channel, 'lastBuildDate').text, 'Wed, 02 Sep 2026 09:00:00 GMT');
    assert.ok(child(channel, 'generator').text.length > 0, 'the channel names its generator');

    const self = atomLinkWithRel(channel, 'self');
    assert.equal(self.attributes['type'], 'application/rss+xml');
    assert.equal(self.attributes['href'], 'https://example.com/feed/');

    const image = child(channel, 'image');
    assert.equal(child(image, 'url').text, 'https://example.com/uploads/2026/09/me.png');
    assert.equal(child(image, 'title').text, 'Geekity Demo');
    assert.equal(child(image, 'link').text, 'https://example.com/');
  });

  it('carries one item per published post, newest first, with the whole post', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'Geekity Demo' }),
      'posts/2026-09-02-newer.md': post('Newer', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/newer/',
        tags: ['releases', 'meta'],
        categories: ['engineering'],
        description: 'A short summary.',
        author: 'Andrew Shell',
        body: 'A *file-first* CMS & proud of it.',
      }),
      'posts/2026-08-15-older.md': post('Older', {
        date: '2026-08-15T09:00:00Z',
        permalink: '/2026/08/older/',
      }),
    });

    const { channel } = await rss(cms, '/feed/');
    const items = childrenNamed(channel, 'item');

    assert.deepEqual(
      items.map((item) => child(item, 'title').text),
      ['Newer', 'Older'],
    );

    const [newer, older] = items as [XmlElement, XmlElement];

    assert.equal(child(newer, 'link').text, 'https://example.com/2026/09/newer/');
    assert.equal(child(newer, 'pubDate').text, 'Wed, 02 Sep 2026 09:00:00 GMT');
    assert.equal(child(newer, 'dc:creator').text, 'Andrew Shell');

    // The guid is the ActivityStreams object id, which after decision-13 is
    // the permalink itself — so it really is a permalink, and says so.
    const guid = child(newer, 'guid');
    assert.equal(guid.attributes['isPermaLink'], 'true');
    assert.equal(guid.text, 'https://example.com/2026/09/newer/');

    // Both taxonomies become categories, categories before tags.
    assert.deepEqual(
      childrenNamed(newer, 'category').map((category) => category.text),
      ['engineering', 'releases', 'meta'],
    );

    assert.equal(child(newer, 'description').text, 'A short summary.');
    assert.equal(
      child(newer, 'content:encoded').text.trim(),
      '<p>A <em>file-first</em> CMS &amp; proud of it.</p>',
    );
    assert.equal(child(newer, 'source:markdown').text, 'A *file-first* CMS & proud of it.');

    // A post that names no author falls back to the site's, and a site with
    // several authors is credited by its title.
    assert.equal(child(older, 'dc:creator').text, 'Geekity Demo');
  });

  it('summarises a post that carries no description with its first paragraph', async () => {
    const words = Array.from({ length: 70 }, (_, index) => `word${String(index + 1)}`);
    const { cms } = await site({
      'posts/2026-09-02-long.md': post('Long', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/long/',
        body: `${words.join(' ')}\n\nA second paragraph nobody should see.`,
      }),
    });

    const { channel } = await rss(cms, '/feed/');
    const description = child(child(channel, 'item'), 'description').text;

    assert.equal(description, `${words.slice(0, 55).join(' ')} …`);
    assert.ok(!description.includes('second paragraph'), 'only the first paragraph is summarised');
    assert.ok(!description.includes('<'), 'the summary is plain text');
  });

  it('keeps the whole post out of an item that has to be escaped', async () => {
    const { cms } = await site({
      'posts/2026-09-02-hostile.md': post('"Angle < brackets" & ampersands', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/hostile/',
        tags: ['<script>'],
        body: 'Fish & chips <span>now</span>, and a stray ]]> in the text.',
      }),
    });

    // Parsing is the assertion: the reader rejects a bare `<` or `&` outside a
    // CDATA section, and a `]]>` that was not split would end the section
    // early and leave the rest as markup.
    const { channel, body } = await rss(cms, '/feed/');
    const item = child(channel, 'item');

    assert.equal(child(item, 'title').text, '"Angle < brackets" & ampersands');
    assert.equal(child(item, 'category').text, '<script>');
    assert.equal(
      htmlText(child(item, 'description').text),
      'Fish & chips now, and a stray ]]> in the text.',
    );
    assert.ok(
      child(item, 'source:markdown').text.includes('a stray ]]> in the text'),
      'the Markdown survives the CDATA split',
    );
    assert.ok(!body.includes('<script>'), 'no unescaped markup reaches the document');
  });

  it('leaves out drafts, trashed documents and pages, and stops at the feed size', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'Short', feedSize: 2 }),
      'posts/2026-09-03-one.md': post('One', { date: '2026-09-03T09:00:00Z', permalink: '/one/' }),
      'posts/2026-09-02-two.md': post('Two', { date: '2026-09-02T09:00:00Z', permalink: '/two/' }),
      'posts/2026-09-01-three.md': post('Three', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/three/',
      }),
      'posts/2026-09-04-draft.md': post('Secret Draft', {
        date: '2026-08-04T09:00:00Z',
        permalink: '/draft/',
        draft: true,
      }),
      '_trash/posts/2026-09-05-gone.md': post('Thrown Away', {
        date: '2026-08-05T09:00:00Z',
        permalink: '/gone/',
      }),
      'pages/about.md': `---\ntitle: About\npermalink: /about/\n---\n\nA page.\n`,
    });

    const { channel } = await rss(cms, '/feed/');

    assert.deepEqual(
      childrenNamed(channel, 'item').map((item) => child(item, 'title').text),
      ['One', 'Two'],
    );
  });

  it('leaves out a post whose date has not arrived, in all three formats', async () => {
    let now = new Date('2026-09-03T12:00:00Z');
    const { cms } = await site(
      {
        'posts/2026-09-03-live.md': post('Live', {
          date: '2026-09-03T09:00:00Z',
          permalink: '/live/',
        }),
        'posts/2026-09-04-tomorrow.md': post('Tomorrow', {
          date: '2026-09-04T09:00:00Z',
          permalink: '/tomorrow/',
        }),
      },
      { now: () => now },
    );

    const { channel } = await rss(cms, '/feed/');
    assert.deepEqual(
      childrenNamed(channel, 'item').map((item) => child(item, 'title').text),
      ['Live'],
    );
    assert.ok(!(await (await cms.app.request('/feed/atom/')).text()).includes('Tomorrow'));
    assert.ok(!(await (await cms.app.request('/feed/json/')).text()).includes('Tomorrow'));

    now = new Date('2026-09-04T09:00:00Z');

    const after = await rss(cms, '/feed/');
    assert.deepEqual(
      childrenNamed(after.channel, 'item').map((item) => child(item, 'title').text),
      ['Tomorrow', 'Live'],
    );
  });

  it('leaves out the image when the site has no avatar', async () => {
    const { cms } = await site({
      'posts/2026-09-02-one.md': post('One', { date: '2026-09-02T09:00:00Z', permalink: '/one/' }),
    });

    const { channel } = await rss(cms, '/feed/');

    assert.equal(childrenNamed(channel, 'image').length, 0);
    // The channel still has a description, empty, because RSS requires one.
    assert.equal(child(channel, 'description').text, '');
    assert.equal(child(channel, 'language').text, 'en');
  });
});

describe('the Atom feed', () => {
  it('serves a well-formed Atom document describing the site', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({
        title: 'Geekity Demo',
        tagline: 'A file-first site',
      }),
      'posts/2026-09-02-hello.md': post('Hello, World!', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hello/',
      }),
    });

    const { response, feed } = await atom(cms, '/feed/atom/');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/atom+xml; charset=utf-8');

    assert.equal(feed.name, 'feed');
    assert.equal(feed.attributes['xmlns'], 'http://www.w3.org/2005/Atom');
    assert.equal(child(feed, 'id').text, 'https://example.com/');
    assert.equal(child(feed, 'title').text, 'Geekity Demo');
    assert.equal(child(feed, 'subtitle').text, 'A file-first site');
    assert.equal(child(feed, 'updated').text, '2026-09-02T09:00:00.000Z');
    assert.equal(child(child(feed, 'author'), 'name').text, 'Geekity Demo');
    assert.equal(linkWithRel(feed, 'self').attributes['href'], 'https://example.com/feed/atom/');
    assert.equal(linkWithRel(feed, 'self').attributes['type'], 'application/atom+xml');
    assert.equal(linkWithRel(feed, 'alternate').attributes['href'], 'https://example.com/');
    assert.equal(linkWithRel(feed, 'alternate').attributes['type'], 'text/html');
    assert.ok(child(feed, 'generator').text.length > 0, 'the feed names its generator');
  });

  it('carries one entry per published post, newest first, with full HTML content', async () => {
    const { cms } = await site({
      'posts/2026-09-02-newer.md': post('Newer', {
        date: '2026-09-02T09:00:00Z',
        updated: '2026-09-03T12:00:00Z',
        permalink: '/2026/09/newer/',
        tags: ['introductions', 'meta'],
        categories: ['engineering'],
        description: 'A short summary.',
        author: 'Andrew Shell',
        body: 'A *file-first* CMS & proud of it.',
      }),
      'posts/2026-08-15-older.md': post('Older', {
        date: '2026-08-15T09:00:00Z',
        permalink: '/2026/08/older/',
        body: 'Nothing much to say.',
      }),
    });

    const { feed } = await atom(cms, '/feed/atom/');
    const entries = childrenNamed(feed, 'entry');

    assert.equal(entries.length, 2);
    const [newer, older] = entries as [XmlElement, XmlElement];

    assert.equal(child(newer, 'title').text, 'Newer');
    assert.equal(child(older, 'title').text, 'Older');

    assert.equal(child(newer, 'id').text, 'https://example.com/2026/09/newer/');
    assert.equal(
      linkWithRel(newer, 'alternate').attributes['href'],
      'https://example.com/2026/09/newer/',
    );
    assert.equal(linkWithRel(newer, 'alternate').attributes['type'], 'text/html');

    assert.equal(child(newer, 'published').text, '2026-09-02T09:00:00.000Z');
    assert.equal(child(newer, 'updated').text, '2026-09-03T12:00:00.000Z');
    assert.equal(child(child(newer, 'author'), 'name').text, 'Andrew Shell');
    assert.equal(child(newer, 'summary').text, 'A short summary.');

    // Categories and then tags, the same terms RSS lists (decision-12).
    assert.deepEqual(
      childrenNamed(newer, 'category').map((category) => category.attributes['term']),
      ['engineering', 'introductions', 'meta'],
    );

    const content = child(newer, 'content');
    assert.equal(content.attributes['type'], 'html');
    // The markup is escaped, so the parser sees one text node, not elements.
    assert.equal(content.children.length, 0);
    assert.equal(content.text.trim(), '<p>A <em>file-first</em> CMS &amp; proud of it.</p>');

    // A post that wrote no description is summarised all the same, by the same
    // rule RSS has always used: an excerpt of the rendered body.
    assert.equal(child(older, 'summary').text, 'Nothing much to say.');
  });

  it('leaves out drafts, trashed documents and pages', async () => {
    const { cms } = await site({
      'posts/2026-09-02-live.md': post('Live', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/live/',
      }),
      'posts/2026-09-01-draft.md': post('Secret Draft', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/2026/09/draft/',
        draft: true,
      }),
      '_trash/posts/2026-08-30-gone.md': post('Thrown Away', {
        date: '2026-08-30T09:00:00Z',
        permalink: '/2026/08/gone/',
      }),
      'pages/about.md': `---\ntitle: About This Site\npermalink: /about/\n---\n\nA page.\n`,
    });

    const { feed } = await atom(cms, '/feed/atom/');
    const titles = childrenNamed(feed, 'entry').map((entry) => child(entry, 'title').text);

    assert.deepEqual(titles, ['Live']);
  });

  it('stops at the feed size the site data asks for', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'Short', postsPerPage: 1, feedSize: 2 }),
      'posts/one.md': post('One', { date: '2026-09-03T09:00:00Z', permalink: '/one/' }),
      'posts/two.md': post('Two', { date: '2026-09-02T09:00:00Z', permalink: '/two/' }),
      'posts/three.md': post('Three', { date: '2026-09-01T09:00:00Z', permalink: '/three/' }),
    });

    const { feed } = await atom(cms, '/feed/atom/');
    const titles = childrenNamed(feed, 'entry').map((entry) => child(entry, 'title').text);

    // `feedSize` wins over `postsPerPage`: a feed is not an archive page.
    assert.deepEqual(titles, ['One', 'Two']);
  });

  it('escapes markup and ampersands in titles, tags and bodies', async () => {
    const { cms } = await site({
      'posts/2026-09-02-hostile.md': post('"Angle < brackets" & ampersands', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hostile/',
        tags: ['<script>'],
        description: 'Fish & chips <b>now</b>',
        body: 'Text with <span>markup</span> & an ampersand.\n\n<!-- ]]> -->',
      }),
    });

    const response = await cms.app.request('/feed/atom/');
    const body = await response.text();

    // Parsing is the assertion: the reader below rejects a bare `<` or `&`.
    const feed = parseXml(body);
    const entry = child(feed, 'entry');

    assert.equal(child(entry, 'title').text, '"Angle < brackets" & ampersands');
    assert.equal(child(entry, 'category').attributes['term'], '<script>');
    assert.equal(child(entry, 'summary').text, 'Fish & chips <b>now</b>');
    assert.ok(
      child(entry, 'content').text.includes('<span>markup</span> &amp; an ampersand'),
      'the entry carries the rendered HTML as text',
    );
    assert.ok(!body.includes('<script>'), 'no unescaped markup reaches the document');
  });
});

/** A JSON Feed at a URL, parsed, with the 1.1 requirements checked. */
async function jsonFeedAt(
  cms: Cms,
  url: string,
): Promise<{
  response: Response;
  feed: Record<string, unknown>;
  items: Record<string, unknown>[];
}> {
  const response = await cms.app.request(url);
  const parsed: unknown = JSON.parse(await response.text());

  assert.ok(
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed),
    'a JSON Feed is a JSON object',
  );
  const feed = parsed as Record<string, unknown>;

  // https://www.jsonfeed.org/version/1.1/ : `version` and `title` are the two
  // required top-level values, and every item needs a unique `id`.
  assert.equal(feed['version'], 'https://jsonfeed.org/version/1.1');
  assert.equal(typeof feed['title'], 'string');
  assert.ok(Array.isArray(feed['items']), 'items is an array');

  const items = feed['items'] as Record<string, unknown>[];
  const ids = items.map((item) => item['id']);
  for (const id of ids) assert.equal(typeof id, 'string', 'every item has a string id');
  assert.equal(new Set(ids).size, ids.length, 'item ids are unique');

  return { response, feed, items };
}

describe('the JSON feed', () => {
  it('serves a JSON Feed 1.1 document describing the site', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({
        title: 'Geekity Demo',
        tagline: 'A file-first site',
      }),
      'posts/2026-09-02-hello.md': post('Hello, World!', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hello/',
      }),
    });

    const { response, feed } = await jsonFeedAt(cms, '/feed/json/');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/feed+json; charset=utf-8');

    assert.equal(feed['title'], 'Geekity Demo');
    assert.equal(feed['home_page_url'], 'https://example.com/');
    assert.equal(feed['feed_url'], 'https://example.com/feed/json/');
    assert.equal(feed['description'], 'A file-first site');
    assert.deepEqual(feed['authors'], [{ name: 'Geekity Demo' }]);
  });

  it('carries the same entries as the Atom feed, newest first', async () => {
    const files = {
      'posts/2026-09-02-newer.md': post('Newer', {
        date: '2026-09-02T09:00:00Z',
        updated: '2026-09-03T12:00:00Z',
        permalink: '/2026/09/newer/',
        tags: ['introductions', 'meta'],
        categories: ['engineering'],
        description: 'A short summary.',
        author: 'Andrew Shell',
        body: 'A *file-first* CMS & proud of it.',
      }),
      'posts/2026-08-15-older.md': post('Older', {
        date: '2026-08-15T09:00:00Z',
        permalink: '/2026/08/older/',
        body: 'Nothing much to say.',
      }),
      'posts/2026-09-01-draft.md': post('Secret Draft', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/2026/09/draft/',
        draft: true,
      }),
    };

    const { cms } = await site(files);
    const { items } = await jsonFeedAt(cms, '/feed/json/');
    const { feed: atomDocument } = await atom(cms, '/feed/atom/');

    assert.deepEqual(
      items.map((item) => item['title']),
      ['Newer', 'Older'],
    );
    assert.deepEqual(
      items.map((item) => item['id']),
      childrenNamed(atomDocument, 'entry').map((entry) => child(entry, 'id').text),
      'the two feeds agree on which entries exist and what identifies them',
    );

    const [newer, older] = items as [Record<string, unknown>, Record<string, unknown>];

    assert.equal(newer['id'], 'https://example.com/2026/09/newer/');
    assert.equal(newer['url'], 'https://example.com/2026/09/newer/');
    assert.equal(
      String(newer['content_html']).trim(),
      '<p>A <em>file-first</em> CMS &amp; proud of it.</p>',
    );
    assert.equal(newer['summary'], 'A short summary.');
    assert.equal(newer['date_published'], '2026-09-02T09:00:00.000Z');
    assert.equal(newer['date_modified'], '2026-09-03T12:00:00.000Z');
    // Categories and then tags, the same terms the other two formats list.
    assert.deepEqual(newer['tags'], ['engineering', 'introductions', 'meta']);
    assert.deepEqual(newer['authors'], [{ name: 'Andrew Shell' }]);

    // A post that wrote no description is summarised by the same rule as
    // everywhere else, and one filed under nothing carries no `tags` key at
    // all: JSON Feed readers treat absent and empty differently.
    assert.equal(older['summary'], 'Nothing much to say.');
    assert.equal('tags' in older, false);
    assert.equal(older['date_modified'], '2026-08-15T09:00:00.000Z');
  });
});

describe('the three formats over one post', () => {
  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo' }),
    'posts/2026-09-02-hello.md': post('Hello, World!', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/hello/',
      categories: ['engineering', 'notes'],
      tags: ['releases', 'meta'],
      body: 'Fish &amp; chips, twice.\n\nA second paragraph nobody should see.',
    }),
  };

  /** The id, terms and summary each format prints for the one post. */
  async function readings(cms: Cms): Promise<Record<string, unknown>[]> {
    const { channel } = await rss(cms, '/feed/');
    const item = child(channel, 'item');

    const { feed } = await atom(cms, '/feed/atom/');
    const entry = child(feed, 'entry');

    const { items } = await jsonFeedAt(cms, '/feed/json/');
    const json = items[0] as Record<string, unknown>;

    return [
      {
        id: child(item, 'guid').text,
        terms: childrenNamed(item, 'category').map((category) => category.text),
        summary: htmlText(child(item, 'description').text),
      },
      {
        id: child(entry, 'id').text,
        terms: childrenNamed(entry, 'category').map((category) => category.attributes['term']),
        summary: child(entry, 'summary').text,
      },
      { id: json['id'], terms: json['tags'], summary: json['summary'] },
    ];
  }

  it('agree on the post’s id, its terms and its summary', async () => {
    const { cms } = await site(files);
    const [rssReading, atomReading, jsonReading] = await readings(cms);

    // decision-12, all three answers at once. Written out rather than compared
    // to each other so the test says what the answers are, not only that they
    // match.
    const expected = {
      id: 'https://example.com/2026/09/hello/',
      terms: ['engineering', 'notes', 'releases', 'meta'],
      summary: 'Fish & chips, twice.',
    };

    assert.deepEqual(rssReading, expected);
    assert.deepEqual(atomReading, expected);
    assert.deepEqual(jsonReading, expected);
  });

  it('give the post the same validator on every poll', async () => {
    const { cms } = await site(files);

    for (const url of ['/feed/', '/feed/atom/', '/feed/json/']) {
      const first = (await cms.app.request(url)).headers.get('etag');
      const second = (await cms.app.request(url)).headers.get('etag');

      assert.ok(first !== null, `${url} carries a validator`);
      assert.equal(second, first, `${url} keeps it while nothing changes`);
    }
  });
});

describe('a post in another language (TASK-154 AC #3)', () => {
  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo', language: 'en' }),
    'posts/2026-09-02-bonjour.md':
      "---\ntitle: Bonjour\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/bonjour/\nlang: fr\n---\n\nUn billet.\n",
    'posts/2026-09-01-hello.md': post('Hello', {
      date: '2026-09-01T09:00:00Z',
      permalink: '/2026/09/hello/',
    }),
  };

  it('names its language in every format, and the feed’s on the rest', async () => {
    const { cms } = await site(files);

    const { channel } = await rss(cms, '/feed/');
    assert.equal(child(channel, 'language').text, 'en');
    const [frenchItem, englishItem] = childrenNamed(channel, 'item');
    assert.deepEqual(
      childrenNamed(frenchItem as XmlElement, 'dc:language').map((element) => element.text),
      ['fr'],
    );
    assert.deepEqual(childrenNamed(englishItem as XmlElement, 'dc:language'), []);

    const { feed } = await atom(cms, '/feed/atom/');
    assert.equal(feed.attributes['xml:lang'], 'en');
    const [frenchEntry, englishEntry] = childrenNamed(feed, 'entry');
    assert.equal(frenchEntry?.attributes['xml:lang'], 'fr');
    assert.equal(englishEntry?.attributes['xml:lang'], undefined);

    const { feed: json, items } = await jsonFeedAt(cms, '/feed/json/');
    assert.equal(json['language'], 'en');
    assert.equal((items[0] as Record<string, unknown>)['language'], 'fr');
    assert.equal('language' in (items[1] as Record<string, unknown>), false);
  });
});

describe('the taxonomy feeds', () => {
  const filed = {
    'posts/2026-09-02-one.md': post('Tagged and Filed', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/one/',
      tags: ['releases'],
      categories: ['engineering'],
    }),
    'posts/2026-09-01-two.md': post('Neither', {
      date: '2026-09-01T09:00:00Z',
      permalink: '/two/',
    }),
  };

  it('serve every archive in all three formats under the configured bases', async () => {
    const { cms } = await site({
      ...filed,
      '_data/site.json': JSON.stringify({
        title: 'Bases',
        tagBase: 'topics',
        categoryBase: 'filed-under',
      }),
    });

    for (const root of ['/topics/releases/', '/filed-under/engineering/']) {
      const { response, channel } = await rss(cms, `${root}feed/`);
      assert.equal(response.status, 200, `${root}feed/`);
      assert.equal(child(channel, 'link').text, `https://example.com${root}`);
      assert.equal(
        atomLinkWithRel(channel, 'self').attributes['href'],
        `https://example.com${root}feed/`,
      );
      assert.deepEqual(
        childrenNamed(channel, 'item').map((item) => child(item, 'title').text),
        ['Tagged and Filed'],
      );

      const { response: atomResponse, feed } = await atom(cms, `${root}feed/atom/`);
      assert.equal(atomResponse.status, 200, `${root}feed/atom/`);
      assert.equal(
        linkWithRel(feed, 'self').attributes['href'],
        `https://example.com${root}feed/atom/`,
      );

      const { response: jsonResponse, feed: jsonDocument } = await jsonFeedAt(
        cms,
        `${root}feed/json/`,
      );
      assert.equal(jsonResponse.status, 200, `${root}feed/json/`);
      assert.equal(jsonDocument['feed_url'], `https://example.com${root}feed/json/`);
    }
  });

  it('404 a term nothing published carries, in every format', async () => {
    const { cms } = await site(filed);

    for (const url of [
      '/tag/nothing/feed/',
      '/tag/nothing/feed/atom/',
      '/category/nothing/feed/json/',
      '/category/releases/feed/',
    ]) {
      assert.equal((await cms.app.request(url)).status, 404, url);
    }
  });
});

describe('the migrated feed URLs', () => {
  const files = {
    'posts/2026-09-02-one.md': post('One', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/one/',
      tags: ['releases'],
      categories: ['engineering'],
    }),
  };

  /** Where a URL redirects to, asserting that it is a permanent redirect. */
  async function movedTo(cms: Cms, url: string): Promise<string | null> {
    const response = await cms.app.request(url);
    assert.equal(response.status, 301, url);
    return response.headers.get('location');
  }

  it('redirect the unslashed forms to their canonical slashed ones', async () => {
    const { cms } = await site(files);

    assert.equal(await movedTo(cms, '/feed'), '/feed/');
    assert.equal(await movedTo(cms, '/feed/atom'), '/feed/atom/');
    assert.equal(await movedTo(cms, '/feed/json'), '/feed/json/');
    assert.equal(await movedTo(cms, '/tag/releases/feed'), '/tag/releases/feed/');
    assert.equal(
      await movedTo(cms, '/category/engineering/feed/json'),
      '/category/engineering/feed/json/',
    );
  });

  it('redirect the older spellings a migrated site was also served at', async () => {
    const { cms } = await site(files);

    // `/feed/rss/` was WordPress's RSS 0.92; this site answers RSS 2.0 there.
    assert.equal(await movedTo(cms, '/feed/rss/'), '/feed/');
    assert.equal(await movedTo(cms, '/feed/rss'), '/feed/');
    assert.equal(await movedTo(cms, '/tag/releases/feed/rss/'), '/tag/releases/feed/');
  });

  it('redirect the query forms that predate the pretty URLs', async () => {
    const { cms } = await site(files);

    assert.equal(await movedTo(cms, '/?feed=rss2'), '/feed/');
    assert.equal(await movedTo(cms, '/?feed=rss'), '/feed/');
    assert.equal(await movedTo(cms, '/?feed=atom'), '/feed/atom/');
    assert.equal(await movedTo(cms, '/?feed=json'), '/feed/json/');
    assert.equal(await movedTo(cms, '/tag/releases/?feed=rss2'), '/tag/releases/feed/');
    assert.equal(
      await movedTo(cms, '/category/engineering/?feed=atom'),
      '/category/engineering/feed/atom/',
    );
  });

  it('404 the paths the old feeds used to answer on', async () => {
    const { cms } = await site(files);

    for (const url of ['/feed.xml', '/feed.json', '/tag/releases/feed.xml']) {
      assert.equal((await cms.app.request(url)).status, 404, url);
    }
  });

  it('do not redirect a feed for a term nothing published carries', async () => {
    const { cms } = await site(files);

    // One 404, not a redirect and then a 404.
    assert.equal((await cms.app.request('/tag/nothing/feed')).status, 404);
  });
});

describe('a tag feed', () => {
  const tagged = {
    'posts/2026-09-02-one.md': post('Tagged One', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/one/',
      tags: ['releases'],
    }),
    'posts/2026-09-01-two.md': post('Untagged Two', {
      date: '2026-09-01T09:00:00Z',
      permalink: '/two/',
    }),
    'posts/2026-08-31-three.md': post('Tagged Three', {
      date: '2026-08-31T09:00:00Z',
      permalink: '/three/',
      tags: ['releases'],
      draft: true,
    }),
  };

  it('holds only what carries the tag, in Atom', async () => {
    const { cms } = await site(tagged, { baseUrl: 'https://example.com' });

    const { response, feed } = await atom(cms, '/tag/releases/feed/atom/');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/atom+xml; charset=utf-8');
    assert.equal(child(feed, 'id').text, 'https://example.com/tag/releases/');
    assert.equal(
      linkWithRel(feed, 'self').attributes['href'],
      'https://example.com/tag/releases/feed/atom/',
    );
    assert.equal(
      linkWithRel(feed, 'alternate').attributes['href'],
      'https://example.com/tag/releases/',
    );
    assert.ok(child(feed, 'title').text.includes('releases'), 'the feed title names the tag');

    assert.deepEqual(
      childrenNamed(feed, 'entry').map((entry) => child(entry, 'title').text),
      ['Tagged One'],
    );
  });

  it('holds only what carries the tag, in JSON', async () => {
    const { cms } = await site(tagged);

    const { response, feed, items } = await jsonFeedAt(cms, '/tag/releases/feed/json/');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/feed+json; charset=utf-8');
    assert.equal(feed['home_page_url'], 'https://example.com/tag/releases/');
    assert.equal(feed['feed_url'], 'https://example.com/tag/releases/feed/json/');
    assert.deepEqual(
      items.map((item) => item['title']),
      ['Tagged One'],
    );
  });

  it('404s a tag nothing published carries', async () => {
    const { cms } = await site(tagged);

    for (const url of ['/tag/nothing/feed/atom/', '/tag/nothing/feed/json/']) {
      const response = await cms.app.request(url);
      assert.equal(response.status, 404, url);
    }

    // A tag only a draft carries is a tag the public site does not have.
    const draftOnly = await cms.app.request('/tag/releases/feed/atom/');
    assert.equal(draftOnly.status, 200);
  });

  it('serves a tag whose name needs escaping in the URL', async () => {
    const { cms } = await site({
      'posts/2026-09-02-one.md': post('Spaced', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/spaced/',
        tags: ['book notes'],
      }),
    });

    const { response, feed } = await atom(cms, '/tag/book%20notes/feed/atom/');

    assert.equal(response.status, 200);
    assert.equal(
      linkWithRel(feed, 'self').attributes['href'],
      'https://example.com/tag/book%20notes/feed/atom/',
    );
    assert.deepEqual(
      childrenNamed(feed, 'entry').map((entry) => child(entry, 'title').text),
      ['Spaced'],
    );
  });
});

describe('a reply in the feeds', () => {
  const TARGET = 'https://remote.example/notes/1';

  const files = {
    'posts/2026-09-03-reply.md': post('', {
      date: '2026-09-03T09:00:00Z',
      permalink: '/2026/09/reply/',
      inReplyTo: TARGET,
      body: 'Agreed, and then some.',
    }),
    'posts/2026-09-02-invalid.md': post('', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/invalid/',
      inReplyTo: 'not a url',
      body: 'An answer to nothing a reader can follow.',
    }),
    'posts/2026-09-01-standalone.md': post('Standalone', {
      date: '2026-09-01T09:00:00Z',
      permalink: '/2026/09/standalone/',
    }),
  };

  it('names its target in Atom, under the declared threading namespace', async () => {
    const { cms } = await site(files);
    const { feed } = await atom(cms, '/feed/atom/');

    assert.equal(feed.attributes['xmlns:thr'], 'http://purl.org/syndication/thread/1.0');

    const [reply, invalid, standalone] = childrenNamed(feed, 'entry') as [
      XmlElement,
      XmlElement,
      XmlElement,
    ];
    const target = childrenNamed(reply, 'thr:in-reply-to');
    assert.equal(target.length, 1);
    assert.deepEqual(target[0]?.attributes, { ref: TARGET, href: TARGET });

    assert.deepEqual(childrenNamed(invalid, 'thr:in-reply-to'), []);
    assert.deepEqual(childrenNamed(standalone, 'thr:in-reply-to'), []);
  });

  it('names its target in JSON Feed’s _geekity extension', async () => {
    const { cms } = await site(files);
    const { items } = await jsonFeedAt(cms, '/feed/json/');

    const [reply, invalid, standalone] = items as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    assert.deepEqual(reply['_geekity'], { in_reply_to: TARGET });
    assert.equal('_geekity' in invalid, false);
    assert.equal('_geekity' in standalone, false);
  });

  it('leaves RSS as it was: no threading namespace and no reply element', async () => {
    const { cms } = await site(files);
    const { body } = await rss(cms, '/feed/');

    assert.equal(body.includes('purl.org/syndication/thread'), false);
    assert.equal(body.includes('<thr:'), false);
    const line = `<p class="cite-line">In reply to <a href="${TARGET}">a page on ${new URL(TARGET).hostname}</a></p>`;
    assert.ok(body.includes(line), 'the post’s HTML names its target (TASK-252)');
    assert.equal(body.replaceAll(line, '').includes(TARGET), false);
  });
});

describe('an RSVP in the feeds (TASK-198)', () => {
  const EVENT = 'https://events.example/2026/10/indieweb-camp';

  it('opens its HTML with what its author will do and the p-rsvp', async () => {
    const { cms } = await site({
      '_data/replyContexts.json': JSON.stringify({ [EVENT]: { name: 'IndieWeb Camp' } }),
      'posts/2026-09-03-camp.md': [
        '---',
        "date: '2026-09-03T09:00:00Z'",
        'permalink: /2026/09/camp/',
        `in-reply-to: ${EVENT}`,
        'rsvp: no',
        '---',
        '',
        'Clashes with a wedding.',
        '',
      ].join('\n'),
    });
    const { items } = await jsonFeedAt(cms, '/feed/json/');

    assert.equal(
      items[0]?.['content_html'],
      `<p class="cite-line">Not going to <a href="${EVENT}">IndieWeb Camp</a></p>\n` +
        '<p class="rsvp-line"><data class="p-rsvp" value="no">Not going</data></p>\n' +
        '<p>Clashes with a wedding.</p>\n',
    );
  });
});

describe('feed caching', () => {
  const files = {
    'posts/2026-09-02-one.md': post('One', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/one/',
      tags: ['releases'],
    }),
  };

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const { cms } = await site(files);

    for (const url of ['/feed/atom/', '/feed/json/', '/tag/releases/feed/atom/']) {
      const first = await cms.app.request(url);
      const etag = first.headers.get('etag');

      assert.ok(etag !== null && etag.startsWith('"'), `${url} carries a strong ETag`);
      assert.equal(first.headers.get('last-modified'), 'Wed, 02 Sep 2026 09:00:00 GMT');
      assert.equal(first.headers.get('cache-control'), 'no-cache');

      const second = await cms.app.request(url, { headers: { 'if-none-match': etag } });

      assert.equal(second.status, 304, `${url} revalidates`);
      assert.equal(await second.text(), '');
      assert.equal(second.headers.get('etag'), etag);
    }
  });

  it('answers a fresh If-Modified-Since with 304', async () => {
    const { cms } = await site(files);

    const response = await cms.app.request('/feed/json/', {
      headers: { 'if-modified-since': 'Wed, 02 Sep 2026 09:00:00 GMT' },
    });

    assert.equal(response.status, 304);
  });

  it('gives the two formats and the two scopes different validators', async () => {
    const { cms } = await site(files);

    const etags = await Promise.all(
      ['/feed/atom/', '/feed/json/', '/tag/releases/feed/atom/', '/tag/releases/feed/json/'].map(
        async (url) => (await cms.app.request(url)).headers.get('etag'),
      ),
    );

    assert.equal(new Set(etags).size, etags.length, 'no two feeds share an ETag');
  });

  it('changes the validator when the content changes', async () => {
    const { cms, contentDir } = await site(files);

    const before = (await cms.app.request('/feed/atom/')).headers.get('etag');

    await writeTree(contentDir, {
      'posts/2026-09-03-two.md': post('Two', {
        date: '2026-09-03T09:00:00Z',
        permalink: '/two/',
      }),
    });
    await cms.sync();

    const after = await cms.app.request('/feed/atom/');

    assert.notEqual(after.headers.get('etag'), before);
    assert.equal(after.status, 200);
  });
});

describe('the HTML pages', () => {
  const files = {
    'posts/2026-09-02-one.md': post('One', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/one/',
      tags: ['releases'],
    }),
    'pages/about.md': `---\ntitle: About\npermalink: /about/\n---\n\nA page.\n`,
  };

  it('advertise all three feeds with link rel=alternate, RSS first', async () => {
    const { cms } = await site({
      ...files,
      'posts/2026-09-01-filed.md': post('Filed', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/filed/',
        categories: ['engineering'],
      }),
    });

    for (const url of ['/', '/one/', '/about/', '/tag/releases/', '/category/engineering/']) {
      const html = await (await cms.app.request(url)).text();
      const head = html.slice(0, html.indexOf('</head>'));

      const rssAt = head.indexOf('type="application/rss+xml"');
      const atomAt = head.indexOf('type="application/atom+xml"');
      const jsonAt = head.indexOf('type="application/feed+json"');

      assert.ok(rssAt >= 0 && head.includes('href="/feed/"'), `${url} advertises the RSS feed`);
      assert.ok(
        atomAt >= 0 && head.includes('href="/feed/atom/"'),
        `${url} advertises the Atom feed`,
      );
      assert.ok(
        jsonAt >= 0 && head.includes('href="/feed/json/"'),
        `${url} advertises the JSON feed`,
      );
      assert.ok(rssAt < atomAt && atomAt < jsonAt, `${url} lists RSS first`);
    }
  });

  it('keep the ActivityStreams alternate on a post page', async () => {
    const { cms } = await site(files);

    const html = await (await cms.app.request('/one/')).text();
    const head = html.slice(0, html.indexOf('</head>'));

    assert.ok(
      head.includes(
        '<link rel="alternate" type="application/activity+json" href="https://example.com/one/">',
      ),
      'the post still advertises its ActivityStreams object',
    );
  });

  it("advertise an archive's own feeds as well as the site's", async () => {
    const { cms } = await site({
      ...files,
      'posts/2026-09-01-filed.md': post('Filed', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/filed/',
        categories: ['engineering'],
      }),
    });

    for (const [archive, root] of [
      ['/tag/releases/', '/tag/releases/'],
      ['/category/engineering/', '/category/engineering/'],
    ] as const) {
      const html = await (await cms.app.request(archive)).text();
      const head = html.slice(0, html.indexOf('</head>'));

      for (const suffix of ['feed/', 'feed/atom/', 'feed/json/']) {
        assert.ok(head.includes(`href="${root}${suffix}"`), `${archive} advertises ${suffix}`);
      }
      assert.ok(head.includes('href="/feed/"'), `${archive} keeps the whole-site RSS feed`);
    }
  });

  it('prefix the feed links with the base path when the site lives in a subdirectory', async () => {
    const { cms } = await site(files, { baseUrl: 'https://example.com/blog' });

    const html = await (await cms.app.request('/')).text();

    assert.ok(html.includes('href="/blog/feed/"'), 'the RSS link carries the base path');
    assert.ok(html.includes('href="/blog/feed/atom/"'), 'the Atom link carries the base path');
    assert.ok(html.includes('href="/blog/feed/json/"'), 'the JSON link carries the base path');
  });
});

/* -------------------------------------------------------------------------- */
/* Comments: the replies the inbox logged, as feeds.                          */
/* -------------------------------------------------------------------------- */

/** What a reply looks like when the inbox has finished with it. */
interface ReplyOptions {
  /** The post's ActivityStreams object id, which the note answers. */
  inReplyTo: string;
  /** The note's own id, and the activity's by extension. */
  id?: string;
  /** Who wrote it. */
  actor?: string;
  /** The note's content, as the remote server rendered it. */
  content?: string;
  /** When the note says it was published. */
  published?: string;
  /** Where the note can be read on its own server. */
  url?: string;
}

/**
 * Log one reply the way the inbox logs one: a compacted `Create` of a `Note`.
 *
 * The bytes are the shape Fedify writes — checked against a round trip through
 * `Create#toJsonLd({ format: 'compact' })` — so the feeds are read out of what
 * a real delivery leaves behind rather than out of a shape invented here.
 */
function reply(cms: Cms, options: ReplyOptions): void {
  const id = options.id ?? 'https://remote.example/notes/1';
  const actor = options.actor ?? 'https://remote.example/users/ada';
  const object: Record<string, unknown> = {
    id,
    type: 'Note',
    attributedTo: actor,
    content: options.content ?? '<p>Good post.</p>',
    inReplyTo: options.inReplyTo,
    ...(options.published === undefined ? {} : { published: options.published }),
    ...(options.url === undefined ? {} : { url: options.url }),
  };

  cms.admin.logInboxActivity({
    activityId: `${id}/activity`,
    activityType: 'Create',
    actorId: actor,
    objectId: id,
    json: JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${id}/activity`,
      type: 'Create',
      actor,
      object,
    }),
  });
}

describe('a reply to a migrated post’s stored object id', () => {
  /** The post as WordPress left it: announced under `?p=813` long ago. */
  const MIGRATED = 'https://example.com/?p=813';

  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo' }),
    'posts/2011-06-06-old-news.md': [
      '---',
      'title: Old news',
      "date: '2011-06-06T09:00:00Z'",
      'permalink: /2011/06/old-news/',
      'activitypub:',
      `  id: '${MIGRATED}'`,
      "  published: '2011-06-06T09:00:00Z'",
      '---',
      '',
      'Body.',
      '',
    ].join('\n'),
  };

  it('reaches the post’s comments feed, the site feed and its source:comments count', async () => {
    const { cms } = await site(files);
    reply(cms, { inReplyTo: MIGRATED, id: 'https://remote.example/notes/1' });

    // The post's own comments feed, which is keyed by the object id.
    const own = await rss(cms, '/2011/06/old-news/feed/');
    assert.deepEqual(
      childrenNamed(own.channel, 'item').map((item) => child(item, 'guid').text),
      ['https://remote.example/notes/1'],
    );

    // The site-wide one, which resolves the id back to the post it names.
    const siteWide = await rss(cms, '/comments/feed/');
    assert.deepEqual(
      childrenNamed(siteWide.channel, 'item').map((item) => child(item, 'title').text),
      ['@ada@remote.example on Old news'],
    );

    // And the count the post feed advertises, which is the same walk again.
    const posts = await rss(cms, '/feed/');
    const item = childrenNamed(posts.channel, 'item')[0] as XmlElement;
    assert.equal(child(item, 'source:comments').attributes['count'], '1');
    // decision-12: the guid is the object id, which here is the stored one, so
    // the migrated post's RSS subscribers see nothing new.
    assert.equal(child(item, 'guid').text, MIGRATED);
  });

  it('is named by its stored id in all three formats, and still read at its permalink', async () => {
    const { cms } = await site(files);
    const permalink = 'https://example.com/2011/06/old-news/';

    // RSS: the guid WordPress's own feed gave the post, marked a name rather
    // than an address because that is what it is.
    const { channel } = await rss(cms, '/feed/');
    const item = child(channel, 'item');
    assert.equal(child(item, 'guid').text, MIGRATED);
    assert.equal(child(item, 'guid').attributes['isPermaLink'], 'false');
    assert.equal(child(item, 'link').text, permalink);

    // Atom: the same id, with the permalink as the alternate link.
    const { feed } = await atom(cms, '/feed/atom/');
    const entry = child(feed, 'entry');
    assert.equal(child(entry, 'id').text, MIGRATED);
    assert.equal(linkWithRel(entry, 'alternate').attributes['href'], permalink);

    // JSON Feed: the same id again, with the permalink as the `url`.
    const { items } = await jsonFeedAt(cms, '/feed/json/');
    assert.equal(items[0]?.['id'], MIGRATED);
    assert.equal(items[0]?.['url'], permalink);
  });

  it('shows the reply in the conversation on the page', async () => {
    const { cms } = await site(files);
    reply(cms, {
      inReplyTo: MIGRATED,
      id: 'https://remote.example/notes/1',
      content: '<p>Still true.</p>',
    });

    const html = await (await cms.app.request('/2011/06/old-news/')).text();

    assert.ok(html.includes('<p>Still true.</p>'), `the reply is on the page: ${html}`);
  });
});

describe('a post’s feed guid (TASK-292)', () => {
  function migrated(slug: string, front: readonly string[]): Record<string, string> {
    return {
      [`posts/2011-06-06-${slug}.md`]: [
        '---',
        `title: ${slug}`,
        "date: '2011-06-06T09:00:00Z'",
        `permalink: /2011/06/${slug}/`,
        ...front,
        '---',
        '',
        'Body.',
        '',
      ].join('\n'),
    };
  }

  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo' }),
    ...migrated('eleventy', [
      "guid: 'https://blog.example.com/essays/eleventy/'",
      'activitypub:',
      "  id: 'https://example.com/?p=609'",
    ]),
    ...migrated('wordcamp', [
      "guid: 'https://example.com/2011/06/wordcamp/'",
      'activitypub:',
      "  id: 'https://example.com/?p=813'",
    ]),
    ...migrated('unfederated', ["guid: 'https://blog.example.com/essays/unfederated/'"]),
    ...migrated('stored', ['activitypub:', "  id: 'https://example.com/?p=42'"]),
    ...migrated('plain', []),
    ...migrated('number', ['guid: 77', 'activitypub:', "  id: 'https://example.com/?p=77'"]),
    ...migrated('words', ["guid: 'not a url'"]),
  };

  const permalink = (slug: string): string => `https://example.com/2011/06/${slug}/`;

  const expected: Record<string, { guid: string; isPermaLink: string }> = {
    eleventy: { guid: 'https://blog.example.com/essays/eleventy/', isPermaLink: 'false' },
    wordcamp: { guid: permalink('wordcamp'), isPermaLink: 'true' },
    unfederated: { guid: 'https://blog.example.com/essays/unfederated/', isPermaLink: 'false' },
    stored: { guid: 'https://example.com/?p=42', isPermaLink: 'false' },
    plain: { guid: permalink('plain'), isPermaLink: 'true' },
    number: { guid: 'https://example.com/?p=77', isPermaLink: 'false' },
    words: { guid: permalink('words'), isPermaLink: 'true' },
  };

  it('names each post by its guid key, else its activitypub.id, else its permalink', async () => {
    const { cms } = await site(files);

    const { channel } = await rss(cms, '/feed/');
    const rssItems = childrenNamed(channel, 'item');
    const { feed } = await atom(cms, '/feed/atom/');
    const entries = childrenNamed(feed, 'entry');
    const { items } = await jsonFeedAt(cms, '/feed/json/');
    assert.equal(rssItems.length, Object.keys(expected).length);

    for (const [slug, { guid, isPermaLink }] of Object.entries(expected)) {
      const item = rssItems.find((each) => child(each, 'link').text === permalink(slug));
      assert.ok(item !== undefined, `${slug} is in the RSS feed`);
      assert.equal(child(item, 'guid').text, guid, `${slug}'s RSS guid`);
      assert.equal(
        child(item, 'guid').attributes['isPermaLink'],
        isPermaLink,
        `${slug}'s isPermaLink`,
      );

      const entry = entries.find(
        (each) => linkWithRel(each, 'alternate').attributes['href'] === permalink(slug),
      );
      assert.ok(entry !== undefined, `${slug} is in the Atom feed`);
      assert.equal(child(entry, 'id').text, guid, `${slug}'s Atom id`);

      const jsonItem = items.find((each) => each['url'] === permalink(slug));
      assert.equal(jsonItem?.['id'], guid, `${slug}'s JSON Feed id`);
    }
  });
});

describe('a post’s comments feed', () => {
  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo', tagline: 'A file-first site' }),
    'posts/2026-09-02-hello.md': post('Hello, World!', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/hello/',
    }),
  };

  const HELLO = 'https://example.com/2026/09/hello/';

  it('serves the replies the inbox logged, newest first', async () => {
    const { cms } = await site(files);
    reply(cms, {
      inReplyTo: HELLO,
      id: 'https://remote.example/notes/1',
      content: '<p>Good post.</p>',
      published: '2026-09-02T10:00:00Z',
      url: 'https://remote.example/@ada/1',
    });
    reply(cms, {
      inReplyTo: HELLO,
      id: 'https://remote.example/notes/2',
      actor: 'https://remote.example/users/bob',
      content: '<p>Agreed.</p>',
      published: '2026-09-02T11:00:00Z',
    });

    const { response, channel } = await rss(cms, '/2026/09/hello/feed/');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
    assert.equal(child(channel, 'title').text, 'Comments on: Hello, World!');
    assert.equal(child(channel, 'link').text, 'https://example.com/2026/09/hello/');
    assert.equal(child(channel, 'description').text, 'A file-first site');
    assert.equal(
      atomLinkWithRel(channel, 'self').attributes['href'],
      'https://example.com/2026/09/hello/feed/',
    );

    const items = childrenNamed(channel, 'item');
    assert.equal(items.length, 2);
    const [newest, oldest] = items as [XmlElement, XmlElement];

    // Newest first, and the name comes from the actor's URL when nothing else
    // is known about them.
    assert.equal(child(newest, 'title').text, '@bob@remote.example');
    assert.equal(child(newest, 'dc:creator').text, '@bob@remote.example');
    // No `url` on the note, so the note's own id is where it can be read.
    assert.equal(child(newest, 'link').text, 'https://remote.example/notes/2');
    assert.equal(child(newest, 'guid').text, 'https://remote.example/notes/2');
    assert.equal(child(newest, 'guid').attributes['isPermaLink'], 'false');
    assert.equal(child(newest, 'pubDate').text, 'Wed, 02 Sep 2026 11:00:00 GMT');

    assert.equal(child(oldest, 'title').text, '@ada@remote.example');
    assert.equal(child(oldest, 'link').text, 'https://remote.example/@ada/1');
    assert.equal(htmlText(child(oldest, 'description').text), 'Good post.');
    assert.equal(child(oldest, 'content:encoded').text, '<p>Good post.</p>');
  });

  it('answers empty rather than 404 when nobody has replied', async () => {
    const { cms } = await site(files);

    const { response, channel } = await rss(cms, '/2026/09/hello/feed/');

    assert.equal(response.status, 200);
    assert.deepEqual(childrenNamed(channel, 'item'), []);
  });

  it('is a 404 for a URL that is no published post', async () => {
    const { cms } = await site({
      ...files,
      'posts/2026-09-01-draft.md': post('Draft', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/2026/09/draft/',
        draft: true,
      }),
      'pages/about.md': `---\ntitle: About\npermalink: /about/\n---\n\nA page.\n`,
    });

    for (const url of ['/2026/09/nothing/feed/', '/2026/09/draft/feed/', '/about/feed/']) {
      assert.equal((await cms.app.request(url)).status, 404, url);
    }
  });

  it('names the reply’s author by the follower it knows, when it knows one', async () => {
    const { cms } = await site(files);
    cms.admin.putFollower({
      username: 'ada',
      actorId: 'https://remote.example/users/ada',
      inboxId: 'https://remote.example/users/ada/inbox',
      sharedInboxId: null,
      handle: '@ada@remote.example',
      name: 'Ada Lovelace',
      iconUrl: null,
      url: null,
    });
    reply(cms, { inReplyTo: HELLO });

    const { channel } = await rss(cms, '/2026/09/hello/feed/');

    assert.equal(child(child(channel, 'item'), 'title').text, 'Ada Lovelace');
  });

  it('sanitises the note before it goes anywhere near a reader', async () => {
    const { cms } = await site(files);
    reply(cms, {
      inReplyTo: HELLO,
      content:
        '<p onclick="steal()">Careful</p><script>alert(1)</script>' +
        '<p><a href="javascript:alert(2)">no</a> <a href="https://ok.test">yes</a></p>',
    });

    const { channel } = await rss(cms, '/2026/09/hello/feed/');
    const encoded = child(child(channel, 'item'), 'content:encoded').text;

    assert.equal(
      encoded,
      '<p>Careful</p><p>no <a href="https://ok.test" rel="nofollow noopener noreferrer">yes</a></p>',
    );
  });
});

describe('the site-wide comments feed', () => {
  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo', tagline: 'A file-first site' }),
    'posts/2026-09-02-hello.md': post('Hello, World!', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/hello/',
    }),
    'posts/2026-09-01-second.md': post('Second Post', {
      date: '2026-09-01T09:00:00Z',
      permalink: '/2026/09/second/',
    }),
  };

  const HELLO = 'https://example.com/2026/09/hello/';
  const SECOND = 'https://example.com/2026/09/second/';

  it('lists the replies to every post, newest first, each naming its post', async () => {
    const { cms } = await site(files);
    reply(cms, {
      inReplyTo: HELLO,
      id: 'https://remote.example/notes/1',
      published: '2026-09-02T10:00:00Z',
    });
    reply(cms, {
      inReplyTo: SECOND,
      id: 'https://remote.example/notes/2',
      actor: 'https://remote.example/users/bob',
      content: '<p>On the other one.</p>',
      published: '2026-09-02T12:00:00Z',
    });

    const { response, channel } = await rss(cms, '/comments/feed/');

    assert.equal(response.status, 200);
    assert.equal(child(channel, 'title').text, 'Geekity Demo: comments');
    assert.equal(child(channel, 'link').text, 'https://example.com/');
    assert.equal(
      atomLinkWithRel(channel, 'self').attributes['href'],
      'https://example.com/comments/feed/',
    );

    assert.deepEqual(
      childrenNamed(channel, 'item').map((item) => child(item, 'title').text),
      ['@bob@remote.example on Second Post', '@ada@remote.example on Hello, World!'],
    );
  });

  it('forgets a reply once its post is a draft or in the trash', async () => {
    const { cms } = await site({
      ...files,
      'posts/2026-08-30-hidden.md': post('Hidden', {
        date: '2026-08-30T09:00:00Z',
        permalink: '/2026/08/hidden/',
        draft: true,
      }),
      '_trash/posts/2026-08-29-gone.md': post('Thrown Away', {
        date: '2026-08-29T09:00:00Z',
        permalink: '/2026/08/gone/',
      }),
    });
    reply(cms, { inReplyTo: HELLO, id: 'https://remote.example/notes/1' });
    reply(cms, {
      inReplyTo: 'https://example.com/2026/08/hidden/',
      id: 'https://remote.example/notes/2',
    });
    reply(cms, {
      inReplyTo: 'https://example.com/2026/08/gone/',
      id: 'https://remote.example/notes/3',
    });

    const { channel } = await rss(cms, '/comments/feed/');

    assert.deepEqual(
      childrenNamed(channel, 'item').map((item) => child(item, 'guid').text),
      ['https://remote.example/notes/1'],
    );
    assert.equal((await cms.app.request('/2026/08/hidden/feed/')).status, 404);
    assert.equal((await cms.app.request('/2026/08/gone/feed/')).status, 404);
  });

  it('ignores a reply to something this site never published', async () => {
    const { cms } = await site(files);
    reply(cms, { inReplyTo: 'https://elsewhere.example/2026/09/hello/' });
    reply(cms, { inReplyTo: 'https://example.com/2026/09/never/', id: 'https://x.test/notes/2' });

    const { channel } = await rss(cms, '/comments/feed/');

    assert.deepEqual(childrenNamed(channel, 'item'), []);
  });

  it('honours feedSize on both comments feeds', async () => {
    const { cms } = await site({
      ...files,
      '_data/site.json': JSON.stringify({ title: 'Geekity Demo', feedSize: 2 }),
    });
    for (const index of [1, 2, 3, 4]) {
      reply(cms, {
        inReplyTo: HELLO,
        id: `https://remote.example/notes/${String(index)}`,
        published: `2026-09-0${String(index)}T10:00:00Z`,
      });
    }

    assert.equal(childrenNamed((await rss(cms, '/comments/feed/')).channel, 'item').length, 2);
    assert.equal(childrenNamed((await rss(cms, '/2026/09/hello/feed/')).channel, 'item').length, 2);
  });

  it('redirects the unslashed and the older spellings in one hop', async () => {
    const { cms } = await site(files);

    for (const [from, to] of [
      ['/comments/feed', '/comments/feed/'],
      ['/comments/feed/rss/', '/comments/feed/'],
      ['/comments/feed/rss', '/comments/feed/'],
      ['/2026/09/hello/feed', '/2026/09/hello/feed/'],
      ['/2026/09/hello/feed/rss/', '/2026/09/hello/feed/'],
      ['/2026/09/hello/?feed=rss2', '/2026/09/hello/feed/'],
    ] as const) {
      const response = await cms.app.request(from);
      assert.equal(response.status, 301, from);
      assert.equal(response.headers.get('location'), to, from);
    }
  });

  it('has no Atom or JSON spelling, at either root', async () => {
    const { cms } = await site(files);

    for (const url of [
      '/comments/feed/atom/',
      '/comments/feed/json/',
      '/comments/',
      '/2026/09/hello/feed/atom/',
      '/2026/09/hello/feed/json/',
    ]) {
      assert.equal((await cms.app.request(url)).status, 404, url);
    }
  });
});

describe('the comment pointers on a post feed', () => {
  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo' }),
    'posts/2026-09-02-hello.md': post('Hello, World!', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/hello/',
      tags: ['releases'],
    }),
    'posts/2026-09-01-quiet.md': post('Quiet', {
      date: '2026-09-01T09:00:00Z',
      permalink: '/2026/09/quiet/',
      tags: ['releases'],
    }),
  };

  const HELLO = 'https://example.com/2026/09/hello/';

  it('points every item at its own comments, counted', async () => {
    const { cms } = await site(files);
    reply(cms, { inReplyTo: HELLO, id: 'https://remote.example/notes/1' });
    reply(cms, { inReplyTo: HELLO, id: 'https://remote.example/notes/2' });

    const { rss: document, channel } = await rss(cms, '/feed/');

    assert.equal(document.attributes['xmlns:wfw'], 'http://wellformedweb.org/CommentAPI/');

    const [hello, quiet] = childrenNamed(channel, 'item') as [XmlElement, XmlElement];

    // WordPress's two, for a reader that already understands its feeds.
    assert.equal(child(hello, 'comments').text, 'https://example.com/2026/09/hello/#comments');
    assert.equal(child(hello, 'wfw:commentRss').text, 'https://example.com/2026/09/hello/feed/');

    // And Dave Winer's, which carries the count as well as the URL.
    const pointer = child(hello, 'source:comments');
    assert.equal(pointer.attributes['count'], '2');
    assert.equal(pointer.attributes['feedUrl'], 'https://example.com/2026/09/hello/feed/');

    // A post nobody answered still says where its comments would be.
    assert.equal(child(quiet, 'source:comments').attributes['count'], '0');
    assert.equal(
      child(quiet, 'source:comments').attributes['feedUrl'],
      'https://example.com/2026/09/quiet/feed/',
    );
  });

  it('counts them on an archive feed too', async () => {
    const { cms } = await site(files);
    reply(cms, { inReplyTo: HELLO });

    const { channel } = await rss(cms, '/tag/releases/feed/');

    assert.equal(
      child(childrenNamed(channel, 'item')[0] as XmlElement, 'source:comments').attributes['count'],
      '1',
    );
  });

  it('changes the feed’s ETag when a reply arrives', async () => {
    const { cms } = await site(files);
    const before = (await cms.app.request('/feed/')).headers.get('etag');

    reply(cms, { inReplyTo: HELLO });

    const after = (await cms.app.request('/feed/')).headers.get('etag');
    assert.notEqual(after, before, 'a new comment count is a new feed');
  });
});

describe('the comments feeds on an HTML page', () => {
  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo' }),
    'posts/2026-09-02-hello.md': post('Hello, World!', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/hello/',
    }),
    'pages/about.md': `---\ntitle: About\npermalink: /about/\n---\n\nA page.\n`,
  };

  it('advertises the site’s comments feed everywhere', async () => {
    const { cms } = await site(files);

    for (const url of ['/', '/2026/09/hello/', '/about/']) {
      const head = (await (await cms.app.request(url)).text()).split('</head>')[0] ?? '';
      assert.ok(head.includes('href="/comments/feed/"'), `${url} advertises the comments feed`);
    }
  });

  it('advertises a post’s own comments feed, and only a post’s', async () => {
    const { cms } = await site(files);

    const post =
      (await (await cms.app.request('/2026/09/hello/')).text()).split('</head>')[0] ?? '';
    assert.ok(
      post.includes(
        '<link rel="alternate" type="application/rss+xml" title="Comments on: Hello, World!" href="/2026/09/hello/feed/">',
      ),
      post,
    );

    const page = (await (await cms.app.request('/about/')).text()).split('</head>')[0] ?? '';
    assert.ok(!page.includes('/about/feed/'), 'a page has no comments feed to advertise');
  });
});

describe('the notify server a feed advertises', () => {
  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo' }),
    'posts/2026-09-02-hello.md': post('Hello, World!', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/hello/',
      tags: ['web'],
    }),
  };

  it('is rpc.rsscloud.io, said three ways, in the RSS channel', async () => {
    const { cms } = await site(files);
    const { channel } = await rss(cms, '/feed/');

    // https://rpc.rsscloud.io/docs/quick-start: the legacy element names the
    // host, port 80 and http-post whatever the server's own scheme is.
    const cloud = child(channel, 'cloud');
    assert.equal(cloud.attributes['domain'], 'rpc.rsscloud.io');
    assert.equal(cloud.attributes['port'], '80');
    assert.equal(cloud.attributes['path'], '/pleaseNotify');
    assert.equal(cloud.attributes['registerProcedure'], '');
    assert.equal(cloud.attributes['protocol'], 'http-post');

    assert.equal(child(channel, 'source:cloud').text, 'https://rpc.rsscloud.io/pleaseNotify');

    const hub = atomLinkWithRel(channel, 'hub');
    assert.equal(hub.attributes['href'], 'https://rpc.rsscloud.io/websub');

    // The self link the hub is written beside is still there and still alone.
    assert.equal(atomLinkWithRel(channel, 'self').attributes['href'], 'https://example.com/feed/');
  });

  it('is the hub and the source cloud in Atom, and no <cloud>', async () => {
    const { cms } = await site(files);
    const { feed } = await atom(cms, '/feed/atom/');

    assert.equal(child(feed, 'source:cloud').text, 'https://rpc.rsscloud.io/pleaseNotify');
    assert.equal(linkWithRel(feed, 'hub').attributes['href'], 'https://rpc.rsscloud.io/websub');
    assert.equal(linkWithRel(feed, 'self').attributes['href'], 'https://example.com/feed/atom/');
    assert.equal(
      childrenNamed(feed, 'cloud').length,
      0,
      'Atom has no place for the legacy element',
    );
  });

  it('is a WebSub hub in the JSON feed, per JSON Feed 1.1', async () => {
    const { cms } = await site(files);
    const body = (await (await cms.app.request('/feed/json/')).json()) as {
      hubs?: { type: string; url: string }[];
    };

    assert.deepEqual(body.hubs, [{ type: 'WebSub', url: 'https://rpc.rsscloud.io/websub' }]);
  });

  it('is a Link header on every feed response, self included', async () => {
    const { cms } = await site({
      ...files,
      'posts/2026-09-02-hello.md': post('Hello, World!', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hello/',
        tags: ['web'],
        categories: ['general'],
      }),
    });

    const feeds = [
      '/feed/',
      '/feed/atom/',
      '/feed/json/',
      '/tag/web/feed/',
      '/tag/web/feed/atom/',
      '/tag/web/feed/json/',
      '/category/general/feed/',
      '/category/general/feed/atom/',
      '/category/general/feed/json/',
      '/comments/feed/',
      '/2026/09/hello/feed/',
    ];

    for (const url of feeds) {
      const response = await cms.app.request(url);
      assert.equal(response.status, 200, `${url} is served`);
      assert.equal(
        response.headers.get('link'),
        `<https://rpc.rsscloud.io/websub>; rel="hub", <https://example.com${url}>; rel="self"`,
        `${url} advertises its hub and itself`,
      );
    }
  });

  it('is on the 304 as well, which is the response a poller usually gets', async () => {
    const { cms } = await site(files);

    const first = await cms.app.request('/feed/');
    const etag = first.headers.get('etag');
    assert.ok(etag !== null, 'the feed carried a validator');

    const second = await cms.app.request('/feed/', { headers: { 'if-none-match': etag } });
    assert.equal(second.status, 304);
    assert.equal(second.headers.get('link'), first.headers.get('link'));
  });

  it('is advertised by a comments feed too, which is a feed like any other', async () => {
    const { cms } = await site(files);
    const { rss: document, channel } = await rss(cms, '/comments/feed/');

    assert.equal(document.attributes['xmlns:source'], 'https://source.scripting.com/');
    assert.equal(child(channel, 'cloud').attributes['domain'], 'rpc.rsscloud.io');
    assert.equal(child(channel, 'source:cloud').text, 'https://rpc.rsscloud.io/pleaseNotify');
    assert.equal(
      atomLinkWithRel(channel, 'hub').attributes['href'],
      'https://rpc.rsscloud.io/websub',
    );
  });

  it('is gone from every feed, in every format, when the setting is emptied', async () => {
    const { cms } = await site(files);
    await setNotifyServer(cms, '');

    const { rss: document, channel } = await rss(cms, '/feed/');
    assert.equal(childrenNamed(channel, 'cloud').length, 0);
    assert.equal(childrenNamed(channel, 'source:cloud').length, 0);
    assert.equal(childrenNamed(channel, 'atom:link').length, 1, 'only the self link is left');
    // The namespace stays declared: it is what `source:markdown` is written in.
    assert.equal(document.attributes['xmlns:source'], 'https://source.scripting.com/');

    const { feed } = await atom(cms, '/feed/atom/');
    assert.equal(childrenNamed(feed, 'source:cloud').length, 0);
    assert.deepEqual(
      childrenNamed(feed, 'link').map((link) => link.attributes['rel']),
      ['self', 'alternate'],
    );

    const json = (await (await cms.app.request('/feed/json/')).json()) as { hubs?: unknown };
    assert.equal(json.hubs, undefined);

    for (const url of ['/feed/', '/feed/atom/', '/feed/json/', '/comments/feed/']) {
      const response = await cms.app.request(url);
      assert.equal(response.headers.get('link'), null, `${url} advertises no hub`);
    }
  });

  it('moves everywhere at once when the setting names another server', async () => {
    const { cms } = await site(files);
    await setNotifyServer(cms, 'https://cloud.example/rpc/');

    const { channel } = await rss(cms, '/feed/');
    const cloud = child(channel, 'cloud');
    assert.equal(cloud.attributes['domain'], 'cloud.example');
    assert.equal(cloud.attributes['path'], '/rpc/pleaseNotify');
    assert.equal(cloud.attributes['port'], '80');
    assert.equal(child(channel, 'source:cloud').text, 'https://cloud.example/rpc/pleaseNotify');
    assert.equal(
      atomLinkWithRel(channel, 'hub').attributes['href'],
      'https://cloud.example/rpc/websub',
    );

    const json = (await (await cms.app.request('/feed/json/')).json()) as {
      hubs?: { type: string; url: string }[];
    };
    assert.deepEqual(json.hubs, [{ type: 'WebSub', url: 'https://cloud.example/rpc/websub' }]);

    assert.equal(
      (await cms.app.request('/feed/atom/')).headers.get('link'),
      '<https://cloud.example/rpc/websub>; rel="hub", ' +
        '<https://example.com/feed/atom/>; rel="self"',
    );
  });

  it('changes a feed’s validator, because a moved hub is a changed feed', async () => {
    const { cms } = await site(files);
    const before = (await cms.app.request('/feed/')).headers.get('etag');

    await setNotifyServer(cms, 'https://cloud.example');
    const after = (await cms.app.request('/feed/')).headers.get('etag');

    assert.ok(before !== null && after !== null);
    assert.notEqual(before, after);
  });
});

describe('the update cadence an RSS feed declares', () => {
  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo' }),
    'posts/2026-09-02-hello.md': post('Hello, World!', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/hello/',
      tags: ['web'],
    }),
  };

  const rssFeeds = ['/feed/', '/tag/web/feed/', '/comments/feed/', '/2026/09/hello/feed/'];

  /** The channel's sy:updatePeriod and sy:updateFrequency, and the namespace. */
  async function cadence(
    cms: Cms,
    url: string,
  ): Promise<{ namespace: string | undefined; period: string; frequency: string }> {
    const { rss: document, channel } = await rss(cms, url);
    assert.equal(childrenNamed(channel, 'sy:updatePeriod').length, 1, `${url} has one period`);
    assert.equal(childrenNamed(channel, 'sy:updateFrequency').length, 1, `${url} has one count`);
    return {
      namespace: document.attributes['xmlns:sy'],
      period: child(channel, 'sy:updatePeriod').text,
      frequency: child(channel, 'sy:updateFrequency').text,
    };
  }

  /** Change the cadence the settings hold. */
  async function setCadence(cms: Cms, period: string, frequency: number): Promise<void> {
    const contentDir = cms.config.contentDir;
    await writeSiteJson({
      contentDir,
      settings: {
        ...readSiteSettings(contentDir),
        feedUpdatePeriod: period as 'daily',
        feedUpdateFrequency: frequency,
      },
    });
  }

  it('is hourly, once, in every RSS feed when the site has not said', async () => {
    const { cms } = await site(files);

    for (const url of rssFeeds) {
      assert.deepEqual(
        await cadence(cms, url),
        {
          namespace: 'http://purl.org/rss/1.0/modules/syndication/',
          period: 'hourly',
          frequency: '1',
        },
        url,
      );
    }
  });

  it('is what the settings say, in every RSS feed', async () => {
    const { cms } = await site(files);
    await setCadence(cms, 'daily', 2);

    for (const url of rssFeeds) {
      const found = await cadence(cms, url);
      assert.equal(found.period, 'daily', url);
      assert.equal(found.frequency, '2', url);
    }
  });

  it('is the default for a hand-written value the module does not allow', async () => {
    const { cms } = await site({
      ...files,
      '_data/site.json': JSON.stringify({
        title: 'Geekity Demo',
        feedUpdatePeriod: 'fortnightly',
        feedUpdateFrequency: 0,
      }),
    });

    const found = await cadence(cms, '/feed/');
    assert.equal(found.period, 'hourly');
    assert.equal(found.frequency, '1');
  });

  it('is said by RSS alone: Atom and JSON Feed have no element for it', async () => {
    const { cms } = await site(files);

    const atomBody = await (await cms.app.request('/feed/atom/')).text();
    assert.ok(!atomBody.includes('updatePeriod'), 'Atom carries no cadence');
    const jsonBody = await (await cms.app.request('/feed/json/')).text();
    assert.ok(!jsonBody.includes('updatePeriod'), 'JSON Feed carries no cadence');
  });

  it('changes the post and the comments feeds’ validators when it changes', async () => {
    const { cms } = await site(files);
    const before = await Promise.all(
      ['/feed/', '/comments/feed/'].map(async (url) =>
        (await cms.app.request(url)).headers.get('etag'),
      ),
    );

    await setCadence(cms, 'weekly', 1);
    const after = await Promise.all(
      ['/feed/', '/comments/feed/'].map(async (url) =>
        (await cms.app.request(url)).headers.get('etag'),
      ),
    );

    assert.ok(before.every((etag) => etag !== null));
    assert.notEqual(before[0], after[0]);
    assert.notEqual(before[1], after[1]);
  });
});

describe('who a feed credits (TASK-192)', () => {
  /** A site whose posts and settings name `andrew`, who calls himself Andrew Shell. */
  async function withAndrew(siteJson: Record<string, unknown>): Promise<Cms> {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'Geekity Demo', ...siteJson }),
      'posts/2026-09-02-mine.md': post('Mine', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/mine/',
        author: 'andrew',
      }),
      'posts/2026-08-15-nobodys.md': post('Nobody’s', {
        date: '2026-08-15T09:00:00Z',
        permalink: '/2026/08/nobodys/',
      }),
    });
    const andrew = await createUser({
      dataDir: cms.config.dataDir,
      username: 'andrew',
      password: 'correct horse battery',
    });
    await setUserProfile({
      dataDir: cms.config.dataDir,
      userId: andrew.id,
      profile: { displayName: 'Andrew Shell' },
    });
    return cms;
  }

  it('prints the site author’s display name, never the username (AC #4, AC #8)', async () => {
    const cms = await withAndrew({ author: 'andrew' });

    const { channel } = await rss(cms, '/feed/');
    assert.deepEqual(
      childrenNamed(channel, 'item').map((item) => child(item, 'dc:creator').text),
      ['Andrew Shell', 'Andrew Shell'],
      'the post’s author, and the site’s for the post that names nobody',
    );

    const { feed } = await atom(cms, '/feed/atom/');
    assert.equal(child(child(feed, 'author'), 'name').text, 'Andrew Shell');
    const [mine] = childrenNamed(feed, 'entry') as [XmlElement];
    assert.equal(child(child(mine, 'author'), 'name').text, 'Andrew Shell');

    const { feed: json, items } = await jsonFeedAt(cms, '/feed/json/');
    assert.deepEqual(json['authors'], [{ name: 'Andrew Shell' }]);
    assert.deepEqual(items[0]?.['authors'], [{ name: 'Andrew Shell' }]);
  });

  it('prints the site title on a site with several authors (AC #4)', async () => {
    const cms = await withAndrew({});

    const { channel } = await rss(cms, '/feed/');
    const [, nobodys] = childrenNamed(channel, 'item') as [XmlElement, XmlElement];
    assert.equal(child(nobodys, 'dc:creator').text, 'Geekity Demo');

    const { feed } = await atom(cms, '/feed/atom/');
    assert.equal(child(child(feed, 'author'), 'name').text, 'Geekity Demo');

    const { feed: json, items } = await jsonFeedAt(cms, '/feed/json/');
    assert.deepEqual(json['authors'], [{ name: 'Geekity Demo' }]);
    assert.deepEqual(
      items[0]?.['authors'],
      [{ name: 'Andrew Shell' }],
      'a post still credits its own author',
    );
  });

  it('changes its validator when the author’s display name changes', async () => {
    const cms = await withAndrew({ author: 'andrew' });
    const before = (await cms.app.request('/feed/json/')).headers.get('etag');

    const [andrew] = listUsers(cms.config.dataDir);
    assert.ok(andrew !== undefined);
    await setUserProfile({
      dataDir: cms.config.dataDir,
      userId: andrew.id,
      profile: { displayName: 'A. Shell' },
    });

    const response = await cms.app.request('/feed/json/');
    assert.notEqual(response.headers.get('etag'), before);
    assert.deepEqual(((await response.json()) as Record<string, unknown>)['authors'], [
      { name: 'A. Shell' },
    ]);
  });
});

describe('the license a feed declares (TASK-206)', () => {
  const BY_SA = 'https://creativecommons.org/licenses/by-sa/4.0/';
  const CC_NAMESPACE = 'http://backend.userland.com/creativeCommonsRssModule';
  const posts = {
    'posts/2026-09-03-mine.md':
      "---\ntitle: Mine\ndate: '2026-09-03T09:00:00Z'\npermalink: /2026/09/mine/\nlicense: https://example.com/terms\nlicenseName: House terms\n---\n\nAll mine.\n",
    'posts/2026-09-02-reserved.md':
      "---\ntitle: Reserved\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/reserved/\nlicense: none\n---\n\nAsk first.\n",
    'posts/2026-09-01-hello.md': post('Hello', {
      date: '2026-09-01T09:00:00Z',
      permalink: '/2026/09/hello/',
    }),
  };

  function licenseHrefs(element: XmlElement): string[] {
    return childrenNamed(element, 'link')
      .filter((link) => link.attributes['rel'] === 'license')
      .map((link) => link.attributes['href'] ?? '');
  }

  function ccLicenses(element: XmlElement): string[] {
    return childrenNamed(element, 'creativeCommons:license').map((license) => license.text);
  }

  it('declares the site license on the Atom feed and the RSS channel (AC #3)', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'A Site', license: 'cc-by-sa' }),
      'posts/2026-09-01-hello.md': posts['posts/2026-09-01-hello.md'],
    });

    const { feed } = await atom(cms, '/feed/atom/');
    const feedLicense = childrenNamed(feed, 'link').find(
      (link) => link.attributes['rel'] === 'license',
    );
    assert.equal(feedLicense?.attributes['href'], BY_SA);
    assert.equal(feedLicense?.attributes['title'], 'CC BY-SA 4.0');
    assert.deepEqual(licenseHrefs(child(feed, 'entry')), [BY_SA], 'and on each entry, RFC 4946');

    const { rss: document, channel } = await rss(cms, '/feed/');
    assert.equal(document.attributes['xmlns:creativeCommons'], CC_NAMESPACE);
    assert.deepEqual(ccLicenses(channel), [BY_SA]);
    assert.deepEqual(ccLicenses(child(channel, 'item')), [BY_SA]);
  });

  it("gives a post's feed item the license its front matter names (AC #4)", async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'A Site', license: 'cc-by-sa' }),
      ...posts,
    });

    const { feed } = await atom(cms, '/feed/atom/');
    assert.deepEqual(childrenNamed(feed, 'entry').map(licenseHrefs), [
      ['https://example.com/terms'],
      [],
      [BY_SA],
    ]);

    const { channel } = await rss(cms, '/feed/');
    assert.deepEqual(childrenNamed(channel, 'item').map(ccLicenses), [
      ['https://example.com/terms'],
      [],
      [BY_SA],
    ]);
  });

  it('declares nothing when no license is chosen (AC #5)', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'A Site' }),
      'posts/2026-09-02-reserved.md': posts['posts/2026-09-02-reserved.md'],
      'posts/2026-09-01-hello.md': posts['posts/2026-09-01-hello.md'],
    });

    for (const url of ['/feed/', '/feed/atom/', '/feed/json/']) {
      const text = await (await cms.app.request(url)).text();
      assert.doesNotMatch(text, /license|creativeCommons/i, url);
    }
  });

  it('declares a post license on a site that has none, and only there (AC #4, AC #5)', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'A Site' }),
      ...posts,
    });

    const { channel, rss: document } = await rss(cms, '/feed/');
    assert.equal(document.attributes['xmlns:creativeCommons'], CC_NAMESPACE);
    assert.deepEqual(ccLicenses(channel), [], 'the site has none to declare');
    assert.deepEqual(childrenNamed(channel, 'item').map(ccLicenses), [
      ['https://example.com/terms'],
      [],
      [],
    ]);
  });

  it('moves the ETag when the site license changes', async () => {
    const { cms, contentDir } = await site({
      '_data/site.json': JSON.stringify({ title: 'A Site' }),
      'posts/2026-09-01-hello.md': posts['posts/2026-09-01-hello.md'],
    });
    const before = (await cms.app.request('/feed/atom/')).headers.get('etag');
    await writeSiteJson({
      contentDir,
      settings: { ...readSiteSettings(contentDir), license: 'cc0' },
    });
    const after = (await cms.app.request('/feed/atom/')).headers.get('etag');
    assert.notEqual(after, before);
  });
});

// RSS readers render a description as HTML, so text that is inert on the page
// (escaped markup, a backslash-escaped tag, a code span) must stay escaped text
// there, and a description the author wrote is text too (TASK-259).
describe('a summary that reads like markup', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';
  const files = {
    'posts/2026-09-04-escaped.md': post('Escaped', {
      date: '2026-09-04T09:00:00Z',
      permalink: '/2026/09/escaped/',
      body: '&lt;img src=x onerror=alert(1)&gt;',
    }),
    'posts/2026-09-03-backslash.md': post('Backslash', {
      date: '2026-09-03T09:00:00Z',
      permalink: '/2026/09/backslash/',
      body: '\\<img src=x onerror=alert(1)>',
    }),
    'posts/2026-09-02-code.md': post('Code', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/code/',
      body: '`<img src=x onerror=alert(1)>`',
    }),
    'posts/2026-09-01-described.md': post('Described', {
      date: '2026-09-01T09:00:00Z',
      permalink: '/2026/09/described/',
      description: PAYLOAD,
    }),
  };

  it('is escaped text in every RSS description', async () => {
    const { cms } = await site(files);
    const { channel } = await rss(cms, '/feed/');

    const descriptions = childrenNamed(channel, 'item').map(
      (item) => child(item, 'description').text,
    );

    assert.equal(descriptions.length, 4);
    for (const description of descriptions) assert.equal(htmlText(description), PAYLOAD);
  });

  it('is the text itself in the plain-text Atom and JSON Feed summaries', async () => {
    const { cms } = await site(files);
    const { feed } = await atom(cms, '/feed/atom/');
    const { items } = await jsonFeedAt(cms, '/feed/json/');

    assert.deepEqual(
      childrenNamed(feed, 'entry').map((entry) => child(entry, 'summary').text),
      [PAYLOAD, PAYLOAD, PAYLOAD, PAYLOAD],
    );
    assert.deepEqual(
      items.map((item) => item['summary']),
      [PAYLOAD, PAYLOAD, PAYLOAD, PAYLOAD],
    );
  });

  it('is escaped text in a comment feed description', async () => {
    const { cms } = await site({
      'posts/2026-09-02-hello.md': post('Hello, World!', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hello/',
      }),
    });
    reply(cms, {
      inReplyTo: 'https://example.com/2026/09/hello/',
      content: '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
      published: '2026-09-02T10:00:00Z',
    });

    const { channel } = await rss(cms, '/2026/09/hello/feed/');

    assert.equal(htmlText(child(child(channel, 'item'), 'description').text), PAYLOAD);
  });
});

describe('a post whose body holds an address nothing can resolve (TASK-260)', () => {
  it('leaves every feed serving the other posts', async () => {
    const { cms } = await site({
      'posts/2026-09-03-bad.md': post('Bad', {
        date: '2026-09-03T09:00:00Z',
        permalink: '/2026/09/bad/',
        body: '<a href="/\\javascript:alert(1)">a</a> <img src="/\\["> <a href="/\\x y">b</a>',
      }),
      'posts/2026-09-02-good.md': post('Good', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/good/',
        body: 'Good words.',
      }),
    });

    const { response: rssResponse, channel } = await rss(cms, '/feed/');
    const { response: atomResponse, feed } = await atom(cms, '/feed/atom/');
    const { response: jsonResponse, items } = await jsonFeedAt(cms, '/feed/json/');

    assert.deepEqual(
      [rssResponse.status, atomResponse.status, jsonResponse.status],
      [200, 200, 200],
    );
    const links = ['https://example.com/2026/09/bad/', 'https://example.com/2026/09/good/'];
    assert.deepEqual(
      childrenNamed(channel, 'item').map((item) => child(item, 'link').text),
      links,
    );
    assert.deepEqual(
      childrenNamed(feed, 'entry').map(
        (entry) => linkWithRel(entry, 'alternate').attributes['href'],
      ),
      links,
    );
    assert.deepEqual(
      items.map((item) => item['content_html']),
      [
        '<p><a href="/\\javascript:alert(1)">a</a> <img src="/\\["> <a href="/\\x y">b</a></p>\n',
        '<p>Good words.</p>\n',
      ],
    );
  });
});
