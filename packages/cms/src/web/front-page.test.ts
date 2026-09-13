import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';

/**
 * WordPress's Reading choice, from the outside: a site whose `/` is a page
 * rather than its latest posts, and the posts page that then carries the
 * listing.
 *
 * Everything here goes through HTTP, because that is what the setting is
 * about — which URL answers with what, and where the ones that moved point.
 */

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

/** A page file. */
function page(title: string, slug: string, body = `The ${slug} page.`): string {
  return `---\ntitle: ${title}\npermalink: /${slug}/\n---\n\n${body}\n`;
}

/** A post file. */
function post(title: string, month: string, slug: string): string {
  return `---\ntitle: ${title}\ndate: '2026-${month}-02T09:00:00Z'\npermalink: /2026/${month}/${slug}/\n---\n\nBody of ${slug}.\n`;
}

/** What `content/_data/site.json` should say. */
function siteJson(settings: Record<string, unknown>): string {
  return `${JSON.stringify({ title: 'A Site', ...settings }, null, 2)}\n`;
}

/**
 * A CMS over a content directory holding `files`, already synced. Watching is
 * off, so a request only ever sees what the scan indexed.
 */
async function site(
  files: Record<string, string>,
  config: GeekityConfig = {},
): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await temporaryDir('geekity-front-content-');
  const dataDir = await temporaryDir('geekity-front-data-');
  await writeTree(contentDir, files);

  const instance = createCms({ contentDir, dataDir, watch: false, ...config });
  started.push(instance);
  await instance.sync();
  return { cms: instance, contentDir };
}

/** Three published posts and two pages: the shape every test here starts from. */
const CONTENT: Record<string, string> = {
  'posts/2026-09-02-newest.md': post('Newest', '09', 'newest'),
  'posts/2026-08-02-middle.md': post('Middle', '08', 'middle'),
  'posts/2026-07-02-oldest.md': post('Oldest', '07', 'oldest'),
  'pages/welcome.md': page('Welcome', 'welcome', 'Hello and welcome.'),
  'pages/news.md': page('News', 'news', 'Everything as it happens.'),
};

describe('a site whose homepage is a page', () => {
  it('serves that page at / instead of the latest posts (AC #2)', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/site.json': siteJson({ homepage: 'welcome' }),
    });

    const response = await cms.app.request('/');
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /Hello and welcome\./, 'the page’s own body is the front page');
    assert.match(html, /Welcome/);
    assert.doesNotMatch(html, /Newest/, 'and the archive is not');
  });

  it('redirects the page’s own permalink to / so there is one front page (AC #2)', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/site.json': siteJson({ homepage: 'welcome' }),
    });

    const response = await cms.app.request('/welcome/');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/');

    // And the spelling without the trailing slash gets there too, rather than
    // landing on a redirect to a redirect.
    const bare = await cms.app.request('/welcome');
    assert.equal(bare.status, 301);
  });

  it('serves its other representations at / as well (doc-3)', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/site.json': siteJson({ homepage: 'welcome' }),
    });

    const markdown = await cms.app.request('/index.md');
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /Hello and welcome\./);

    const json = await cms.app.request('/index.json');
    assert.equal(json.status, 200);
    const body = (await json.json()) as { url?: string };
    assert.match(body.url ?? '', /\/welcome\/$/, 'the document is still itself');

    const negotiated = await cms.app.request('/', { headers: { accept: 'text/markdown' } });
    assert.equal(negotiated.status, 200);
    assert.match(negotiated.headers.get('content-type') ?? '', /text\/markdown/);
  });

  it('lets a theme lay the front page out on its own, and uses the page layout otherwise (AC #2)', async () => {
    const themesDir = await temporaryDir('geekity-front-themes-');
    const themeDir = path.join(themesDir, 'fixture');
    await writeTree(themeDir, { 'theme.json': JSON.stringify({ name: 'Fixture', kind: 'site' }) });
    const { cms } = await site(
      { ...CONTENT, '_data/site.json': siteJson({ homepage: 'welcome', theme: 'fixture' }) },
      { themesDir },
    );

    const fallback = await (await cms.app.request('/')).text();
    assert.match(fallback, /<p class="page-meta">/, 'the page layout renders it until then');

    await writeTree(themeDir, {
      'layouts/front-page.njk':
        '{% extends "layouts/base.njk" %}{% block content %}<div class="front">{{ title }}: {{ content | safe }}</div>{% endblock %}',
    });

    const html = await (await cms.app.request('/')).text();
    assert.match(html, /<div class="front">Welcome: <p>Hello and welcome\.<\/p>/);

    // It is the front page's layout and nobody else's: every other page still
    // goes through `page.njk`.
    const other = await (await cms.app.request('/news/')).text();
    assert.match(other, /<p class="page-meta">/);
    assert.doesNotMatch(other, /class="front"/);
  });

  it('is the latest posts again when nothing is picked', async () => {
    const { cms } = await site({ ...CONTENT, '_data/site.json': siteJson({}) });

    const html = await (await cms.app.request('/')).text();
    assert.match(html, /Newest/);
    assert.equal((await cms.app.request('/welcome/')).status, 200);
  });
});

