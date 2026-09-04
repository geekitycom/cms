/**
 * The demo site, booted the way `pnpm --filter demo dev` boots it.
 *
 * The point of these tests is the override mechanism of decision-6: the demo
 * ships `theme/layouts/post.njk` and `theme/static/style.css`, and everything
 * else — the home page, the tag archives, the 404 — still comes from the
 * package. So the assertions are about what the site actually serves over HTTP,
 * not about which file was read.
 *
 * The content directory and the theme directory are the demo's own, from
 * `geekity.config.ts`. Only the port and the data directory are replaced: the
 * index is derived state, so a run gets a fresh one in a temporary directory
 * and leaves `apps/demo/data/` alone.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createCms } from '@geekity/cms';
import type { Cms } from '@geekity/cms';

import config from '../geekity.config.ts';

let cms: Cms;
let origin: string;
let dataDir: string;

/** GET a path from the running demo site. */
async function get(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(pathname, origin), init);
}

/** GET a path and assert it came back 200, returning the body. */
async function text(pathname: string): Promise<string> {
  const response = await get(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-demo-'));
  cms = createCms({ ...config, port: 0, dataDir, watch: false });
  const { port } = await cms.serve();
  origin = `http://127.0.0.1:${String(port)}`;
});

after(async () => {
  await cms.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe('the demo theme override', () => {
  it('serves a post through the demo post layout, not the packaged one', async () => {
    const body = await text('/2026/08/markdown-on-disk/');

    // The packaged `layouts/post.njk` prints no byline and no reading time;
    // the demo's override adds both, and that is the whole visible difference.
    assert.match(body, /<p class="post-byline">\s*by <span class="p-author">Andrew Shell</);
    assert.match(body, /\d+ minute read/);
  });

  it('keeps the packaged layouts it did not override', async () => {
    const body = await text('/');

    // `layouts/home.njk` and `partials/post-list.njk` are the package's.
    assert.match(body, /class="post-list"/);
    assert.match(body, /Skip to content/);
  });

  it('serves the demo stylesheet at /theme/style.css', async () => {
    const response = await get('/theme/style.css');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');

    const body = await response.text();
    assert.match(body, /Geekity demo/, 'the packaged stylesheet is being served, not the demo one');
  });
});

describe('the demo content', () => {
  it('paginates the home page at the configured postsPerPage', async () => {
    const body = await text('/');
    assert.match(body, /class="pagination"/, 'the home page is not paginated');

    // `postsPerPage` is 2 and five posts are published, so there is a page 2
    // and a page 3 to page through.
    assert.match(await text('/page/2/'), /class="post-list"/);
    assert.match(await text('/page/3/'), /class="post-list"/);
  });

  it('serves the page with an explicit permalink at that permalink', async () => {
    assert.match(await text('/colophon/'), /Colophon/);
  });

  it('serves the post that opted out of the dated permalink', async () => {
    assert.match(await text('/reading-the-index/'), /Reading the index/);
  });

  it('renders footnotes and fenced code in the post that carries them', async () => {
    const body = await text('/2026/07/six-tables-and-a-migration/');
    assert.match(body, /class="footnotes"/, 'markdown-it-footnote did not run');
    assert.match(body, /<code class="language-sql"/, 'the fenced block lost its language class');
  });

  it('keeps the draft off the site', async () => {
    assert.equal((await get('/2026/09/a-draft-nobody-can-see/')).status, 404);
    assert.doesNotMatch(await text('/'), /A draft nobody can see/);
    assert.doesNotMatch(await text('/tag/theme/'), /A draft nobody can see/);
    assert.doesNotMatch(await text('/category/general/'), /A draft nobody can see/);
  });

  it('files its posts under categories, with an archive at /category/{slug}/', async () => {
    const post = await text('/2026/08/markdown-on-disk/');
    assert.match(post, /href="\/category\/engineering\/"/, 'the post links its category');

    const archive = await text('/category/engineering/');
    assert.match(archive, /Markdown on disk/);
    assert.doesNotMatch(archive, /The theme is just templates/, 'filed elsewhere');

    assert.equal((await get('/category/nothing-is-filed-here/')).status, 404);
  });

  it('offers the same document as Markdown and as JSON', async () => {
    const markdown = await get('/2026/08/markdown-on-disk/', {
      headers: { accept: 'text/markdown' },
    });
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /^---\ntitle: Markdown on disk\n/);

    const json = (await (await get('/2026/08/markdown-on-disk/index.json')).json()) as {
      frontMatter: { title: string };
    };
    assert.equal(json.frontMatter.title, 'Markdown on disk');
  });

  it('publishes a feed holding the published posts', async () => {
    const feed = (await (await get('/feed.json')).json()) as { items: { title: string }[] };
    assert.ok(feed.items.length >= 5, `the feed holds only ${String(feed.items.length)} items`);
    assert.ok(!feed.items.some((item) => item.title === 'A draft nobody can see'));
  });
});
