import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

function post(day: number, categories: string[], tags: string[]): [string, string] {
  const date = `2026-09-0${String(day)}`;
  return [
    `posts/${date}-day-${String(day)}.md`,
    [
      '---',
      `title: Day ${String(day)}`,
      `date: '${date}T09:00:00Z'`,
      `permalink: /day-${String(day)}/`,
      'categories:',
      ...categories.map((category) => `  - ${category}`),
      'tags:',
      ...tags.map((tag) => `  - ${tag}`),
      '---',
      '',
      `Day ${String(day)}.`,
      '',
    ].join('\n'),
  ];
}

const GENERAL = [
  '/category/general/',
  '/category/general/feed/',
  '/category/general/feed/atom/',
  '/category/general/feed/rdf/',
  '/category/general/feed/rss/',
  '/category/general/feed/rss2/',
  '/category/general/feed/json/',
  '/category/general/page/2/',
];

async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-term-paths-content-');
  const dataDir = await box.dir('geekity-term-paths-data-');
  const files = Object.fromEntries([
    post(1, ['rssCloud'], ['IndieWeb']),
    post(2, ['rssCloud'], ['IndieWeb']),
    post(3, ['rssCloud', 'AI'], ['IndieWeb']),
    post(4, ['ai'], []),
  ]);
  files['_data/site.json'] = JSON.stringify({
    title: 'A Site',
    url: 'https://example.com',
    postsPerPage: 2,
    taxonomyRedirects: [{ taxonomy: 'category', from: 'Old', to: 'rssCloud' }],
  });
  files['_data/redirects/legacy.json'] = JSON.stringify(
    Object.fromEntries(GENERAL.map((source) => [source, '/'])),
  );
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

async function assertRedirect(asked: string, location: string): Promise<void> {
  const response = await get(asked);
  assert.equal(response.status, 301, `${asked} answered ${String(response.status)}`);
  assert.equal(response.headers.get('location'), location, asked);
}

describe('a category asked for in another casing', () => {
  it('redirects to the archive at the site’s spelling, its pages and every feed', async () => {
    for (const [asked, canonical] of [
      ['/category/rsscloud/', '/category/rssCloud/'],
      ['/category/RSSCLOUD/page/2/', '/category/rssCloud/page/2/'],
      ['/category/rsscloud/feed/', '/category/rssCloud/feed/'],
      ['/category/rsscloud/feed/atom/', '/category/rssCloud/feed/atom/'],
      ['/category/rsscloud/feed/json/', '/category/rssCloud/feed/json/'],
      ['/category/rsscloud/feed/rss/', '/category/rssCloud/feed/'],
      ['/category/rsscloud/?feed=rss2', '/category/rssCloud/?feed=rss2'],
      ['/category/rsscloud', '/category/rssCloud/'],
    ] as const) {
      await assertRedirect(asked, canonical);
    }
  });

  it('serves the archive and its feed at the site’s spelling', async () => {
    assert.equal((await get('/category/rssCloud/')).status, 200);
    const feed = await get('/category/rssCloud/feed/');
    assert.equal(feed.status, 200);
    assert.equal([...(await feed.text()).matchAll(/<item>/g)].length, 3);
  });

  it('keeps two categories that differ only in case apart when both are in use', async () => {
    const upper = await (await get('/category/AI/')).text();
    assert.match(upper, /Day 3/);
    assert.doesNotMatch(upper, /Day 4/);
    const lower = await (await get('/category/ai/')).text();
    assert.match(lower, /Day 4/);
    assert.doesNotMatch(lower, /Day 3/);
  });
});

describe('a term path for a term no published post carries', () => {
  it('falls through to the declared redirects, archive, pages and every feed', async () => {
    for (const asked of GENERAL) await assertRedirect(asked, '/');
    await assertRedirect('/category/general', '/');
  });

  it('falls through to the recorded renames, archive and feed', async () => {
    await assertRedirect('/category/Old/', '/category/rssCloud/');
    await assertRedirect('/category/Old/page/2/', '/category/rssCloud/page/2/');
    await assertRedirect('/category/Old/feed/', '/category/rssCloud/feed/');
    await assertRedirect('/category/Old/feed/atom/', '/category/rssCloud/feed/atom/');
  });

  it('answers one 404 when nothing declares it either', async () => {
    for (const asked of [
      '/category/nothing/',
      '/category/nothing/feed/',
      '/category/nothing/feed/atom/',
      '/tag/nothing/',
      '/tag/nothing/feed/rss/',
    ]) {
      assert.equal((await get(asked)).status, 404, asked);
    }
  });

  it('still answers a carried tag’s archive past its last page with a 404', async () => {
    assert.equal((await get('/tag/indieweb/page/3/')).status, 404);
  });
});
