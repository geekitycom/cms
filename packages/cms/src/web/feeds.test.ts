import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';

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
    ...config,
  });
  started.push(instance);
  await instance.sync();
  return { cms: instance, contentDir };
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

  return `---\n${lines.join('\n')}\n---\n\n${options.body ?? 'Body.'}\n`;
}

/* -------------------------------------------------------------------------- */
/* A strict XML reader, so "well formed" is proved rather than assumed.        */
/* -------------------------------------------------------------------------- */

interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Character data directly inside this element, entities resolved. */
  text: string;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Parse an XML document, refusing anything that is not well formed: mismatched
 * or unclosed tags, unquoted attributes, a bare `<` or `&` in character data,
 * an unknown entity, or content after the root element.
 *
 * The test owns this rather than the CMS, so the feed is checked against an
 * independent reading of the bytes instead of against the code that wrote them.
 */
function parseXml(source: string): XmlElement {
  let at = 0;

  function fail(message: string): never {
    throw new Error(
      `${message} at offset ${String(at)}: ${JSON.stringify(source.slice(at, at + 40))}`,
    );
  }

  function skipMisc(): void {
    for (;;) {
      while (at < source.length && /\s/.test(source[at] ?? '')) at += 1;
      if (source.startsWith('<?', at)) {
        const end = source.indexOf('?>', at);
        if (end < 0) fail('unterminated processing instruction');
        at = end + 2;
        continue;
      }
      if (source.startsWith('<!--', at)) {
        const end = source.indexOf('-->', at);
        if (end < 0) fail('unterminated comment');
        at = end + 3;
        continue;
      }
      return;
    }
  }

  function readName(): string {
    const match = /^[A-Za-z_:][\w.:-]*/.exec(source.slice(at));
    if (match === null) fail('expected a name');
    at += match[0].length;
    return match[0];
  }

  /** Resolve the entity references in character data, rejecting bad ones. */
  function decode(raw: string, where: string): string {
    let out = '';
    let index = 0;
    while (index < raw.length) {
      const character = raw[index] ?? '';
      if (character !== '&') {
        if (character === '<') fail(`a bare "<" in ${where}`);
        out += character;
        index += 1;
        continue;
      }
      const semicolon = raw.indexOf(';', index);
      if (semicolon < 0) fail(`an unterminated entity reference in ${where}`);
      const reference = raw.slice(index + 1, semicolon);
      if (reference.startsWith('#x')) {
        out += String.fromCodePoint(Number.parseInt(reference.slice(2), 16));
      } else if (reference.startsWith('#')) {
        out += String.fromCodePoint(Number.parseInt(reference.slice(1), 10));
      } else {
        const value = ENTITIES[reference];
        if (value === undefined) fail(`the unknown entity "&${reference};" in ${where}`);
        out += value;
      }
      index = semicolon + 1;
    }
    return out;
  }

  function readAttributes(): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (;;) {
      while (at < source.length && /\s/.test(source[at] ?? '')) at += 1;
      if (source.startsWith('>', at) || source.startsWith('/>', at)) return attributes;

      const name = readName();
      if (source[at] !== '=') fail(`no value for the attribute "${name}"`);
      at += 1;
      const quote = source[at];
      if (quote !== '"' && quote !== "'") fail(`an unquoted value for the attribute "${name}"`);
      at += 1;
      const end = source.indexOf(quote, at);
      if (end < 0) fail(`an unterminated value for the attribute "${name}"`);
      if (name in attributes) fail(`the attribute "${name}" twice on one element`);
      attributes[name] = decode(source.slice(at, end), `the attribute "${name}"`);
      at = end + 1;
    }
  }

  function readElement(): XmlElement {
    if (source[at] !== '<') fail('expected an element');
    at += 1;
    const name = readName();
    const attributes = readAttributes();

    if (source.startsWith('/>', at)) {
      at += 2;
      return { name, attributes, children: [], text: '' };
    }
    if (source[at] !== '>') fail(`an unterminated start tag for "${name}"`);
    at += 1;

    const element: XmlElement = { name, attributes, children: [], text: '' };

    for (;;) {
      if (at >= source.length) fail(`no closing tag for "${name}"`);

      if (source.startsWith('</', at)) {
        at += 2;
        const closing = readName();
        if (closing !== name) fail(`"</${closing}>" closing "<${name}>"`);
        while (at < source.length && /\s/.test(source[at] ?? '')) at += 1;
        if (source[at] !== '>') fail(`an unterminated end tag for "${name}"`);
        at += 1;
        return element;
      }

      if (source.startsWith('<!--', at)) {
        const end = source.indexOf('-->', at);
        if (end < 0) fail('unterminated comment');
        at = end + 3;
        continue;
      }

      // A CDATA section is character data taken literally: no entities are
      // resolved inside it, and it ends at the first `]]>`. A writer that
      // emitted a `]]>` of its own without splitting it would end the section
      // early and leave the rest as markup, which the rest of this reader
      // then rejects.
      if (source.startsWith('<![CDATA[', at)) {
        const end = source.indexOf(']]>', at);
        if (end < 0) fail('unterminated CDATA section');
        element.text += source.slice(at + '<![CDATA['.length, end);
        at = end + 3;
        continue;
      }

      if (source[at] === '<') {
        element.children.push(readElement());
        continue;
      }

      const next = source.indexOf('<', at);
      const raw = source.slice(at, next < 0 ? source.length : next);
      element.text += decode(raw, `the text of "${name}"`);
      at += raw.length;
    }
  }

  skipMisc();
  const root = readElement();
  skipMisc();
  if (at < source.length) fail('content after the root element');
  return root;
}

