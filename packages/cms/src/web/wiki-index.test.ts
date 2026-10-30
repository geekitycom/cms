import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { saveSettings } from '../admin/__testing__/settings.ts';
import type { Cms } from '../index.ts';
import { shared } from './__testing__/shared.ts';

const box = sandbox();
after(() => box.cleanup());

const NOW = '2026-09-13T12:00:00Z';
const BASE = 'https://blog.example';

const SITE = { '_data/site.json': JSON.stringify({ title: 'A Site', posts_per_page: 2 }) };

const WIKI: Record<string, string> = {
  ...SITE,
  'wiki/garden-tools.md':
    '---\ntitle: Garden tools\ndescription: What is in the shed.\n---\n\nA spade.\n',
  'wiki/apples.md': '---\ntitle: apples\n---\n\nRed.\n',
  'wiki/asparagus.md': '---\ntitle: Asparagus\n---\n\nGreen.\n',
  'wiki/eclairs.md': '---\ntitle: Éclairs\n---\n\nSweet.\n',
  'wiki/beans.md': '---\ntitle: Beans\n---\n\nBroad.\n',
  'wiki/page.md': '---\ntitle: Page\n---\n\nA wiki page called page.\n',
  'wiki/1984.md': '---\ntitle: 1984 harvest\n---\n\nA good year.\n',
  'wiki/unfinished.md': '---\ntitle: Unfinished\ndraft: true\n---\n\nNot yet.\n',
  '_trash/wiki/binned.md': '---\ntitle: Binned\n---\n\nGone.\n',
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
};

const NO_WIKI: Record<string, string> = {
  ...SITE,
  'wiki/unfinished.md': '---\ntitle: Unfinished\ndraft: true\n---\n\nNot yet.\n',
  '_trash/wiki/binned.md': '---\ntitle: Binned\n---\n\nGone.\n',
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
};

