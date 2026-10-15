import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { mf2 } from 'microformats-parser';
import sharp from 'sharp';

import { sandbox } from '../admin/__testing__/harness.ts';
import { generateImageVariants } from '../images/variants.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const COVER = '/uploads/2026/10/peregrine.jpg';
const ALT = 'A girl floating above a beach';
const PERMALINK = '/2026/10/peregrine/';

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', language: 'en', timezone: 'UTC' }),
  'posts/peregrine.md': [
    '---',
    "date: '2026-10-02T09:00:00Z'",
    `permalink: ${PERMALINK}`,
    'read-status: finished',
    'read-of:',
    '  name: Miss Peregrine’s Home for Peculiar Children',
    '  author: Ransom Riggs',
    '  photo:',
    `    url: ${COVER}`,
    `    alt: ${ALT}`,
    '---',
    '',
    'Strange and lovely.',
    '',
  ].join('\n'),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-read-cover-content-');
  const dataDir = await box.dir('geekity-read-cover-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const uploads = path.join(contentDir, 'uploads', '2026', '10');
  await mkdir(uploads, { recursive: true });
  const jpeg = await sharp({
    create: { width: 269, height: 425, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();
  await writeFile(path.join(uploads, 'peregrine.jpg'), jpeg);
  cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE,
    now: () => new Date('2026-10-13T12:00:00Z'),
  });
  await generateImageVariants(cms.config, '2026/10/peregrine.jpg');
});

async function get(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

interface Parsed {
  type?: string[];
  properties: Record<string, unknown[]>;
}

function entryOn(html: string, url: string): Parsed {
  const parsed = mf2(html, { baseUrl: url });
  const entry = (parsed.items as Parsed[]).find((item) => item.type?.includes('h-entry'));
  assert.ok(entry !== undefined, 'the page has an h-entry');
  return entry;
}

function assertCoverOnCitation(entry: Parsed): void {
  assert.equal(entry.properties['photo'], undefined, 'the entry has no u-photo of its own');
  const [cite] = entry.properties['read-of'] as Parsed[];
  assert.deepEqual(cite?.properties['photo'], [{ value: `${BASE}${COVER}`, alt: ALT }]);
}

describe('a read post with a cover (TASK-394)', () => {
  it('is a Read, by its kicker and its type', async () => {
    const html = await get(PERMALINK);
    assert.match(html, /<span class="kicker-kind">Read<\/span>/);
    assert.match(html, /<h1 class="screen-reader-text">\s*Read/);
  });

  it('puts the cover on the read-of h-cite, not on the entry', async () => {
    assertCoverOnCitation(entryOn(await get(PERMALINK), `${BASE}${PERMALINK}`));
  });

  it('prints the cover beside the read line, as a picture at its natural size', async () => {
    const html = await get(PERMALINK);
    const line = /<p class="read-line">[\s\S]*?<\/p>/.exec(html)?.[0] ?? '';
    assert.match(line, /<span class="read-cover"><picture>/);
    assert.match(
      line,
      /<img class="u-photo" src="\/uploads\/2026\/10\/peregrine\.jpg"[^>]*width="269" height="425"/,
    );
    assert.doesNotMatch(html, /class="post-photos"/, 'the cover is not a post photo');
  });

  it('asks for a cover-sized candidate and never fetches the cover first', async () => {
    for (const pathname of [PERMALINK, '/']) {
      const html = await get(pathname);
      const cover = /<span class="read-cover">[\s\S]*?<\/span>/.exec(html)?.[0] ?? '';
      assert.match(cover, /<source [^>]*sizes="6rem"/, `${pathname}: the source is cover-sized`);
      assert.match(cover, /<img [^>]*sizes="6rem"/, `${pathname}: the img is cover-sized`);
      assert.doesNotMatch(cover, /100vw/, `${pathname}: no full-width candidate`);
      assert.doesNotMatch(cover, /fetchpriority/, `${pathname}: the cover is not the lead image`);
      assert.match(cover, /loading="lazy"/, `${pathname}: the cover loads lazily`);
    }
  });

  it('lists the cover on the citation in a listing', async () => {
    const html = await get('/');
    const article = /<article class="feed-item h-entry">[\s\S]*?<\/article>/.exec(html)?.[0] ?? '';
    assert.match(article, /<span class="read-cover">/);
    assertCoverOnCitation(entryOn(article, `${BASE}/`));
  });

  it('carries the cover on the read line in the feeds, absolute, and as no item image', async () => {
    const img = `<img class="u-photo" src="${BASE}${COVER}" alt="${ALT}">`;
    const json = JSON.parse(await get('/feed/json/')) as {
      items: { url: string; content_html?: string; image?: string; summary?: string }[];
    };
    const [item] = json.items;
    assert.ok(item !== undefined, 'the post is in the feed');
    assert.ok(item.content_html?.includes(`<span class="read-cover">${img}</span>`));
    assert.equal(item.image, undefined);
    assert.equal(
      item.summary,
      'Finished reading: Miss Peregrine’s Home for Peculiar Children by Ransom Riggs',
    );
    const escaped = img.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    for (const feed of ['/feed/', '/feed/atom/']) {
      const xml = await get(feed);
      assert.ok(xml.includes(img) || xml.includes(escaped), `${feed} carries the cover`);
    }
  });
});
