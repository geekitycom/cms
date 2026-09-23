/**
 * A post with a valid `in-reply-to` is a reply (Post Type Discovery,
 * TASK-121): its page and its entry in a listing link the post it answers as
 * `u-in-reply-to`, and a reply is headed by its title only when it has one of
 * its own. Asserted over HTTP against the packaged theme, because the markup
 * is the behaviour.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const TARGET = 'https://them.example/2026/09/their-post/';

function reply(frontMatter: string[], body: string): string {
  return ['---', ...frontMatter, '---', '', body, ''].join('\n');
}

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/2026-09-10-agreed.md': reply(
    ["date: '2026-09-10T09:00:00Z'", 'permalink: /2026/09/agreed/', `in-reply-to: ${TARGET}`],
    'Completely agree with this.',
  ),
  'posts/2026-09-09-titled.md': reply(
    [
      'title: On their post',
      "date: '2026-09-09T09:00:00Z'",
      'permalink: /2026/09/titled/',
      `in-reply-to: ${TARGET}`,
    ],
    '![Tomatoes](https://them.example/tomatoes.jpg)\n\nA longer answer, with a photo.',
  ),
  'posts/2026-09-08-not-a-reply.md': reply(
    ["date: '2026-09-08T09:00:00Z'", 'permalink: /2026/09/not-a-reply/', 'in-reply-to: their post'],
    'Nobody in particular.',
  ),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-replies-content-');
  const dataDir = await box.dir('geekity-replies-data-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    cms = await box.open({ contentDir, dataDir });
  } finally {
    console.warn = warn;
  }
});

async function get(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

function main(html: string): string {
  return /<main id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
}

/**
 * Every `u-in-reply-to` in the markup, as the URL it names: the href of a bare
 * link, or the `u-url` of an embedded `h-cite` (TASK-123).
 */
function replyLinks(html: string): string[] {
  const links = [...html.matchAll(/<a\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /class="[^"]*\bu-in-reply-to\b/.test(tag))
    .map((tag) => /href="([^"]*)"/.exec(tag)?.[1] ?? '');
  const cites = [
    ...html.matchAll(/<div class="[^"]*\bu-in-reply-to h-cite\b[^"]*">([\s\S]*?)<\/div>/g),
  ].map((match) => /<a class="u-url\b[^"]*" href="([^"]*)"/.exec(match[1] ?? '')?.[1] ?? '');
  return [...links, ...cites];
}

describe('a reply’s own page', () => {
  it('links the post it answers as u-in-reply-to, inside the h-entry', async () => {
    const article = /<article class="blog-post h-entry">[\s\S]*?<\/article>/.exec(
      main(await get('/2026/09/agreed/')),
    )?.[0];

    assert.ok(article !== undefined, 'the page has its h-entry');
    assert.deepEqual(replyLinks(article), [TARGET]);
  });

  it('draws no heading for a reply with no title of its own', async () => {
    const article = main(await get('/2026/09/agreed/'));

    assert.doesNotMatch(article, /p-name/);
    assert.doesNotMatch(article, /<h1/);
  });

  it('heads a titled reply with its title, photo and all', async () => {
    const article = main(await get('/2026/09/titled/'));

    assert.match(article, /<h1 class="p-name">On their post<\/h1>/);
    assert.deepEqual(replyLinks(article), [TARGET]);
  });

  it('draws no reply link for an in-reply-to that is not a URL', async () => {
    assert.deepEqual(replyLinks(main(await get('/2026/09/not-a-reply/'))), []);
  });
});

describe('a reply in a listing', () => {
  it('carries its u-in-reply-to, and an untitled one is drawn by its words', async () => {
    const listing = main(await get('/'));
    const entry = [...listing.matchAll(/<article class="feed-item h-entry">[\s\S]*?<\/article>/g)]
      .map((match) => match[0])
      .find((one) => one.includes('/2026/09/agreed/'));

    assert.ok(entry !== undefined, 'the reply is listed');
    assert.deepEqual(replyLinks(entry), [TARGET]);
    assert.match(entry, /Completely agree with this\./);
    assert.doesNotMatch(entry, /p-name/);
  });
});

describe('a reply in the feeds', () => {
  it('has no title in JSON Feed when it has no name, and its title when it does', async () => {
    const feed = JSON.parse(await get('/feed/json/')) as {
      items: { url: string; title?: string }[];
    };
    const byUrl = new Map(feed.items.map((item) => [new URL(item.url).pathname, item]));

    assert.equal('title' in (byUrl.get('/2026/09/agreed/') ?? {}), false);
    assert.equal(byUrl.get('/2026/09/titled/')?.title, 'On their post');
  });
});
