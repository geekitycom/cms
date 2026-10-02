/**
 * A post's photos in the default theme (TASK-166): each one an `img.u-photo`
 * inside the h-entry, and each one an ImageObject in the JSON-LD.
 */
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

function post(slug: string, frontMatter: string[], body = ''): string {
  return [
    '---',
    "date: '2026-09-02T09:00:00Z'",
    `permalink: /2026/09/${slug}/`,
    ...frontMatter,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', language: 'en', timezone: 'UTC' }),
  '_data/media.json': JSON.stringify({ '2026/09/dog.jpg': { alt: 'A dog asleep on a rug' } }),
  'posts/beach.md': post(
    'beach',
    [
      'photo:',
      '  - url: /uploads/2026/09/beach.jpg',
      '    alt: Waves breaking at dusk',
      '  - url: /uploads/2026/09/dog.jpg',
      '  - url: https://cdn.example/cat.webp',
      '    alt: A cat on a wall',
    ],
    'A day at the beach.',
  ),
  'posts/plain.md': post('plain', ['title: Just words'], 'Nothing to see.'),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-photo-content-');
  const dataDir = await box.dir('geekity-photo-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const uploads = path.join(contentDir, 'uploads', '2026', '09');
  await mkdir(uploads, { recursive: true });
  const jpeg = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();
  await writeFile(path.join(uploads, 'beach.jpg'), jpeg);
  await writeFile(path.join(uploads, 'dog.jpg'), jpeg);
  cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE,
    now: () => new Date('2026-09-13T12:00:00Z'),
  });
  await generateImageVariants(cms.config, '2026/09/beach.jpg');
});

async function page(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200);
  return await response.text();
}

describe('photos in the default theme (AC #2, AC #7)', () => {
  it('renders each photo as an img.u-photo with its alt text inside the h-entry', async () => {
    const html = await page('/2026/09/beach/');
    const [entry] = mf2(html, { baseUrl: `${BASE}/2026/09/beach/` }).items.filter((item) =>
      item.type?.includes('h-entry'),
    );
    assert.ok(entry !== undefined, 'the page has an h-entry');
    assert.deepEqual(entry.properties['photo'], [
      { value: `${BASE}/uploads/2026/09/beach.jpg`, alt: 'Waves breaking at dusk' },
      { value: `${BASE}/uploads/2026/09/dog.jpg`, alt: 'A dog asleep on a rug' },
      { value: 'https://cdn.example/cat.webp', alt: 'A cat on a wall' },
    ]);
  });

  it('serves an upload whose variants exist as a responsive picture', async () => {
    const html = await page('/2026/09/beach/');
    assert.match(
      html,
      /<picture>(?:<source[^>]*>)*<img class="u-photo" src="\/uploads\/2026\/09\/beach\.jpg" alt="Waves breaking at dusk"[^>]* srcset="[^"]+"/,
    );
  });

  it('prints no photo markup on a post without photos', async () => {
    assert.doesNotMatch(await page('/2026/09/plain/'), /u-photo/);
  });

  it('names the photo post by its type', async () => {
    assert.match(await page('/2026/09/beach/'), />\s*Photo\s*</);
  });
});

describe('a photo post’s share image', () => {
  it('is its first photo, described by its alt text', async () => {
    const html = await page('/2026/09/beach/');
    assert.match(
      html,
      /<meta property="og:image" content="https:\/\/blog\.example\/uploads\/2026\/09\/beach\.jpg">/,
    );
    assert.match(html, /<meta property="og:image:alt" content="Waves breaking at dusk">/);
  });
});

describe('photos in the JSON-LD (AC #8)', () => {
  function entryNode(html: string): Record<string, unknown> {
    const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    assert.ok(script !== undefined, 'the page has JSON-LD');
    const graph = (JSON.parse(script) as { '@graph': Record<string, unknown>[] })['@graph'];
    const node = graph.find((item) => item['@type'] === 'BlogPosting');
    assert.ok(node !== undefined, 'the graph has a BlogPosting');
    return node;
  }

  it('lists each photo as an ImageObject with its absolute URL and its alt as the caption', async () => {
    assert.deepEqual(entryNode(await page('/2026/09/beach/'))['image'], [
      {
        '@type': 'ImageObject',
        url: `${BASE}/uploads/2026/09/beach.jpg`,
        caption: 'Waves breaking at dusk',
      },
      {
        '@type': 'ImageObject',
        url: `${BASE}/uploads/2026/09/dog.jpg`,
        caption: 'A dog asleep on a rug',
      },
      { '@type': 'ImageObject', url: 'https://cdn.example/cat.webp', caption: 'A cat on a wall' },
    ]);
  });
});