describe('the sitemap and the site menu of a site with both picks', () => {
  /** Every `<loc>` in the sitemap, as the path part. */
  async function sitemapPaths(cms: Cms): Promise<string[]> {
    const xml = await (await cms.app.request('/sitemap.xml')).text();
    return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(
      (match) => new URL(match[1] ?? '').pathname,
    );
  }

  it('lists / once, and the listing under the posts page (AC #5)', async () => {
    const cms = await withPostsPage();
    const paths = await sitemapPaths(cms);

    assert.deepEqual(
      paths.filter((path) => path === '/'),
      ['/'],
      'the front page is listed once',
    );
    assert.ok(paths.includes('/news/'), 'the posts page is the listing’s own URL');
    assert.ok(paths.includes('/news/page/2/'), 'and its pages hang off it');
    assert.ok(!paths.includes('/page/2/'), 'nothing is left under the root');
    assert.ok(
      !paths.includes('/welcome/'),
      'the homepage is not advertised at the URL that redirects',
    );
    assert.ok(paths.includes('/2026/09/newest/'), 'the posts are all there');
  });

  it('links the homepage at / and the posts page at its own URL (AC #5)', async () => {
    const { cms } = await site({
      'posts/2026-09-02-newest.md': post('Newest', '09', 'newest'),
      'pages/welcome.md': `---\ntitle: Welcome\npermalink: /welcome/\nnavigation: true\nnavigationOrder: 1\n---\n\nHello.\n`,
      'pages/news.md': `---\ntitle: News\npermalink: /news/\nnavigation: true\n---\n\nThe latest.\n`,
      '_data/site.json': siteJson({ homepage: 'welcome', postsPage: 'news' }),
    });

    const html = await (await cms.app.request('/')).text();
    const nav = /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    const links = [...nav.matchAll(/<a href="([^"]*)"/g)].map((match) => match[1]);

    assert.deepEqual(
      links,
      ['/', '/news/'],
      'the homepage is the site root, the posts page its own',
    );
    assert.match(nav, /<a href="\/"[^>]*aria-current="page"/, 'and it is the page being read');
  });
});

describe('a pick whose page is not published any more', () => {
  it('falls the site back to its latest posts (AC #4)', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/site.json': siteJson({ homepage: 'gone', postsPage: 'news', postsPerPage: 2 }),
    });

    const response = await cms.app.request('/');
    assert.equal(response.status, 200, 'a slug naming nothing is not a 500');
    assert.match(await response.text(), /Newest/);

    assert.equal((await cms.app.request('/page/2/')).status, 200, 'the pages are back at the root');

    const news = await (await cms.app.request('/news/')).text();
    assert.match(news, /<p class="page-meta">/, 'and the posts page is an ordinary page again');
  });

  it('does the same when the page is drafted after it was picked (AC #4)', async () => {
    const { cms, contentDir } = await site({
      ...CONTENT,
      '_data/site.json': siteJson({ homepage: 'welcome' }),
    });

    assert.match(await (await cms.app.request('/')).text(), /Hello and welcome\./);

    await writeTree(contentDir, {
      'pages/welcome.md': `---\ntitle: Welcome\npermalink: /welcome/\ndraft: true\n---\n\nHello and welcome.\n`,
    });
    await cms.sync();

    const response = await cms.app.request('/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Newest/, 'the archive is back at the root');
    assert.equal((await cms.app.request('/welcome/')).status, 404, 'and the draft is not served');
  });
});

