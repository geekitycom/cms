import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { TEN_AM_20_OCTOBER_IN_CHICAGO } from './__testing__/chicago-clock.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { screenOf, text } from './__testing__/markup.ts';

const box = sandbox();
after(() => box.cleanup());

interface Post {
  readonly slug: string;
  readonly date: string;
  readonly title?: string;
  readonly front?: string;
  readonly dir?: string;
}

let sequence = 0;

function post(date: string, front = '', fields: Partial<Post> = {}): Post {
  sequence += 1;
  return { slug: `post-${String(sequence)}`, date, front, ...fields };
}

async function site(
  posts: readonly Post[],
  locations: Record<string, unknown> = {},
): Promise<Browser> {
  const contentDir = await box.dir('geekity-posting-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await mkdir(path.join(contentDir, '_trash', 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', timezone: 'America/Chicago' }),
    'utf8',
  );
  for (const { slug, date, title = '', front = '', dir = 'posts' } of posts) {
    await writeFile(
      path.join(contentDir, dir, `${slug}.md`),
      `---\ntitle: '${title}'\ndate: '${date}'\npermalink: /${slug}/\n${front}---\n\nWords about ${slug}.\n`,
      'utf8',
    );
  }
  const dataDir = await box.dir('geekity-posting-data-');
  await writeFile(path.join(dataDir, 'locations.json'), JSON.stringify(locations), 'utf8');
  const cms = await box.site({ contentDir, dataDir, now: () => TEN_AM_20_OCTOBER_IN_CHICAGO });
  return signedIn(cms);
}

async function card(agent: Browser, query = ''): Promise<string> {
  const response = await agent.get(`/admin${query}`);
  assert.equal(response.status, 200);
  const [, html = ''] = screenOf(await response.text()).split(
    '<h2 class="card-title">Posting activity</h2>',
  );
  return html.split('<h2 class="card-title">')[0] ?? '';
}

function figure(html: string, caption: string): string {
  const rest = html.slice(html.indexOf(`class="sr-only">${caption}`) + 'class="sr-only">'.length);
  return rest.split('<p id="chart-')[0] ?? '';
}

function rows(html: string): string[] {
  const [, body = ''] = html.split('<tbody>');
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) => text(row ?? ''));
}

const PHOTO = "photo:\n  - url: '/uploads/a.jpg'\n";
const REVIEW = "item:\n  name: 'A Book'\n  kind: book\n";
const REPLY = "in-reply-to: 'https://elsewhere.example/a'\n";

