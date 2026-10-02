/**
 * A post with a valid `like-of`, `repost-of` or `bookmark-of` cites that page
 * (TASK-169 AC #1): its page and its entry in a listing carry the matching
 * `u-like-of`, `u-repost-of` or `u-bookmark-of` as an `h-cite` a parser reads.
 * Asserted over HTTP against the packaged theme, because the markup is the
 * behaviour.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { mf2 } from 'microformats-parser';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const TARGET = 'https://them.example/2026/09/their-post/';

function post(slug: string, day: string, frontMatter: string[], body: string): string {
  return [
    '---',
    `date: '2026-09-${day}T09:00:00Z'`,
    `permalink: /2026/09/${slug}/`,
    ...frontMatter,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

const CASES = [
  { property: 'like-of', slug: 'liked', type: 'Like' },
  { property: 'repost-of', slug: 'reposted', type: 'Repost' },
  { property: 'bookmark-of', slug: 'bookmarked', type: 'Bookmark' },
] as const;

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/2026-09-10-liked.md': post('liked', '10', [`like-of: ${TARGET}`], ''),
  'posts/2026-09-11-reposted.md': post('reposted', '11', [`repost-of: ${TARGET}`], ''),
  'posts/2026-09-12-bookmarked.md': post(
    'bookmarked',
    '12',
    ['title: A good read', `bookmark-of: ${TARGET}`],
    'Worth coming back to.',
  ),
  'posts/2026-09-09-not-a-like.md': post('not-a-like', '09', ['like-of: their post'], 'Hm.'),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-citations-content-');
  const dataDir = await box.dir('geekity-citations-data-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  cms = await box.open({ contentDir, dataDir, baseUrl: BASE });
});

async function get(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

interface Item {
  type: string[];
  properties: Record<string, unknown[]>;
}

/** The h-entries a page holds, as a microformats parser reads them. */
function entries(html: string, url: string): Item[] {
  const items = mf2(html, { baseUrl: url }).items as Item[];
  const found: Item[] = [];
  const visit = (item: Item & { children?: Item[] }): void => {
    if (item.type.includes('h-entry')) found.push(item);
    for (const child of item.children ?? []) visit(child);
  };
  for (const item of items) visit(item);
  return found;
}

/** The URL each cited h-cite under one property names. */
function cited(entry: Item, property: string): string[] {
  return (entry.properties[property] ?? []).map((value) => {
    const cite = value as Item;
    assert.ok(cite.type.includes('h-cite'), `${property} is an h-cite`);
    return String(cite.properties['url']?.[0]);
  });
}

describe('a like, a repost and a bookmark on their own pages', () => {
  for (const { property, slug, type } of CASES) {
    it(`cites the target as ${property} inside the h-entry`, async () => {
      const url = `${BASE}/2026/09/${slug}/`;
      const html = await get(`/2026/09/${slug}/`);
      const [entry] = entries(html, url);

      assert.ok(entry !== undefined, 'the page has its h-entry');
      assert.deepEqual(cited(entry, property), [TARGET]);
      assert.match(html, new RegExp(`<div class="[^"]*\\bu-${property} h-cite\\b`));
      assert.match(html, new RegExp(`${type}\\b`), 'the page says what kind of post it is');
    });
  }

  it('cites nothing for a like-of that is not a URL', async () => {
    const [entry] = entries(await get('/2026/09/not-a-like/'), `${BASE}/2026/09/not-a-like/`);
    assert.ok(entry !== undefined);
    assert.equal(entry.properties['like-of'], undefined);
  });
});

describe('a like, a repost and a bookmark in a listing', () => {
  it('carries each one’s citation on its own entry', async () => {
    const listed = entries(await get('/'), `${BASE}/`);

    for (const { property, slug } of CASES) {
      const entry = listed.find((one) =>
        (one.properties['url'] ?? []).some((url) => String(url).includes(`/2026/09/${slug}/`)),
      );
      assert.ok(entry !== undefined, `${slug} is listed`);
      assert.deepEqual(cited(entry, property), [TARGET]);
    }
  });
});