/** The one child element with this name, asserting there is exactly one. */
function child(element: XmlElement, name: string): XmlElement {
  const found = element.children.filter((candidate) => candidate.name === name);
  assert.equal(found.length, 1, `exactly one <${name}> inside <${element.name}>`);
  return found[0] as XmlElement;
}

/** Every child element with this name, in document order. */
function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((candidate) => candidate.name === name);
}

/** The `<link>` with a given `rel`, asserting there is exactly one. */
function linkWithRel(element: XmlElement, rel: string): XmlElement {
  const found = childrenNamed(element, 'link').filter((link) => link.attributes['rel'] === rel);
  assert.equal(found.length, 1, `exactly one <link rel="${rel}"> inside <${element.name}>`);
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

    const self = child(channel, 'atom:link');
    assert.equal(self.attributes['rel'], 'self');
    assert.equal(self.attributes['type'], 'application/rss+xml');
    assert.equal(self.attributes['href'], 'https://example.com/feed/');

    const image = child(channel, 'image');
    assert.equal(child(image, 'url').text, 'https://example.com/uploads/2026/09/me.png');
    assert.equal(child(image, 'title').text, 'Geekity Demo');
    assert.equal(child(image, 'link').text, 'https://example.com/');
  });

  it('carries one item per published post, newest first, with the whole post', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'Geekity Demo', author: 'The Site' }),
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

    // The guid is a name, not an address: the ActivityStreams object id, which
    // is minted from the slug and so survives the post being moved.
    const guid = child(newer, 'guid');
    assert.equal(guid.attributes['isPermaLink'], 'false');
    assert.equal(guid.text, 'https://example.com/ap/posts/newer');

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

    // A post that names no author falls back to the site's.
    assert.equal(child(older, 'dc:creator').text, 'The Site');
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
    assert.equal(child(item, 'description').text, 'Fish & chips now, and a stray ]]> in the text.');
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
        date: '2026-09-04T09:00:00Z',
        permalink: '/draft/',
        draft: true,
      }),
      '_trash/posts/2026-09-05-gone.md': post('Thrown Away', {
        date: '2026-09-05T09:00:00Z',
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
        author: 'Andrew Shell',
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
    assert.equal(child(child(feed, 'author'), 'name').text, 'Andrew Shell');
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
        description: 'A short summary.',
        author: 'Andrew Shell',
        body: 'A *file-first* CMS & proud of it.',
      }),
      'posts/2026-08-15-older.md': post('Older', {
        date: '2026-08-15T09:00:00Z',
        permalink: '/2026/08/older/',
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

    assert.deepEqual(
      childrenNamed(newer, 'category').map((category) => category.attributes['term']),
      ['introductions', 'meta'],
    );

    const content = child(newer, 'content');
    assert.equal(content.attributes['type'], 'html');
    // The markup is escaped, so the parser sees one text node, not elements.
    assert.equal(content.children.length, 0);
    assert.equal(content.text.trim(), '<p>A <em>file-first</em> CMS &amp; proud of it.</p>');

    // A post without one carries no summary rather than an empty one.
    assert.equal(childrenNamed(older, 'summary').length, 0);
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
        author: 'Andrew Shell',
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
    assert.deepEqual(feed['authors'], [{ name: 'Andrew Shell' }]);
  });

  it('carries the same entries as the Atom feed, newest first', async () => {
    const files = {
      'posts/2026-09-02-newer.md': post('Newer', {
        date: '2026-09-02T09:00:00Z',
        updated: '2026-09-03T12:00:00Z',
        permalink: '/2026/09/newer/',
        tags: ['introductions', 'meta'],
        description: 'A short summary.',
        author: 'Andrew Shell',
        body: 'A *file-first* CMS & proud of it.',
      }),
      'posts/2026-08-15-older.md': post('Older', {
        date: '2026-08-15T09:00:00Z',
        permalink: '/2026/08/older/',
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
    assert.deepEqual(newer['tags'], ['introductions', 'meta']);
    assert.deepEqual(newer['authors'], [{ name: 'Andrew Shell' }]);

    // A post with no description and no `updated` carries neither key rather
    // than a null: JSON Feed readers treat absent and empty differently.
    assert.equal('summary' in older, false);
    assert.equal(older['date_modified'], '2026-08-15T09:00:00.000Z');
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
        child(channel, 'atom:link').attributes['href'],
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

describe('the WordPress feed URLs', () => {
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

  it('redirect the older spellings WordPress also served', async () => {
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
        '<link rel="alternate" type="application/activity+json" href="https://example.com/ap/posts/one">',
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

describe('a post’s comments feed', () => {
  const files = {
    '_data/site.json': JSON.stringify({ title: 'Geekity Demo', tagline: 'A file-first site' }),
    'posts/2026-09-02-hello.md': post('Hello, World!', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/hello/',
    }),
  };

  const HELLO = 'https://example.com/ap/posts/hello';

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
      child(channel, 'atom:link').attributes['href'],
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
    assert.equal(child(oldest, 'description').text, 'Good post.');
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

  const HELLO = 'https://example.com/ap/posts/hello';
  const SECOND = 'https://example.com/ap/posts/second';

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
      child(channel, 'atom:link').attributes['href'],
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
      inReplyTo: 'https://example.com/ap/posts/hidden',
      id: 'https://remote.example/notes/2',
    });
    reply(cms, {
      inReplyTo: 'https://example.com/ap/posts/gone',
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
    reply(cms, { inReplyTo: 'https://elsewhere.example/ap/posts/hello' });
    reply(cms, { inReplyTo: 'https://example.com/ap/posts/never', id: 'https://x.test/notes/2' });

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

  it('redirects the unslashed and the WordPress spellings in one hop', async () => {
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

  const HELLO = 'https://example.com/ap/posts/hello';

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