describe('the posting activity widget (TASK-449)', () => {
  it('draws a calendar of posts per day over the last 52 weeks, with a text equivalent (AC #1)', async () => {
    const agent = await site([
      post('2026-10-19T12:00:00Z'),
      post('2026-10-19T14:00:00Z'),
      post('2026-03-02T12:00:00Z'),
      post('2025-10-21T12:00:00Z'),
    ]);

    const calendar = figure(await card(agent), 'Posts per day');

    assert.match(
      calendar,
      /^Posts per day, 364 days from 22 Oct to 20 Oct: 3 in all, most on 19 Oct \(2\)\.<\/p>/,
    );
    assert.match(calendar, /<title>19 Oct 2026: 2<\/title>/);
    assert.match(calendar, /<title>20 Oct 2026: 0<\/title>/);
    assert.doesNotMatch(calendar, /21 Oct 2025/);
    assert.deepEqual(rows(calendar), ['2 Mar 2026 1', '19 Oct 2026 2']);
  });

  it('splits posts per month over the last 12 months by kind (AC #2)', async () => {
    const agent = await site([
      post('2026-10-02T12:00:00Z'),
      post('2026-10-03T12:00:00Z', '', { title: 'A Long Read' }),
      post('2026-10-04T12:00:00Z', PHOTO),
      post('2026-09-04T12:00:00Z', REVIEW),
      post('2026-09-05T12:00:00Z'),
      post('2025-11-01T12:00:00Z'),
      post('2025-10-30T12:00:00Z'),
    ]);

    const bars = figure(await card(agent), 'Posts per month by kind');

    assert.match(
      bars,
      /^Posts per month by kind, Nov 2025 to Oct 2026: 6 in all, most in Oct 2026 \(3\)\.<\/p>/,
    );
    assert.match(text(bars), /Notes Articles Photos Reviews/);
    assert.match(text(bars), /Month Notes Articles Photos Reviews Total/);
    const table = rows(bars);
    assert.equal(table.length, 12);
    assert.equal(table[0], 'Nov 2025 1 0 0 0 1');
    assert.equal(table[10], 'Sept 2026 1 0 0 1 2');
    assert.equal(table[11], 'Oct 2026 1 1 1 0 3');
  });

  it('keeps the three busiest kinds and folds the rest into Other (AC #2)', async () => {
    const agent = await site(
      [
        post('2026-10-02T12:00:00Z'),
        post('2026-10-02T13:00:00Z'),
        post('2026-10-02T14:00:00Z'),
        post('2026-10-03T12:00:00Z', PHOTO),
        post('2026-10-03T13:00:00Z', PHOTO),
        post('2026-10-04T12:00:00Z', REVIEW),
        post('2026-10-04T13:00:00Z', REVIEW),
        post('2026-10-05T12:00:00Z', REPLY),
        post('2026-10-06T12:00:00Z', '', { slug: 'checked-in' }),
      ],
      { '/checked-in/': { locality: 'Paris', checkin: true } },
    );

    const bars = figure(await card(agent), 'Posts per month by kind');

    assert.match(text(bars), /Month Notes Photos Reviews Other Total/);
    assert.equal(rows(bars)[11], 'Oct 2026 3 2 2 2 9');
    assert.match(bars, /<title>Oct 2026: Other 2 of 9<\/title>/);
  });

  it('counts a check-in as a check-in', async () => {
    const agent = await site(
      [post('2026-10-06T12:00:00Z', '', { slug: 'at-the-cafe' }), post('2026-10-07T12:00:00Z')],
      { '/at-the-cafe/': { locality: 'Paris', checkin: true } },
    );

    assert.match(text(figure(await card(agent), 'Posts per month by kind')), /Notes Check-ins/);
  });

  it('leaves out drafts, trashed and scheduled posts and counts days in the site time zone (AC #3)', async () => {
    const agent = await site([
      post('2026-10-20T03:30:00Z'),
      post('2026-10-10T12:00:00Z', 'draft: true\n'),
      post('2026-10-11T12:00:00Z', '', { dir: path.join('_trash', 'posts') }),
      post('2026-10-20T18:00:00Z'),
      post('2026-10-25T12:00:00Z'),
      post('2025-11-01T04:00:00Z'),
    ]);

    const html = await card(agent);
    const calendar = figure(html, 'Posts per day');

    assert.match(calendar, /<title>19 Oct 2026: 1<\/title>/);
    assert.match(calendar, /<title>20 Oct 2026: 0<\/title>/);
    assert.deepEqual(rows(calendar), ['31 Oct 2025 1', '19 Oct 2026 1']);
    const bars = figure(html, 'Posts per month by kind');
    assert.equal(rows(bars)[0], 'Nov 2025 0 0');
    assert.equal(rows(bars)[11], 'Oct 2026 1 1');
  });

  it('draws the same year whatever the dashboard period', async () => {
    const agent = await site([post('2026-03-02T12:00:00Z')]);

    assert.match(figure(await card(agent, '?period=30'), 'Posts per day'), /1 in all/);
  });

  it('says so on a site that published nothing in the last year', async () => {
    const agent = await site([
      post('2024-03-02T12:00:00Z'),
      post('2026-10-10T12:00:00Z', 'draft: true\n'),
    ]);

    const html = await card(agent);

    assert.match(text(html), /No posts published in the last 52 weeks\./);
    assert.doesNotMatch(html, /<svg/);
  });
});
