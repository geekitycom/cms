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

    const { response, feed } = await atom(cms, '/feed.xml');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/atom+xml; charset=utf-8');

    assert.equal(feed.name, 'feed');
    assert.equal(feed.attributes['xmlns'], 'http://www.w3.org/2005/Atom');
    assert.equal(child(feed, 'id').text, 'https://example.com/');
    assert.equal(child(feed, 'title').text, 'Geekity Demo');
    assert.equal(child(feed, 'subtitle').text, 'A file-first site');
    assert.equal(child(feed, 'updated').text, '2026-09-02T09:00:00.000Z');
    assert.equal(child(child(feed, 'author'), 'name').text, 'Andrew Shell');
    assert.equal(linkWithRel(feed, 'self').attributes['href'], 'https://example.com/feed.xml');
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

    const { feed } = await atom(cms, '/feed.xml');
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

    const { feed } = await atom(cms, '/feed.xml');
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

    const { feed } = await atom(cms, '/feed.xml');
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

    const response = await cms.app.request('/feed.xml');
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

    const { response, feed } = await jsonFeedAt(cms, '/feed.json');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/feed+json; charset=utf-8');

    assert.equal(feed['title'], 'Geekity Demo');
    assert.equal(feed['home_page_url'], 'https://example.com/');
    assert.equal(feed['feed_url'], 'https://example.com/feed.json');
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
    const { items } = await jsonFeedAt(cms, '/feed.json');
    const { feed: atomDocument } = await atom(cms, '/feed.xml');

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

    const { response, feed } = await atom(cms, '/tags/releases/feed.xml');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/atom+xml; charset=utf-8');
    assert.equal(child(feed, 'id').text, 'https://example.com/tags/releases/');
    assert.equal(
      linkWithRel(feed, 'self').attributes['href'],
      'https://example.com/tags/releases/feed.xml',
    );
    assert.equal(
      linkWithRel(feed, 'alternate').attributes['href'],
      'https://example.com/tags/releases/',
    );
    assert.ok(child(feed, 'title').text.includes('releases'), 'the feed title names the tag');

    assert.deepEqual(
      childrenNamed(feed, 'entry').map((entry) => child(entry, 'title').text),
      ['Tagged One'],
    );
  });

  it('holds only what carries the tag, in JSON', async () => {
    const { cms } = await site(tagged);

    const { response, feed, items } = await jsonFeedAt(cms, '/tags/releases/feed.json');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/feed+json; charset=utf-8');
    assert.equal(feed['home_page_url'], 'https://example.com/tags/releases/');
    assert.equal(feed['feed_url'], 'https://example.com/tags/releases/feed.json');
    assert.deepEqual(
      items.map((item) => item['title']),
      ['Tagged One'],
    );
  });

  it('404s a tag nothing published carries', async () => {
    const { cms } = await site(tagged);

    for (const url of ['/tags/nothing/feed.xml', '/tags/nothing/feed.json']) {
      const response = await cms.app.request(url);
      assert.equal(response.status, 404, url);
    }

    // A tag only a draft carries is a tag the public site does not have.
    const draftOnly = await cms.app.request('/tags/releases/feed.xml');
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

    const { response, feed } = await atom(cms, '/tags/book%20notes/feed.xml');

    assert.equal(response.status, 200);
    assert.equal(
      linkWithRel(feed, 'self').attributes['href'],
      'https://example.com/tags/book%20notes/feed.xml',
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

    for (const url of ['/feed.xml', '/feed.json', '/tags/releases/feed.xml']) {
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

    const response = await cms.app.request('/feed.json', {
      headers: { 'if-modified-since': 'Wed, 02 Sep 2026 09:00:00 GMT' },
    });

    assert.equal(response.status, 304);
  });

  it('gives the two formats and the two scopes different validators', async () => {
    const { cms } = await site(files);

    const etags = await Promise.all(
      ['/feed.xml', '/feed.json', '/tags/releases/feed.xml', '/tags/releases/feed.json'].map(
        async (url) => (await cms.app.request(url)).headers.get('etag'),
      ),
    );

    assert.equal(new Set(etags).size, etags.length, 'no two feeds share an ETag');
  });

  it('changes the validator when the content changes', async () => {
    const { cms, contentDir } = await site(files);

    const before = (await cms.app.request('/feed.xml')).headers.get('etag');

    await writeTree(contentDir, {
      'posts/2026-09-03-two.md': post('Two', {
        date: '2026-09-03T09:00:00Z',
        permalink: '/two/',
      }),
    });
    await cms.sync();

    const after = await cms.app.request('/feed.xml');

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

  it('advertise both feeds with link rel=alternate', async () => {
    const { cms } = await site(files);

    for (const url of ['/', '/one/', '/about/', '/tags/releases/']) {
      const html = await (await cms.app.request(url)).text();
      const head = html.slice(0, html.indexOf('</head>'));

      assert.ok(
        head.includes('<link rel="alternate" type="application/atom+xml"') &&
          head.includes('href="/feed.xml"'),
        `${url} advertises the Atom feed`,
      );
      assert.ok(
        head.includes('<link rel="alternate" type="application/feed+json"') &&
          head.includes('href="/feed.json"'),
        `${url} advertises the JSON feed`,
      );
    }
  });

  it('advertise the tag feeds on a tag archive as well as the site ones', async () => {
    const { cms } = await site(files);

    const html = await (await cms.app.request('/tags/releases/')).text();
    const head = html.slice(0, html.indexOf('</head>'));

    assert.ok(head.includes('href="/tags/releases/feed.xml"'), 'the tag Atom feed');
    assert.ok(head.includes('href="/tags/releases/feed.json"'), 'the tag JSON feed');
    assert.ok(head.includes('href="/feed.xml"'), 'and the whole-site Atom feed');
  });

  it('prefix the feed links with the base path when the site lives in a subdirectory', async () => {
    const { cms } = await site(files, { baseUrl: 'https://example.com/blog' });

    const html = await (await cms.app.request('/')).text();

    assert.ok(html.includes('href="/blog/feed.xml"'), 'the Atom link carries the base path');
    assert.ok(html.includes('href="/blog/feed.json"'), 'the JSON link carries the base path');
  });
});