async function site(content: Record<string, string> = WIKI): Promise<Cms> {
  const contentDir = await box.dir('geekity-wiki-index-content-');
  for (const [relative, contents] of Object.entries(content)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  return await box.open({
    contentDir,
    dataDir: await box.dir('geekity-wiki-index-data-'),
    baseUrl: BASE,
    now: () => new Date(NOW),
  });
}

const sharedSite = shared(site);

async function body(cms: Cms, pathname: string, init?: RequestInit): Promise<string> {
  const response = await cms.app.request(pathname, init);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

function order(text: string, needles: readonly string[]): void {
  const at = needles.map((needle) => text.indexOf(needle));
  at.forEach((index, i) => {
    assert.ok(index >= 0, `${needles[i] ?? ''} is missing`);
  });
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
    `expected in order: ${needles.join(', ')}`,
  );
}

describe('the wiki index', () => {
  it('lists every published wiki page A to Z, grouped by first letter, on one page', async () => {
    const cms = await sharedSite();
    const html = await body(cms, '/wiki/');

    assert.match(html, /<h1 class="page-title">Wiki<\/h1>/);
    assert.match(html, /<span class="kicker-kind">Wiki<\/span>/);
    order(html, [
      'id="wiki-index-#"',
      '1984 harvest',
      'id="wiki-index-A"',
      '>apples<',
      '>Asparagus<',
      'id="wiki-index-B"',
      '>Beans<',
      'id="wiki-index-E"',
      '>Éclairs<',
      'id="wiki-index-G"',
      '>Garden tools<',
      'id="wiki-index-P"',
      '>Page<',
    ]);
    assert.match(html, /href="\/wiki\/garden-tools\/"/);
    assert.doesNotMatch(html, /Unfinished|Binned|About/);
    assert.doesNotMatch(html, /rel="next"|class="pagination/);
  });

  it('is served as Markdown under a heading for each letter', async () => {
    const cms = await sharedSite();
    const markdown = await body(cms, '/wiki/index.md');
    assert.match(markdown, /^# Wiki$/m);
    order(markdown, [
      '## \\#',
      '- [1984 harvest](/wiki/1984/index.md)',
      '## A',
      '- [apples](/wiki/apples/index.md)',
      '- [Asparagus](/wiki/asparagus/index.md)',
      '## B',
      '## E',
      '- [Éclairs](/wiki/eclairs/index.md)',
      '## G',
      '- [Garden tools](/wiki/garden-tools/index.md): What is in the shed.',
      '## P',
    ]);
    assert.doesNotMatch(markdown, /Unfinished|Binned/);
  });

  it('is served as Gemini text with a link line for each page', async () => {
    const cms = await sharedSite();
    const gemini = await body(cms, '/wiki/index.gmi');
    assert.match(gemini, /^# Wiki$/m);
    order(gemini, [
      '## A',
      '=> /wiki/apples/index.gmi apples',
      '=> /wiki/asparagus/index.gmi Asparagus',
      '## G',
      '=> /wiki/garden-tools/index.gmi Garden tools',
    ]);
  });

  it('is served as JSON, the pages A to Z', async () => {
    const cms = await sharedSite();
    const json = JSON.parse(await body(cms, '/wiki/index.json')) as { url?: string }[];
    assert.deepEqual(
      json.map((entry) => entry.url),
      ['1984', 'apples', 'asparagus', 'beans', 'eclairs', 'garden-tools', 'page'].map(
        (slug) => `${BASE}/wiki/${slug}/`,
      ),
    );
  });

  it('is negotiated at the base, and the base without its slash redirects to it', async () => {
    const cms = await sharedSite();
    const asked = await cms.app.request('/wiki/', { headers: { accept: 'text/markdown' } });
    assert.equal(asked.status, 200);
    assert.match(asked.headers.get('content-type') ?? '', /text\/markdown/);

    const unslashed = await cms.app.request('/wiki');
    assert.equal(unslashed.status, 301);
    assert.equal(unslashed.headers.get('location'), '/wiki/');
  });

  it('leaves a wiki page called page at its own URL, and has no pages or feed of its own', async () => {
    const cms = await sharedSite();
    assert.match(await body(cms, '/wiki/page/'), /A wiki page called page/);
    assert.equal((await cms.app.request('/wiki/page/2/')).status, 404);
    assert.equal((await cms.app.request('/wiki/feed/')).status, 404);
  });

  it('moves with the wiki base', async () => {
    const cms = await site();
    const agent = await signedIn(cms);
    await saveSettings(agent, 'permalinks', { wiki_base: 'notes' });

    assert.match(await body(cms, '/notes/'), /href="\/notes\/garden-tools\/"/);
    for (const [from, to] of [
      ['/wiki/', '/notes/'],
      ['/wiki/index.md', '/notes/index.md'],
      ['/wiki/index.gmi', '/notes/index.gmi'],
      ['/wiki/index.json', '/notes/index.json'],
    ] as const) {
      const moved = await cms.app.request(from);
      assert.equal(moved.status, 301, from);
      assert.equal(moved.headers.get('location'), to, from);
    }
  });

  it('is in the sitemap', async () => {
    const cms = await sharedSite();
    assert.match(await body(cms, '/sitemap.xml'), /<loc>https:\/\/blog\.example\/wiki\/<\/loc>/);
  });

  it('is linked from Markdown as its own .md', async () => {
    const cms = await sharedSite({
      ...WIKI,
      'pages/index-link.md':
        '---\ntitle: Index link\npermalink: /index-link/\n---\n\nSee [the wiki](/wiki/).\n',
    });
    assert.match(await body(cms, '/index-link/index.md'), /\[the wiki\]\(\/wiki\/index\.md\)/);
  });
});

describe('the wiki index with no published wiki pages', () => {
  it('is a 404 in every representation', async () => {
    const cms = await sharedSite(NO_WIKI);
    for (const pathname of ['/wiki/', '/wiki/index.md', '/wiki/index.gmi', '/wiki/index.json']) {
      assert.equal((await cms.app.request(pathname)).status, 404, pathname);
    }
  });

  it('is not in the sitemap', async () => {
    const cms = await sharedSite(NO_WIKI);
    assert.doesNotMatch(await body(cms, '/sitemap.xml'), /\/wiki\//);
  });

  it('is a 404 under a former base too, rather than a redirect to a 404', async () => {
    const cms = await site(NO_WIKI);
    const agent = await signedIn(cms);
    await saveSettings(agent, 'permalinks', { wiki_base: 'notes' });
    assert.equal((await cms.app.request('/wiki/')).status, 404);
  });
});
