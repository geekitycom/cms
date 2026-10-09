import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const PLAYER = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
const NOT_A_VIDEO = 'https://www.youtube.com/playlist?list=PL1';

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', language: 'en', timezone: 'UTC' }),
  'posts/talk.md': [
    '---',
    'title: The talk',
    "date: '2026-09-02T09:00:00Z'",
    'permalink: /2026/09/talk/',
    '---',
    '',
    'The talk I gave.',
    '',
    VIDEO,
    '',
    NOT_A_VIDEO,
    '',
  ].join('\n'),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-video-content-');
  const dataDir = await box.dir('geekity-video-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE,
    now: () => new Date('2026-09-13T12:00:00Z'),
  });
});

async function body(url: string, accept?: string): Promise<string> {
  const response = await cms.app.request(url, accept === undefined ? {} : { headers: { accept } });
  assert.equal(response.status, 200, `${url} is served`);
  return response.text();
}

describe('a video on its own line in a post', () => {
  it('shows a player on the page, with a link to the video', async () => {
    const html = await body('/2026/09/talk/');

    assert.match(html, new RegExp(`<iframe src="${PLAYER}"[^>]* allowfullscreen></iframe>`));
    assert.match(html, new RegExp(`<figcaption><a href="${escape(VIDEO)}">`));
  });

  it('leaves a YouTube URL that is not a video a plain link', async () => {
    const html = await body('/2026/09/talk/');

    assert.match(
      html,
      new RegExp(`<p><a href="${escape(NOT_A_VIDEO)}">${escape(NOT_A_VIDEO)}</a></p>`),
    );
    assert.equal(html.match(/<iframe/g)?.length, 1, 'one player');
  });

  it('carries the video URL in the Markdown and text/plain representations', async () => {
    assert.match(await body('/2026/09/talk/index.md'), new RegExp(`^${escape(VIDEO)}$`, 'm'));
    assert.match(await body('/2026/09/talk/', 'text/plain'), new RegExp(`^${escape(VIDEO)}$`, 'm'));
  });

  it('carries the video URL and its player in the JSON representation', async () => {
    const json = JSON.parse(await body('/2026/09/talk/index.json')) as {
      markdown: string;
      html: string;
    };

    assert.match(json.markdown, new RegExp(`^${escape(VIDEO)}$`, 'm'));
    assert.match(json.html, new RegExp(`<a href="${escape(VIDEO)}">`));
    assert.match(json.html, new RegExp(`<iframe src="${PLAYER}"`));
  });

  for (const feed of ['/feed/', '/feed/atom/', '/feed/json/']) {
    it(`links the video in ${feed}`, async () => {
      const text = await body(feed);

      assert.ok(text.includes(PLAYER), 'the player');
      assert.ok(
        text.includes(`&lt;a href=&quot;${VIDEO}&quot;&gt;`) ||
          text.includes(`<a href="${VIDEO}">`) ||
          text.includes(`<a href=\\"${VIDEO}\\">`),
        'a link to the video',
      );
    });
  }
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
