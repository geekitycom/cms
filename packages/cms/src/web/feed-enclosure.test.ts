import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

/** A synced CMS over these files, relative paths to contents. */
async function site(files: Record<string, string | Uint8Array>): Promise<Cms> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-enclosure-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-enclosure-data-'));
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

/** Two plain posts, with nothing a podcast app would look at. */
const PLAIN = {
  'posts/2026-09-01-first.md': [
    '---',
    'title: First',
    "date: '2026-09-01T09:00:00Z'",
    'permalink: /2026/09/first/',
    'tags: [notes]',
    '---',
    '',
    'The first post.',
    '',
  ].join('\n'),
  'posts/2026-09-02-second.md': [
    '---',
    'title: Second',
    "date: '2026-09-02T09:00:00Z'",
    'permalink: /2026/09/second/',
    'description: A summary.',
    '---',
    '',
    'The second post, with a [link](https://example.org/).',
    '',
  ].join('\n'),
};

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * What these posts' three feeds were, byte for byte, before TASK-213. A feed
 * with no recording in it has to stay exactly this, validator included, or
 * every reader polling it would download it again for nothing. A change that
 * means to move them bumps FEED_ITEM_REVISION and these with it.
 */
const BEFORE_RECORDINGS: Record<string, { etag: string; sha256: string }> = {
  '/feed/': {
    etag: '"fdca69ee8605dfc918f3c5fd2e16c21e"',
    sha256: 'e6d764c278395c2ab6e60a981ed0caa921572effe1c929eb9d84f991df928573',
  },
  '/feed/atom/': {
    etag: '"0d0bcce1dcacfcc9cbfc36cb81bf0ed6"',
    sha256: '5236065b0772b50726ec08650945918a6a399b18388c0616c6f7c87ee32a310b',
  },
  '/feed/json/': {
    etag: '"b1e6d72b3c8898b0e3059649af6bb568"',
    sha256: 'e7c8117a31ce46f35a0ccc60779e6840d5bb5c1a28c9082d4679568f09dc4683',
  },
};

/** A post with a recording, written the way the editor writes one. */
function episode(enclosure: string[]): string {
  return [
    '---',
    'title: Episode twelve',
    "date: '2026-09-03T09:00:00Z'",
    'permalink: /2026/09/episode-twelve/',
    'enclosure:',
    ...enclosure.map((line) => `  ${line}`),
    '---',
    '',
    'Show notes.',
    '',
  ].join('\n');
}

const FULL = episode([
  'url: /uploads/2026/09/episode-12.mp3',
  'type: audio/mpeg',
  'length: 23456789',
  'duration: 1834',
  'transcript:',
  '  url: /uploads/2026/09/episode-12.vtt',
  '  type: text/vtt',
  'alternates:',
  '  - url: /uploads/2026/09/episode-12.mp4',
  '    type: video/mp4',
  '    length: 98765432',
  '    title: Video',
  '    height: 720',
  '    lang: en',
  '  - url: https://cdn.example.com/episode-12-low.mp3',
  '    type: audio/mpeg',
  '    title: Low bandwidth & small',
]);

const UNTIMED = episode([
  'url: /uploads/2026/09/episode-12.mp3',
  'type: audio/mpeg',
  'length: 23456789',
]);

describe('a feed with no recording in it (TASK-213 AC #8)', () => {
  it('prints the bytes and the validator it printed before recordings existed', async () => {
    const cms = await site(PLAIN);

    for (const [url, before] of Object.entries(BEFORE_RECORDINGS)) {
      const response = await cms.app.request(url);
      const body = await response.text();
      assert.doesNotMatch(body, /podcast|itunes|enclosure|attachments/, url);
      assert.equal(sha256(body), before.sha256, `${url} prints the same bytes`);
      assert.equal(response.headers.get('etag'), before.etag, `${url} keeps its validator`);
    }
  });
});

