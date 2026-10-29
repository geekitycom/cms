import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { saveSettings } from '../admin/__testing__/settings.ts';
import { siteSettingsIn } from '../__testing__/site-settings.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const NOW = '2026-09-13T12:00:00Z';
const BASE = 'https://blog.example';

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'wiki/garden-tools.md':
    "---\ntitle: Garden tools\nupdated: '2026-09-10T09:00:00Z'\ndescription: What is in the shed.\n---\n\nA spade and a fork, and the word marigold.\n",
  'wiki/unfinished.md': '---\ntitle: Unfinished\ndraft: true\n---\n\nNot yet.\n',
  '_trash/wiki/binned.md': '---\ntitle: Binned\n---\n\nGone.\n',
  'posts/citing.md':
    "---\ntitle: Citing the shed\ndate: '2026-09-03T09:00:00Z'\npermalink: /2026/09/citing/\n---\n\nSee [the tools](/wiki/garden-tools/).\n",
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
  'posts/wiki-linking.md':
    "---\ntitle: Linking by name\ndate: '2026-09-04T09:00:00Z'\npermalink: /2026/09/wiki-linking/\n---\n\nRead [[garden-tools|the tools]], [[garden-tools#In the shed|the shed]] and [[Nowhere yet]], not `[[garden-tools]]`.\n",
};

async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-wiki-content-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  return await box.open({
    contentDir,
    dataDir: await box.dir('geekity-wiki-data-'),
    baseUrl: BASE,
    now: () => new Date(NOW),
  });
}

async function body(cms: Cms, pathname: string, init?: RequestInit): Promise<string> {
  const response = await cms.app.request(pathname, init);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

describe('a wiki page on the public site', () => {
  it('is served at its permalink with the wiki layout, its update time and its backlinks', async () => {
    const cms = await site();
    const html = await body(cms, '/wiki/garden-tools/');

    assert.match(html, /<article class="blog-post wiki-page h-entry"/);
    assert.match(html, /<h1 class="p-name">Garden tools<\/h1>/);
    assert.match(html, /A spade and a fork/);
    assert.match(html, /<time class="small dt-updated" datetime="2026-09-10T09:00:00/);
    assert.match(html, /<section class="backlinks"[\s\S]*Citing the shed[\s\S]*<\/section>/);
  });

  it('is served as Markdown, Gemini text and JSON', async () => {
    const cms = await site();
    assert.match(await body(cms, '/wiki/garden-tools/index.md'), /A spade and a fork/);
    assert.match(await body(cms, '/wiki/garden-tools/index.gmi'), /A spade and a fork/);
    const json = JSON.parse(await body(cms, '/wiki/garden-tools/index.json')) as {
      url?: string;
      markdown?: string;
    };
    assert.equal(json.url, `${BASE}/wiki/garden-tools/`);
    assert.match(json.markdown ?? '', /A spade and a fork/);
  });

  it('is a 404 while a draft and a 410 once trashed, as a page is', async () => {
    const cms = await site();
    assert.equal((await cms.app.request('/wiki/unfinished/')).status, 404);
    assert.equal((await cms.app.request('/wiki/binned/')).status, 410);
  });
});

describe('where wiki pages are listed', () => {
  it('in site search', async () => {
    const cms = await site();
    const html = await body(cms, '/search/?q=marigold');
    assert.match(html, /\/wiki\/garden-tools\//);
    assert.match(html, /<span class="kicker-kind">Wiki<\/span>/);
  });

  it('in the sitemap', async () => {
    const cms = await site();
    const xml = await body(cms, '/sitemap.xml');
    assert.match(xml, /<loc>https:\/\/blog\.example\/wiki\/garden-tools\/<\/loc>/);
    assert.doesNotMatch(xml, /unfinished|binned/);
  });

  it('in a section of their own in /llms.txt', async () => {
    const cms = await site();
    const text = await body(cms, '/llms.txt');
    const wiki = text.slice(text.indexOf('## Wiki'));
    assert.ok(text.includes('## Wiki'), text);
    assert.match(
      wiki,
      /^- \[Garden tools\]\(https:\/\/blog\.example\/wiki\/garden-tools\/index\.md\)/m,
    );
    const pages = text.slice(text.indexOf('## Pages'), text.indexOf('## Wiki'));
    assert.doesNotMatch(pages, /garden-tools/);
  });
});

describe('where wiki pages are not listed', () => {
  it('in the feeds, the home page or the archives', async () => {
    const cms = await site();
    for (const pathname of ['/feed/', '/feed/atom/', '/feed/json/', '/', '/2026/', '/2026/09/']) {
      const response = await cms.app.request(pathname);
      const text = await response.text();
      assert.doesNotMatch(text, /Garden tools|marigold/, pathname);
    }
  });

  it('on the fediverse', async () => {
    const cms = await site();
    const html = await body(cms, '/wiki/garden-tools/');
    assert.doesNotMatch(html, /application\/activity\+json/);
    const asked = await cms.app.request('/wiki/garden-tools/', {
      headers: { accept: 'application/activity+json' },
    });
    assert.notEqual(asked.headers.get('content-type'), 'application/activity+json');
  });
});

describe('a change of wiki base', () => {
  it('moves every wiki page, and the old URL answers with a 301 to the new one', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    const saved = await saveSettings(agent, 'permalinks', { wiki_base: 'notes' });
    assert.equal(saved.status, 303);

    assert.equal((await cms.app.request('/notes/garden-tools/')).status, 200);
    const moved = await cms.app.request('/wiki/garden-tools/');
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get('location'), '/notes/garden-tools/');

    const markdown = await cms.app.request('/wiki/garden-tools/index.md');
    assert.equal(markdown.status, 301);
    assert.equal(markdown.headers.get('location'), '/notes/garden-tools/index.md');

    assert.equal((await cms.app.request('/wiki/nothing-here/')).status, 404);
    assert.deepEqual((await siteSettingsIn(cms.config.contentDir)).former_wiki_bases, ['wiki']);
  });

  it('back again forgets the base it returns to', async () => {
    const cms = await site();
    const agent = await signedIn(cms);
    await saveSettings(agent, 'permalinks', { wiki_base: 'notes' });
    await saveSettings(agent, 'permalinks', { wiki_base: 'wiki' });

    assert.equal((await cms.app.request('/wiki/garden-tools/')).status, 200);
    const moved = await cms.app.request('/notes/garden-tools/');
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get('location'), '/wiki/garden-tools/');
    assert.deepEqual((await siteSettingsIn(cms.config.contentDir)).former_wiki_bases, ['notes']);
  });
});

