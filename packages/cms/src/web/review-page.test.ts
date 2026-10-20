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
const POSTER = '/uploads/2026/10/dune.jpg';
const CUP = '/uploads/2026/10/cup.jpg';
const ALT = 'The poster for Dune Part Two';

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', language: 'en', timezone: 'UTC' }),
  'posts/2026-10-19-dune.md': [
    '---',
    "date: '2026-10-19T09:00:00Z'",
    'permalink: /2026/10/dune/',
    'rating: 4',
    'item:',
    '  kind: movie',
    '  name: "Dune: Part Two"',
    '  by: Denis Villeneuve',
    '  year: 2024',
    '  uid: https://www.themoviedb.org/movie/693134',
    '  photo:',
    `    url: ${POSTER}`,
    `    alt: ${ALT}`,
    '  date: 2026-10-18',
    '---',
    '',
    'Loud and long, in the best way.',
    '',
  ].join('\n'),
  'posts/2026-10-18-severance.md': [
    '---',
    "date: '2026-10-18T09:00:00Z'",
    'permalink: /2026/10/severance/',
    'item:',
    '  kind: tv',
    '  name: Severance',
    '  season: 2',
    '---',
    '',
    'No stars for this one yet.',
    '',
  ].join('\n'),
  'posts/2026-10-17-blue-door.md': [
    '---',
    "date: '2026-10-17T09:00:00Z'",
    'permalink: /2026/10/blue-door/',
    'rating: 5',
    'item:',
    '  kind: place',
    '  name: Blue Door Coffee',
    '  category: Coffee shop',
    '  locality: Grand Rapids',
    'photo:',
    `  - url: ${CUP}`,
    '    alt: A flat white on a blue table',
    '---',
    '',
    'Good coffee.',
    '',
  ].join('\n'),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-review-content-');
  const dataDir = await box.dir('geekity-review-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const uploads = path.join(contentDir, 'uploads', '2026', '10');
  await mkdir(uploads, { recursive: true });
  for (const name of ['dune.jpg', 'cup.jpg']) {
    const jpeg = await sharp({
      create: { width: 400, height: 600, channels: 3, background: { r: 200, g: 140, b: 60 } },
    })
      .jpeg()
      .toBuffer();
    await writeFile(path.join(uploads, name), jpeg);
  }
  cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE,
    now: () => new Date('2026-10-20T12:00:00Z'),
  });
  await generateImageVariants(cms.config, '2026/10/dune.jpg');
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

