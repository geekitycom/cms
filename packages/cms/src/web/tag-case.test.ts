import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

function post(day: number, tags: string[]): [string, string] {
  const date = `2026-09-0${String(day)}`;
  return [
    `posts/${date}-day-${String(day)}.md`,
    [
      '---',
      `title: Day ${String(day)}`,
      `date: '${date}T09:00:00Z'`,
      `permalink: /day-${String(day)}/`,
      'tags:',
      ...tags.map((tag) => `  - ${tag}`),
      '---',
      '',
      `Day ${String(day)}.`,
      '',
    ].join('\n'),
  ];
}

async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-tag-case-content-');
  const dataDir = await box.dir('geekity-tag-case-data-');
  const files = Object.fromEntries([
    post(1, ['opensource']),
    post(2, ['OpenSource']),
    post(3, ['OpenSource', 'IndieWeb']),
  ]);
  files['_data/site.json'] = JSON.stringify({
    title: 'A Site',
    url: 'https://example.com',
    postsPerPage: 2,
  });
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  return box.open({ contentDir, dataDir, baseUrl: 'https://example.com' });
}

const cms = site();

async function get(pathname: string): Promise<Response> {
  return (await cms).app.request(pathname);
}

describe('a tag archive', () => {
  it('holds every casing of the tag, headed by the spelling most posts use', async () => {
    const response = await get('/tag/opensource/');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<h1 class="page-title">OpenSource<\/h1>/);
    assert.match(html, /Day 3/);
    assert.match(html, /Day 2/);
    assert.doesNotMatch(html, /Day 1/, 'the third post is on page two');

    const second = await get('/tag/opensource/page/2/');
    assert.equal(second.status, 200);
    assert.match(await second.text(), /Day 1/);
  });

  it('redirects any other casing to the lower-case URL, its pages and its feeds too', async () => {
    for (const [asked, canonical] of [
      ['/tag/OpenSource/', '/tag/opensource/'],
      ['/tag/OPENSOURCE/page/2/', '/tag/opensource/page/2/'],
      ['/tag/OpenSource/feed/', '/tag/opensource/feed/'],
      ['/tag/OpenSource/feed/atom/', '/tag/opensource/feed/atom/'],
      ['/tag/IndieWeb/feed/json/', '/tag/indieweb/feed/json/'],
      ['/tag/OpenSource', '/tag/opensource/'],
    ] as const) {
      const response = await get(asked);
      assert.equal(response.status, 301, `${asked} answered ${String(response.status)}`);
      assert.equal(response.headers.get('location'), canonical, asked);
    }
  });

  it('answers a casing of a tag nothing carries with one 404', async () => {
    assert.equal((await get('/tag/Nothing/')).status, 404);
    assert.equal((await get('/tag/Nothing/feed/')).status, 404);
  });

  it('feeds every casing, each item filed under the site’s spelling', async () => {
    const response = await get('/tag/opensource/feed/');
    assert.equal(response.status, 200);
    const xml = await response.text();
    assert.equal([...xml.matchAll(/<item>/g)].length, 3);
    assert.equal([...xml.matchAll(/<category>OpenSource<\/category>/g)].length, 3);
    assert.doesNotMatch(xml, /<category>opensource<\/category>/);
  });

  it('links a post’s tags to the lower-case archive in the site’s spelling', async () => {
    const html = await (await get('/day-1/')).text();
    assert.match(
      html,
      /<a href="\/tag\/opensource\/" class="p-category" rel="tag">OpenSource<\/a>/,
    );
    assert.match(html, /<meta property="article:tag" content="OpenSource">/);
  });

  it('lists the archive once in the sitemap', async () => {
    const xml = await (await get('/sitemap.xml')).text();
    assert.equal([...xml.matchAll(/\/tag\/opensource\/<\/loc>/g)].length, 1);
    assert.doesNotMatch(xml, /\/tag\/OpenSource\//);
  });
});