describe('a wiki link', () => {
  it('is a link in the HTML, in the feeds and in the backlinks of its target', async () => {
    const cms = await site();
    const html = await body(cms, '/2026/09/wiki-linking/');
    assert.match(html, /<a class="wiki-link" href="\/wiki\/garden-tools\/">the tools<\/a>/);
    assert.match(
      html,
      /<a class="wiki-link" href="\/wiki\/garden-tools\/#in-the-shed">the shed<\/a>/,
    );
    assert.match(html, /<a class="wiki-link" href="\/wiki\/nowhere-yet\/">Nowhere yet<\/a>/);
    assert.match(html, /<code>\[\[garden-tools\]\]<\/code>/);

    const feed = await body(cms, '/feed/');
    assert.match(
      feed,
      /<a class="wiki-link" href="https:\/\/blog\.example\/wiki\/garden-tools\/">/,
    );

    const target = await body(cms, '/wiki/garden-tools/');
    assert.match(target, /<section class="backlinks"[\s\S]*Linking by name[\s\S]*<\/section>/);
  });

  it('is an ordinary Markdown link in index.md and a link line in index.gmi', async () => {
    const cms = await site();
    const markdown = await body(cms, '/2026/09/wiki-linking/index.md');
    assert.match(markdown, /\[the tools\]\(\/wiki\/garden-tools\/index\.md\)/);
    assert.match(markdown, /\[the shed\]\(\/wiki\/garden-tools\/index\.md#in-the-shed\)/);
    assert.match(markdown, /\[Nowhere yet\]\(\/wiki\/nowhere-yet\/\)/);
    assert.match(markdown, /`\[\[garden-tools\]\]`/);
    assert.doesNotMatch(markdown, /\[\[garden-tools\|/);

    const gemini = await body(cms, '/2026/09/wiki-linking/index.gmi');
    assert.match(gemini, /^Read the tools\[1\], the shed\[2\] and Nowhere yet\[3\]/m);
    assert.match(gemini, /^=> \/wiki\/garden-tools\/index\.gmi 1: /m);
    assert.match(gemini, /^=> \/wiki\/garden-tools\/index\.gmi#in-the-shed 2: /m);
    assert.match(gemini, /^=> \/wiki\/nowhere-yet\/ 3: /m);
    assert.doesNotMatch(gemini, /\[\[garden-tools\|/);
  });

  it('follows a change of wiki base', async () => {
    const cms = await site();
    const agent = await signedIn(cms);
    await saveSettings(agent, 'permalinks', { wiki_base: 'notes' });

    const html = await body(cms, '/2026/09/wiki-linking/');
    assert.match(html, /<a class="wiki-link" href="\/notes\/garden-tools\/">the tools<\/a>/);
    assert.doesNotMatch(html, /href="\/wiki\//);
    assert.match(
      await body(cms, '/2026/09/wiki-linking/index.md'),
      /\(\/notes\/garden-tools\/index\.md\)/,
    );
  });
});