describe('a recording in the RSS feed (TASK-213 AC #4 to #8)', () => {
  it('prints the main file, each other version, the transcript and the duration', async () => {
    const cms = await site({ ...PLAIN, 'posts/2026-09-03-episode-twelve.md': FULL });

    const document = parseXml(await (await cms.app.request('/feed/')).text());

    assert.equal(document.attributes['xmlns:podcast'], 'https://podcastindex.org/namespace/1.0');
    assert.equal(document.attributes['xmlns:itunes'], 'http://www.itunes.com/dtds/podcast-1.0.dtd');
    const channel = child(document, 'channel');
    assert.equal(child(channel, 'podcast:medium').text, 'blog');

    const [item, ...plain] = childrenNamed(channel, 'item');
    assert.ok(item !== undefined);
    assert.deepEqual(child(item, 'enclosure').attributes, {
      url: 'https://example.com/uploads/2026/09/episode-12.mp3',
      length: '23456789',
      type: 'audio/mpeg',
    });
    const alternates = childrenNamed(item, 'podcast:alternateEnclosure');
    assert.deepEqual(
      alternates.map((alternate) => ({
        ...alternate.attributes,
        uri: child(alternate, 'podcast:source').attributes['uri'],
      })),
      [
        {
          type: 'video/mp4',
          length: '98765432',
          title: 'Video',
          height: '720',
          lang: 'en',
          uri: 'https://example.com/uploads/2026/09/episode-12.mp4',
        },
        {
          type: 'audio/mpeg',
          title: 'Low bandwidth & small',
          uri: 'https://cdn.example.com/episode-12-low.mp3',
        },
      ],
    );
    assert.deepEqual(child(item, 'podcast:transcript').attributes, {
      url: 'https://example.com/uploads/2026/09/episode-12.vtt',
      type: 'text/vtt',
      rel: 'captions',
    });
    assert.equal(child(item, 'itunes:duration').text, '1834');

    for (const other of plain) {
      assert.deepEqual(
        other.children.filter((element) => /enclosure|podcast:|itunes:/i.test(element.name)),
        [],
        'a post without a recording prints none of it',
      );
    }
  });

  it('leaves the iTunes namespace out when no duration is known', async () => {
    const cms = await site({ ...PLAIN, 'posts/2026-09-03-episode-twelve.md': UNTIMED });

    const body = await (await cms.app.request('/feed/')).text();

    assert.doesNotMatch(body, /itunes/);
    assert.match(body, /xmlns:podcast=/);
    assert.match(body, /<podcast:medium>blog<\/podcast:medium>/);
    assert.doesNotMatch(body, /podcast:transcript|podcast:alternateEnclosure/);
  });

  it('marks an HTML transcript as a transcript rather than captions', async () => {
    const cms = await site({
      'posts/2026-09-03-episode-twelve.md': episode([
        'url: /uploads/2026/09/episode-12.mp3',
        'type: audio/mpeg',
        'length: 23456789',
        'transcript:',
        '  url: https://example.org/transcript.html',
        '  type: text/html',
      ]),
    });

    const body = await (await cms.app.request('/feed/')).text();

    assert.match(
      body,
      /<podcast:transcript url="https:\/\/example\.org\/transcript\.html" type="text\/html"\/>/,
    );
  });
});

describe('a recording in Atom and JSON Feed (TASK-213 AC #7, #9)', () => {
  it('links the main file from the Atom entry', async () => {
    const cms = await site({ ...PLAIN, 'posts/2026-09-03-episode-twelve.md': FULL });

    const feed = parseXml(await (await cms.app.request('/feed/atom/')).text());

    const entries = childrenNamed(feed, 'entry');
    const enclosures = entries.map((entry) =>
      childrenNamed(entry, 'link')
        .filter((link) => link.attributes['rel'] === 'enclosure')
        .map((link) => link.attributes),
    );
    assert.deepEqual(enclosures, [
      [
        {
          rel: 'enclosure',
          type: 'audio/mpeg',
          length: '23456789',
          href: 'https://example.com/uploads/2026/09/episode-12.mp3',
        },
      ],
      [],
      [],
    ]);
  });

  it('lists the main file and the other versions as JSON Feed attachments', async () => {
    const cms = await site({ ...PLAIN, 'posts/2026-09-03-episode-twelve.md': FULL });

    const feed = (await (await cms.app.request('/feed/json/')).json()) as {
      items: { attachments?: unknown }[];
    };

    assert.deepEqual(feed.items[0]?.attachments, [
      {
        url: 'https://example.com/uploads/2026/09/episode-12.mp3',
        mime_type: 'audio/mpeg',
        size_in_bytes: 23456789,
        duration_in_seconds: 1834,
      },
      {
        url: 'https://example.com/uploads/2026/09/episode-12.mp4',
        mime_type: 'video/mp4',
        title: 'Video',
        size_in_bytes: 98765432,
        duration_in_seconds: 1834,
      },
      {
        url: 'https://cdn.example.com/episode-12-low.mp3',
        mime_type: 'audio/mpeg',
        title: 'Low bandwidth & small',
        duration_in_seconds: 1834,
      },
    ]);
    assert.equal(feed.items[1]?.attachments, undefined);
  });

  it('gives no duration in JSON Feed when none is known', async () => {
    const cms = await site({ 'posts/2026-09-03-episode-twelve.md': UNTIMED });

    const body = await (await cms.app.request('/feed/json/')).text();

    assert.match(body, /"attachments"/);
    assert.doesNotMatch(body, /duration_in_seconds/);
  });
});