function reviewOn(html: string, url: string): Parsed {
  const parsed = mf2(html, { baseUrl: url });
  const review = (parsed.items as Parsed[]).find((item) => item.type?.includes('h-review'));
  assert.ok(review !== undefined, 'the page has an h-review');
  return review;
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

describe('a review’s page (TASK-432)', () => {
  it('is a Review, by its kicker and its hidden heading', async () => {
    const html = await get('/2026/10/dune/');
    assert.match(html, /<span class="kicker-kind">Review<\/span>/);
    assert.match(html, /<h1 class="screen-reader-text">\s*Review/);
  });

  it('marks the post up as an h-review with p-item, p-rating, p-best and e-content', async () => {
    const review = reviewOn(await get('/2026/10/dune/'), `${BASE}/2026/10/dune/`);
    assert.deepEqual(review.type, ['h-entry', 'h-review']);
    assert.deepEqual(review.properties['rating'], ['4']);
    assert.deepEqual(review.properties['best'], ['5']);
    const [item] = review.properties['item'] as Parsed[];
    assert.deepEqual(item?.type, ['h-cite']);
    assert.deepEqual(item?.properties['name'], ['Dune: Part Two']);
    assert.deepEqual(item?.properties['author'], ['Denis Villeneuve']);
    assert.deepEqual(item?.properties['photo'], [{ value: `${BASE}${POSTER}`, alt: ALT }]);
    assert.equal(review.properties['photo'], undefined, 'the poster is the item’s, not the post’s');
    const [content] = review.properties['content'] as { value: string }[];
    assert.equal(content?.value.trim().startsWith('Loud and long, in the best way.'), true);
  });

  it('prints the picture beside the details, as a picture sized for it', async () => {
    const html = await get('/2026/10/dune/');
    const block =
      /<div class="review">[\s\S]*?<\/div>\n?<p class="review-rating">[\s\S]*?<\/p>/.exec(
        html,
      )?.[0];
    assert.ok(block !== undefined, 'the review block is on the page');
    assert.match(block, /<span class="review-picture"><picture>/);
    assert.match(block, /<img [^>]*sizes="8rem"/);
    assert.match(
      text(block),
      /Review of Dune: Part Two \(movie, 2024\), directed by Denis Villeneuve/,
    );
    assert.match(text(block), /Watched on 18 October 2026/);
    assert.doesNotMatch(html, /class="post-photos"/);
  });

  it('shows the rating as stars hidden from a screen reader, and as words', async () => {
    const html = await get('/2026/10/dune/');
    assert.match(html, /<span class="review-stars" aria-hidden="true">★★★★☆<\/span>/);
    assert.match(text(html), /Rated 4 out of 5/);
  });

  it('prints no stars for a review without a rating, which is still an h-review', async () => {
    const html = await get('/2026/10/severance/');
    assert.doesNotMatch(html, /review-stars|p-rating|p-best/);
    const review = reviewOn(html, `${BASE}/2026/10/severance/`);
    assert.equal(review.properties['rating'], undefined);
    const [item] = review.properties['item'] as Parsed[];
    assert.deepEqual(item?.properties['name'], ['Severance']);
    assert.match(text(html), /Season 2/);
  });

  it('shows a place review’s photos as post photos, apart from the item', async () => {
    const html = await get('/2026/10/blue-door/');
    const review = reviewOn(html, `${BASE}/2026/10/blue-door/`);
    const [item] = review.properties['item'] as Parsed[];
    assert.deepEqual(item?.type, ['h-card']);
    assert.equal(item?.properties['photo'], undefined);
    assert.deepEqual(review.properties['photo'], [
      { value: `${BASE}${CUP}`, alt: 'A flat white on a blue table' },
    ]);
    assert.match(html, /<div class="post-photos">/);
  });

  it('lists the item and the rating on the home page', async () => {
    const html = await get('/');
    const entry = /<article class="feed-item h-entry h-review">[\s\S]*?<\/article>/.exec(html)?.[0];
    assert.ok(entry !== undefined, 'a review is listed as an h-review');
    assert.match(entry, /<div class="review">/);
    assert.match(text(entry), /Rated 4 out of 5/);
  });
});

describe('a review in the feeds (TASK-432)', () => {
  it('says what was reviewed and the rating, and carries the item picture absolute', async () => {
    const img = `<img class="u-photo" src="${BASE}${POSTER}" alt="${ALT}">`;
    const json = JSON.parse(await get('/feed/json/')) as {
      items: { url: string; content_html?: string }[];
    };
    const item = json.items.find((entry) => entry.url === `${BASE}/2026/10/dune/`);
    assert.ok(item?.content_html !== undefined, 'the review is in the feed');
    assert.ok(item.content_html.includes(`<span class="review-picture">${img}</span>`));
    assert.match(text(item.content_html), /Review of Dune: Part Two \(movie, 2024\)/);
    assert.match(text(item.content_html), /Rated 4 out of 5/);
    assert.equal(
      (
        json.items.find((entry) => entry.url === `${BASE}/2026/10/severance/`) as {
          summary?: string;
        }
      ).summary,
      'Review of Severance (TV show). Season 2. No stars for this one yet.',
    );
    const escaped = img.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    for (const feed of ['/feed/', '/feed/atom/']) {
      const xml = await get(feed);
      assert.ok(xml.includes(img) || xml.includes(escaped), `${feed} carries the picture`);
      assert.match(
        xml,
        /Review of Dune: Part Two \(movie, 2024\), directed by Denis Villeneuve\. Watched on 18 October 2026\. Rated 4 out of 5\. Loud and long, in the best way\./,
        `${feed} says it in its plain-text summary`,
      );
    }
  });
});