/** A site whose front page is Welcome and whose listing is on News, two a page. */
async function withPostsPage(): Promise<Cms> {
  const { cms } = await site({
    ...CONTENT,
    '_data/site.json': siteJson({ homepage: 'welcome', postsPage: 'news', postsPerPage: 2 }),
  });
  return cms;
}

describe('a site with a posts page', () => {
  it('carries the listing at the page’s own URL, under its title and words (AC #3)', async () => {
    const cms = await withPostsPage();

    const response = await cms.app.request('/news/');
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /News/, 'the page’s title heads it');
    assert.match(html, /Everything as it happens\./, 'and its words are above the posts');
    assert.match(html, /Newest/, 'which are the site’s latest');
    assert.match(html, /Middle/);
    assert.doesNotMatch(html, /Oldest/, 'two to a page');
  });

  it('paginates under it, and collapses its first page onto it (AC #3)', async () => {
    const cms = await withPostsPage();

    const second = await cms.app.request('/news/page/2/');
    assert.equal(second.status, 200);
    const html = await second.text();
    assert.match(html, /Oldest/);
    assert.doesNotMatch(html, /Newest/);

    // The links the listing draws point under the posts page as well.
    const first = await (await cms.app.request('/news/')).text();
    assert.match(first, /href="\/news\/page\/2\/"/);

    const collapsed = await cms.app.request('/news/page/1/');
    assert.equal(collapsed.status, 301);
    assert.equal(collapsed.headers.get('location'), '/news/');

    assert.equal((await cms.app.request('/news/page/3/')).status, 404, 'there is no third page');
    const bare = await cms.app.request('/news/page/2');
    assert.equal(bare.status, 301, 'and the spelling without the slash is canonicalised');
    assert.equal(bare.headers.get('location'), '/news/page/2/');
  });

  it('sends the root’s own pagination to it (AC #3)', async () => {
    const cms = await withPostsPage();

    const moved = await cms.app.request('/page/2/');
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get('location'), '/news/page/2/');
  });

  it('keeps the feeds at /feed/ and its siblings, and advertises them (AC #3)', async () => {
    const cms = await withPostsPage();

    for (const path of ['/feed/', '/feed/atom/', '/feed/json/']) {
      const response = await cms.app.request(path);
      assert.equal(response.status, 200, path);
      assert.match(await response.text(), /Newest/, path);
    }

    // Nothing moved under the posts page: a subscriber's URL is the one they
    // already hold.
    assert.equal((await cms.app.request('/news/feed/')).status, 404);

    const html = await (await cms.app.request('/news/')).text();
    assert.match(html, /<link rel="alternate" type="application\/rss\+xml"[^>]*href="\/feed\/"/);
    assert.match(html, /href="\/feed\/atom\/"/);
    assert.match(html, /href="\/feed\/json\/"/);
  });

  it('has no listing at all when a homepage is set without one', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/site.json': siteJson({ homepage: 'welcome', postsPerPage: 2 }),
    });

    assert.equal((await cms.app.request('/page/2/')).status, 404);
    assert.equal((await cms.app.request('/feed/')).status, 200, 'the feeds are still served');
  });

  it('is ignored when it has no homepage beside it', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/site.json': siteJson({ postsPage: 'news' }),
    });

    const html = await (await cms.app.request('/')).text();
    assert.match(html, /Newest/, 'the listing is at the root, where it always was');

    const news = await (await cms.app.request('/news/')).text();
    assert.match(news, /<p class="page-meta">/, 'and News is an ordinary page');
    assert.doesNotMatch(news, /Newest/);
  });
});
