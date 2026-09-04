import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { child, childrenNamed, parseXml } from './__testing__/xml.ts';
import type { XmlElement } from './__testing__/xml.ts';
import { sitemapResponse, SITEMAP_NAMESPACE } from './sitemap.ts';
import type { SitemapUrl } from './sitemap.ts';

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
  const contentDir = await temporaryDir('geekity-sitemap-content-');
  const dataDir = await temporaryDir('geekity-sitemap-data-');
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
  },
): string {
  const lines = [`title: ${title}`, `date: '${options.date}'`, `permalink: ${options.permalink}`];
  if (options.updated !== undefined) lines.push(`updated: '${options.updated}'`);
  if (options.tags !== undefined) {
    lines.push(`tags:`, ...options.tags.map((tag) => `  - ${tag}`));
  }
  if (options.categories !== undefined) {
    lines.push(`categories:`, ...options.categories.map((category) => `  - ${category}`));
  }
  if (options.draft === true) lines.push('draft: true');
  return `---\n${lines.join('\n')}\n---\n\nBody.\n`;
}

/** A page file. */
function page(title: string, permalink: string): string {
  return `---\ntitle: ${title}\npermalink: ${permalink}\n---\n\nBody.\n`;
}

/** The `<loc>` of every `<url>` in a sitemap, in document order. */
function locations(root: XmlElement): string[] {
  return childrenNamed(root, 'url').map((url) => child(url, 'loc').text);
}

/** The sitemap at a URL: the response and its parsed root element. */
async function sitemap(
  cms: Cms,
  url = '/sitemap.xml',
): Promise<{ response: Response; body: string; root: XmlElement }> {
  const response = await cms.app.request(url);
  const body = await response.text();
  return { response, body, root: parseXml(body) };
}

describe('robots.txt', () => {
  it('keeps crawlers out of the admin and points them at the sitemap', async () => {
    const { cms } = await site({});

    const response = await cms.app.request('/robots.txt');
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/plain/);
    assert.match(body, /^User-agent: \*$/m);
    assert.match(body, /^Disallow: \/admin\/$/m);
    assert.match(body, /^Sitemap: https:\/\/example\.com\/sitemap\.xml$/m);
  });
});

