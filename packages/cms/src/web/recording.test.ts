import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

function post(slug: string, title: string, enclosure: string[] = []): string {
  return [
    '---',
    `title: ${title}`,
    "date: '2026-09-02T09:00:00Z'",
    `permalink: /2026/09/${slug}/`,
    ...(enclosure.length === 0 ? [] : ['enclosure:', ...enclosure.map((line) => `  ${line}`)]),
    '---',
    '',
    'Show notes.',
    '',
  ].join('\n');
}

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', language: 'en', timezone: 'UTC' }),
  'posts/audio.md': post('audio', 'Episode twelve', [
    'url: /uploads/2026/09/episode-12.mp3',
    'type: audio/mpeg',
    'length: 23456789',
    'transcript:',
    '  url: /uploads/2026/09/episode-12.vtt',
    '  type: text/vtt',
    'alternates:',
    '  - url: /uploads/2026/09/episode-12.mp4',
    '    type: video/mp4',
    '    length: 98765432',
    '    title: Video',
    '  - url: https://cdn.example.com/episode-12-low.mp3',
    '    type: audio/mpeg',
    '    lang: en',
  ]),
  'posts/video.md': post('video', 'Screencast', [
    'url: /uploads/2026/09/screencast.webm',
    'type: video/webm',
    'length: 4096',
    'transcript:',
    '  url: /uploads/2026/09/screencast.vtt',
    '  type: text/vtt',
  ]),
  'posts/plain.md': post('plain', 'Just words'),
  'posts/broken.md': post('broken', 'Half a recording', [
    'url: /uploads/2026/09/episode-13.mp3',
    'type: audio/mpeg',
  ]),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-recording-content-');
  const dataDir = await box.dir('geekity-recording-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  cms = await box.open({ contentDir, dataDir, now: () => new Date('2026-09-13T12:00:00Z') });
});

async function page(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

describe('a recording on the post page (TASK-213 AC #10)', () => {
  it('plays audio in an audio element, and links the versions and the transcript', async () => {
    const html = await page('/2026/09/audio/');

    assert.match(
      html,
      /<audio controls preload="metadata" aria-label="Recording of Episode twelve">\s*<source class="u-audio" src="\/uploads\/2026\/09\/episode-12\.mp3" type="audio\/mpeg">/,
    );
    assert.doesNotMatch(html, /<video/);
    assert.match(html, /<a href="\/uploads\/2026\/09\/episode-12\.vtt">Captions<\/a>/);
    assert.match(
      html,
      /<a href="\/uploads\/2026\/09\/episode-12\.mp4" type="video\/mp4">Video<\/a>/,
      'a titled version by its title',
    );
    assert.match(
      html,
      /<a href="https:\/\/cdn\.example\.com\/episode-12-low\.mp3" type="audio\/mpeg" hreflang="en">audio\/mpeg<\/a>/,
      'an untitled version by its type',
    );
  });

  it('plays video in a video element, with WebVTT captions as a track', async () => {
    const html = await page('/2026/09/video/');

    assert.match(
      html,
      /<video controls preload="metadata" aria-label="Recording of Screencast">\s*<source class="u-video" src="\/uploads\/2026\/09\/screencast\.webm" type="video\/webm">\s*<track kind="captions" src="\/uploads\/2026\/09\/screencast\.vtt" srclang="en" label="Captions" default>/,
    );
    assert.doesNotMatch(html, /<audio/);
  });

  it('prints nothing on a post without one, or with one missing its length', async () => {
    for (const pathname of ['/2026/09/plain/', '/2026/09/broken/']) {
      const html = await page(pathname);
      assert.doesNotMatch(html, /<audio|<video|post-recording/, pathname);
    }
  });
});
