import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveNothing } from '../admin/__testing__/harness.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { child, childrenNamed, parseXml } from './__testing__/xml.ts';

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function site(files: Record<string, string>): Promise<Cms> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-feed-photo-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-feed-photo-data-'));
  temporaryDirs.push(contentDir, dataDir);
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  const cms = createCms({
    contentDir,
    dataDir,
    watch: false,
    baseUrl: 'https://example.com',
    hostLookup: resolveNothing,
  });
  started.push(cms);
  await cms.sync();
  return cms;
}

function post(frontMatter: string[], body = ''): string {
  return [
    '---',
    "date: '2026-10-01T09:00:00Z'",
    'permalink: /2026/10/beach/',
    ...frontMatter,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

const PHOTO_ONLY = {
  'posts/2026-10-01-beach.md': post([
    'photo:',
    '  - url: /uploads/2026/10/beach.jpg',
    '    alt: Waves breaking at dusk',
    '  - url: /uploads/2026/10/dog.jpg',
    '  - url: https://cdn.example.org/gull.jpg',
  ]),
  '_data/media.json': JSON.stringify({ '2026/10/dog.jpg': { alt: 'A dog asleep on the sand' } }),
};

const EXPECTED_PHOTOS =
  '<figure><img src="https://example.com/uploads/2026/10/beach.jpg" alt="Waves breaking at dusk"></figure>' +
  '<figure><img src="https://example.com/uploads/2026/10/dog.jpg" alt="A dog asleep on the sand"></figure>' +
  '<figure><img src="https://cdn.example.org/gull.jpg" alt=""></figure>';

interface JsonItems {
  items: { content_html: string; image?: string; attachments?: { url: string }[] }[];
}

describe('a photo-only post in the feeds (TASK-215)', () => {
  it('shows every photo, absolute and with its alt text, in the RSS content', async () => {
    const cms = await site(PHOTO_ONLY);

    const feed = parseXml(await (await cms.app.request('/feed/')).text());
    const item = child(child(feed, 'channel'), 'item');

    assert.equal(child(item, 'content:encoded').text, EXPECTED_PHOTOS);
    assert.deepEqual(childrenNamed(item, 'enclosure'), [], 'a photo is not an enclosure');
  });

  it('shows every photo, absolute and with its alt text, in the Atom content', async () => {
    const cms = await site(PHOTO_ONLY);

    const feed = parseXml(await (await cms.app.request('/feed/atom/')).text());
    const entry = child(feed, 'entry');

    assert.equal(child(entry, 'content').text, EXPECTED_PHOTOS);
    assert.deepEqual(
      childrenNamed(entry, 'link').filter((link) => link.attributes['rel'] === 'enclosure'),
      [],
    );
  });

  it('shows every photo in content_html and names the first as the JSON Feed image', async () => {
    const cms = await site(PHOTO_ONLY);

    const feed = (await (await cms.app.request('/feed/json/')).json()) as JsonItems;
    const [item] = feed.items;

    assert.equal(item?.content_html, EXPECTED_PHOTOS);
    assert.equal(item.image, 'https://example.com/uploads/2026/10/beach.jpg');
    assert.equal(item.attachments, undefined, 'a photo is not an attachment');
  });
});

describe('photos beside a body, an image and a recording (TASK-215)', () => {
  it('prints the photos before the body, as the page does', async () => {
    const cms = await site({
      'posts/2026-10-01-beach.md': post(
        ['title: Beach day', 'photo: /uploads/2026/10/beach.jpg'],
        'Went to the beach.',
      ),
    });

    const feed = (await (await cms.app.request('/feed/json/')).json()) as JsonItems;

    assert.equal(
      feed.items[0]?.content_html,
      '<figure><img src="https://example.com/uploads/2026/10/beach.jpg" alt=""></figure>' +
        '<p>Went to the beach.</p>\n',
    );
  });

  it('keeps the post’s own image as the JSON Feed image', async () => {
    const cms = await site({
      'posts/2026-10-01-beach.md': post([
        'image: /uploads/2026/10/cover.jpg',
        'photo: /uploads/2026/10/beach.jpg',
      ]),
    });

    const feed = (await (await cms.app.request('/feed/json/')).json()) as JsonItems;

    assert.equal(feed.items[0]?.image, 'https://example.com/uploads/2026/10/cover.jpg');
  });

  it('names no JSON Feed image for a post with neither', async () => {
    const cms = await site({ 'posts/2026-10-01-beach.md': post(['title: Words'], 'Only words.') });

    const feed = (await (await cms.app.request('/feed/json/')).json()) as JsonItems;

    assert.equal(feed.items[0]?.image, undefined);
  });

  it('keeps the recording as the only enclosure when a post also has photos', async () => {
    const cms = await site({
      'posts/2026-10-01-beach.md': post([
        'title: Episode one',
        'photo: /uploads/2026/10/beach.jpg',
        'enclosure:',
        '  url: /uploads/2026/10/episode-1.mp3',
        '  type: audio/mpeg',
        '  length: 1234',
      ]),
    });

    const rss = child(
      child(parseXml(await (await cms.app.request('/feed/')).text()), 'channel'),
      'item',
    );
    assert.deepEqual(
      childrenNamed(rss, 'enclosure').map((enclosure) => enclosure.attributes['url']),
      ['https://example.com/uploads/2026/10/episode-1.mp3'],
    );
    assert.match(child(rss, 'content:encoded').text, /beach\.jpg/);

    const atom = child(parseXml(await (await cms.app.request('/feed/atom/')).text()), 'entry');
    assert.deepEqual(
      childrenNamed(atom, 'link')
        .filter((link) => link.attributes['rel'] === 'enclosure')
        .map((link) => link.attributes['href']),
      ['https://example.com/uploads/2026/10/episode-1.mp3'],
    );

    const json = (await (await cms.app.request('/feed/json/')).json()) as JsonItems;
    assert.deepEqual(
      json.items[0]?.attachments?.map((attachment) => attachment.url),
      ['https://example.com/uploads/2026/10/episode-1.mp3'],
    );
  });
});

describe('the feed validator and the media library (TASK-215)', () => {
  it('moves when the library describes a photo the post does not', async () => {
    const files = {
      'posts/2026-10-01-beach.md': post(['photo: /uploads/2026/10/dog.jpg']),
      '_data/media.json': JSON.stringify({ '2026/10/dog.jpg': { alt: 'A dog' } }),
    };
    const before = (await (await site(files)).app.request('/feed/')).headers.get('etag');
    const after = (
      await (
        await site({
          ...files,
          '_data/media.json': JSON.stringify({ '2026/10/dog.jpg': { alt: 'A dog on a rug' } }),
        })
      ).app.request('/feed/')
    ).headers.get('etag');

    assert.notEqual(before, null);
    assert.notEqual(before, after);
  });
});