describe('the sitemap', () => {
  it('lists the home page, every public post and every public page', async () => {
    const { cms } = await site({
      'posts/newer.md': post('Newer', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/newer/',
      }),
      'posts/older.md': post('Older', {
        date: '2026-08-15T09:00:00Z',
        permalink: '/2026/08/older/',
      }),
      'pages/about.md': page('About', '/about/'),
    });

    const { response, root } = await sitemap(cms);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/xml/);
    assert.equal(root.name, 'urlset');
    assert.equal(root.attributes['xmlns'], 'http://www.sitemaps.org/schemas/sitemap/0.9');
    assert.deepEqual(locations(root).toSorted(), [
      'https://example.com/',
      'https://example.com/2026/08/older/',
      'https://example.com/2026/09/newer/',
      'https://example.com/about/',
    ]);
  });

  it('dates each URL by its `updated`, falling back to its `date`', async () => {
    const { cms } = await site({
      'posts/edited.md': post('Edited', {
        date: '2026-08-01T09:00:00Z',
        updated: '2026-09-03T11:30:00Z',
        permalink: '/edited/',
      }),
      'posts/untouched.md': post('Untouched', {
        date: '2026-07-04T08:15:00Z',
        permalink: '/untouched/',
      }),
      'pages/undated.md': page('Undated', '/undated/'),
    });

    const { root } = await sitemap(cms);
    const dated = new Map(
      childrenNamed(root, 'url').map((url) => [
        child(url, 'loc').text,
        childrenNamed(url, 'lastmod')[0]?.text,
      ]),
    );

    assert.equal(dated.get('https://example.com/edited/'), '2026-09-03T11:30:00Z');
    assert.equal(dated.get('https://example.com/untouched/'), '2026-07-04T08:15:00Z');
    assert.equal(
      dated.get('https://example.com/undated/'),
      undefined,
      'a page nothing dates carries no <lastmod> rather than a made-up one',
    );
    assert.equal(
      dated.get('https://example.com/'),
      '2026-09-03T11:30:00Z',
      'the home page is as new as the newest post on it',
    );
  });

  it('leaves out drafts, the trash and posts whose date has not arrived', async () => {
    const { cms } = await site({
      'posts/live.md': post('Live', { date: '2026-09-01T09:00:00Z', permalink: '/live/' }),
      'posts/draft.md': post('Draft', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/draft/',
        draft: true,
      }),
      'posts/scheduled.md': post('Scheduled', {
        date: '2099-01-01T09:00:00Z',
        permalink: '/scheduled/',
      }),
      '_trash/posts/binned.md': post('Binned', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/binned/',
      }),
    });

    const { root } = await sitemap(cms);
    const found = locations(root);

    assert.ok(found.includes('https://example.com/live/'), 'the published post is listed');
    for (const hidden of ['/draft/', '/scheduled/', '/binned/']) {
      assert.ok(
        !found.includes(`https://example.com${hidden}`),
        `${hidden} is not on the public site and is not in the sitemap`,
      );
    }
  });

  it('lists every page of the archive and of every taxonomy it has', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'Paged', postsPerPage: 2 }),
      'posts/one.md': post('One', {
        date: '2026-09-03T09:00:00Z',
        permalink: '/one/',
        tags: ['web'],
        categories: ['notes'],
      }),
      'posts/two.md': post('Two', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/two/',
        tags: ['web'],
        categories: ['notes'],
      }),
      'posts/three.md': post('Three', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/three/',
        tags: ['web'],
      }),
    });

    const { root } = await sitemap(cms);
    const found = locations(root);

    for (const expected of [
      'https://example.com/',
      'https://example.com/page/2/',
      'https://example.com/tag/web/',
      'https://example.com/tag/web/page/2/',
      'https://example.com/category/notes/',
    ]) {
      assert.ok(found.includes(expected), `${expected} is in the sitemap`);
    }
    assert.ok(!found.includes('https://example.com/page/3/'), 'there is no third page');
    assert.ok(
      !found.includes('https://example.com/category/notes/page/2/'),
      'two posts under a category of page size two is one page',
    );
  });

  it('follows the taxonomy bases the site is configured with', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'Rebased', tagBase: 'topics' }),
      'posts/one.md': post('One', {
        date: '2026-09-03T09:00:00Z',
        permalink: '/one/',
        tags: ['web'],
      }),
    });

    const found = locations((await sitemap(cms)).root);

    assert.ok(found.includes('https://example.com/topics/web/'), 'the archive is under its base');
    assert.ok(!found.includes('https://example.com/tag/web/'), 'and not under the default one');
  });

  it('cannot be shadowed by a document permalinked at its URL', async () => {
    const { cms } = await site({
      'pages/impostor.md': page('Impostor', '/sitemap.xml'),
      'pages/robot.md': page('Robot', '/robots.txt'),
    });

    const { response, root } = await sitemap(cms);
    assert.equal(response.status, 200);
    assert.equal(root.name, 'urlset');

    const robots = await cms.app.request('/robots.txt');
    assert.match(await robots.text(), /^User-agent: \*$/m);
  });

  it('has no child sitemaps while the whole thing fits in one file', async () => {
    const { cms } = await site({
      'posts/one.md': post('One', { date: '2026-09-03T09:00:00Z', permalink: '/one/' }),
    });

    for (const url of ['/sitemap-1.xml', '/sitemap-2.xml']) {
      assert.equal((await cms.app.request(url)).status, 404, `${url} names nothing`);
    }
  });
});

/*
 * The split is proved at {@link sitemapResponse} rather than over HTTP: the
 * protocol's limit is 50,000 URLs, and a fixture site with 50,001 of them
 * would prove nothing that three and a limit of two do not.
 */
