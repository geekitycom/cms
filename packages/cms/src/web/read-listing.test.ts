import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { createUser } from '../site/users.ts';

const box = sandbox();
after(() => box.cleanup());

const READ_LINE_TEXT = 'Finished reading: Dune by Frank Herbert, ISBN: 9780441013593';

function file(slug: string, day: string, title: string | undefined, words: string): string {
  return [
    '---',
    ...(title === undefined ? [] : [`title: ${title}`]),
    `date: '2026-09-${day}T09:00:00Z'`,
    `permalink: /2026/09/${slug}/`,
    'author: ada',
    'tags:',
    '  - books',
    'categories:',
    '  - reading',
    'read-status: finished',
    'read-of:',
    '  name: Dune',
    '  author: Frank Herbert',
    '  uid: isbn:9780441013593',
    '---',
    '',
    words,
    '',
  ].join('\n');
}

const LISTINGS = ['/', '/tag/books/', '/category/reading/', '/author/ada/'];

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-read-listing-content-');
  const dataDir = await box.dir('geekity-read-listing-data-');
  const files: Record<string, string> = {
    '_data/site.json': JSON.stringify({ title: 'A Site' }),
    'posts/titled-read.md': file('titled-read', '10', 'Dune, again', 'I enjoyed this book.'),
    'posts/bare-read.md': file('bare-read', '11', 'Dune, briefly', ''),
    'posts/untitled-read.md': file('untitled-read', '12', undefined, 'Short thoughts.'),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }
  await createUser({ dataDir, username: 'ada', password: 'a password of hers' });
  cms = await box.open({ contentDir, dataDir });
});

async function get(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

function article(html: string, slug: string): string {
  const found = [...html.matchAll(/<article class="feed-item h-entry">[\s\S]*?<\/article>/g)]
    .map((match) => match[0])
    .find((one) => one.includes(`/2026/09/${slug}/`));
  assert.ok(found !== undefined, `${slug} is listed`);
  return found;
}

function ascending(html: string, patterns: RegExp[], message: string): void {
  const positions = patterns.map((pattern) => html.search(pattern));
  assert.ok(
    positions.every((position) => position >= 0),
    `${message}: all present (${positions.join(', ')})`,
  );
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    `${message}: in order`,
  );
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUMMARY = /<div class="feed-excerpt p-summary">([\s\S]*?)<\/div>/;

describe('a read post on a listing', () => {
  for (const listing of LISTINGS) {
    describe(listing, () => {
      it('lists a titled read by kicker, headline and summary, then its read line', async () => {
        const html = article(await get(listing), 'titled-read');
        ascending(
          html,
          [
            /class="kicker"/,
            /class="feed-title p-name"/,
            /class="feed-excerpt p-summary"/,
            /<p class="read-line">/,
            /class="feed-more"/,
          ],
          `titled read on ${listing}`,
        );
        assert.equal(html.match(/<p class="read-line">/g)?.length, 1);
      });

      it('summarises a titled read with its own words, not the read line', async () => {
        const html = article(await get(listing), 'titled-read');
        assert.equal(text(SUMMARY.exec(html)?.[1] ?? ''), 'I enjoyed this book.');
        assert.equal(html.split('Finished reading').length - 1, 1);
      });

      it('gives a titled read with no words no summary, and its read line after the headline', async () => {
        const html = article(await get(listing), 'bare-read');
        assert.doesNotMatch(html, SUMMARY);
        ascending(
          html,
          [
            /class="kicker"/,
            /class="feed-title p-name"/,
            /<p class="read-line">/,
            /class="feed-more"/,
          ],
          `bare read on ${listing}`,
        );
      });

      it('lists an untitled read by its kicker, read line and words', async () => {
        const html = article(await get(listing), 'untitled-read');
        assert.doesNotMatch(html, /class="feed-title/);
        ascending(
          html,
          [
            /class="kicker"/,
            /<p class="read-line">/,
            /<div class="feed-excerpt e-content"><p>Short thoughts\.<\/p>/,
          ],
          `untitled read on ${listing}`,
        );
      });
    });
  }
});

describe('a read post in the feeds', () => {
  it('keeps the read line as the summary of a titled read', async () => {
    const rss = await get('/feed/');
    const item = [...rss.matchAll(/<item>[\s\S]*?<\/item>/g)]
      .map((match) => match[0])
      .find((one) => one.includes('/2026/09/titled-read/'));
    assert.match(item ?? '', new RegExp(`<description>${READ_LINE_TEXT}</description>`));

    const atom = await get('/feed/atom/');
    const entry = [...atom.matchAll(/<entry>[\s\S]*?<\/entry>/g)]
      .map((match) => match[0])
      .find((one) => one.includes('/2026/09/titled-read/'));
    assert.match(entry ?? '', new RegExp(`<summary type="text">${READ_LINE_TEXT}</summary>`));

    const json = JSON.parse(await get('/feed/json/')) as {
      items: { url: string; summary?: string }[];
    };
    const found = json.items.find((one) => one.url.endsWith('/2026/09/titled-read/'));
    assert.equal(found?.summary, READ_LINE_TEXT);
  });
});