describe('a sitemap too big for one file', () => {
  const urls: SitemapUrl[] = [
    { loc: '/', lastmod: new Date('2026-09-03T09:00:00Z') },
    { loc: '/one/', lastmod: new Date('2026-09-02T09:00:00Z') },
    { loc: '/two/', lastmod: new Date('2026-09-01T09:00:00Z') },
  ];
  const options = { urls, baseUrl: 'https://example.com', maxUrls: 2 };

  /** The document one call answers with, parsed. */
  async function served(page: number | undefined): Promise<XmlElement | undefined> {
    const response = sitemapResponse({ ...options, page });
    if (response === undefined) return undefined;
    return parseXml(await response.text());
  }

  it('becomes an index naming one child per file, each dated by its newest URL', async () => {
    const index = await served(undefined);
    assert.notEqual(index, undefined);
    assert.equal(index?.name, 'sitemapindex');
    assert.equal(index?.attributes['xmlns'], SITEMAP_NAMESPACE);

    const children = childrenNamed(index as XmlElement, 'sitemap');
    assert.deepEqual(
      children.map((entry) => child(entry, 'loc').text),
      ['https://example.com/sitemap-1.xml', 'https://example.com/sitemap-2.xml'],
    );
    assert.deepEqual(
      children.map((entry) => child(entry, 'lastmod').text),
      ['2026-09-03T09:00:00Z', '2026-09-01T09:00:00Z'],
    );
  });

  it('serves each child as a urlset holding its own slice, and nothing beyond', async () => {
    assert.deepEqual(locations((await served(1)) as XmlElement), [
      'https://example.com/',
      'https://example.com/one/',
    ]);
    assert.deepEqual(locations((await served(2)) as XmlElement), ['https://example.com/two/']);
    assert.equal(await served(3), undefined, 'there is no third child');
    assert.equal(await served(0), undefined, 'the children are numbered from one');
  });

  it('gives each child its own validator, so one is never mistaken for another', () => {
    const etags = [undefined, 1, 2].map((page) =>
      sitemapResponse({ ...options, page })?.headers.get('etag'),
    );
    assert.equal(new Set(etags).size, 3, 'three documents, three ETags');
  });
});

describe('polling the sitemap and the robots file', () => {
  it('answers a matching If-None-Match with 304, headers and all', async () => {
    const { cms } = await site({
      'posts/one.md': post('One', { date: '2026-09-03T09:00:00Z', permalink: '/one/' }),
    });

    for (const url of ['/sitemap.xml', '/robots.txt']) {
      const first = await cms.app.request(url);
      const etag = first.headers.get('etag');
      assert.notEqual(etag, null, `${url} carries an ETag`);

      const second = await cms.app.request(url, { headers: { 'if-none-match': etag ?? '' } });
      assert.equal(second.status, 304, `${url} answers its own ETag with 304`);
      assert.equal(second.headers.get('etag'), etag, 'the 304 still names the validator');
      assert.equal(await second.text(), '', 'and carries no body');
    }
  });

  it('answers an If-Modified-Since later than everything it lists with 304', async () => {
    const { cms } = await site({
      'posts/one.md': post('One', { date: '2026-09-03T09:00:00Z', permalink: '/one/' }),
    });

    const fresh = await cms.app.request('/sitemap.xml', {
      headers: { 'if-modified-since': new Date('2026-09-04T09:00:00Z').toUTCString() },
    });
    assert.equal(fresh.status, 304);
    assert.equal(
      fresh.headers.get('last-modified'),
      new Date('2026-09-03T09:00:00Z').toUTCString(),
    );

    const stale = await cms.app.request('/sitemap.xml', {
      headers: { 'if-modified-since': new Date('2026-09-01T09:00:00Z').toUTCString() },
    });
    assert.equal(stale.status, 200);
  });

  it('moves its validator when the site publishes something new', async () => {
    const { cms, contentDir } = await site({
      'posts/one.md': post('One', { date: '2026-09-01T09:00:00Z', permalink: '/one/' }),
    });

    const before = await cms.app.request('/sitemap.xml');
    const etag = before.headers.get('etag');

    await writeTree(contentDir, {
      'posts/two.md': post('Two', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/two/',
        tags: ['web'],
      }),
    });
    await cms.sync();

    const after = await cms.app.request('/sitemap.xml');
    assert.notEqual(after.headers.get('etag'), etag, 'a new post is a changed sitemap');
    assert.equal(
      after.headers.get('last-modified'),
      new Date('2026-09-02T09:00:00Z').toUTCString(),
    );

    const conditional = await cms.app.request('/sitemap.xml', {
      headers: { 'if-none-match': etag ?? '' },
    });
    assert.equal(conditional.status, 200, 'the validator the crawler holds is stale now');
    assert.ok(locations(parseXml(await conditional.text())).includes('https://example.com/two/'));
  });

  it('gives the robots file a validator that follows the site it names', async () => {
    const { cms } = await site({});
    const { cms: elsewhere } = await site({}, { baseUrl: 'https://elsewhere.example' });

    const here = await cms.app.request('/robots.txt');
    const there = await elsewhere.app.request('/robots.txt');

    assert.match(await there.text(), /^Sitemap: https:\/\/elsewhere\.example\/sitemap\.xml$/m);
    assert.notEqual(
      here.headers.get('etag'),
      there.headers.get('etag'),
      'two sites naming two sitemaps are two robots files',
    );
  });
});
