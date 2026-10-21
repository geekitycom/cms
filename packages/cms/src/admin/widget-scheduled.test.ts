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
  readonly front?: string;
  readonly dir?: string;
}

async function site(posts: readonly Post[]): Promise<Browser> {
  const contentDir = await box.dir('geekity-scheduled-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await mkdir(path.join(contentDir, 'pages'), { recursive: true });
  await mkdir(path.join(contentDir, '_trash', 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', timezone: 'America/Chicago' }),
    'utf8',
  );
  for (const { slug, date, front = '', dir = 'posts' } of posts) {
    await writeFile(
      path.join(contentDir, dir, `${slug}.md`),
      `---\ntitle: '${slug}'\ndate: '${date}'\npermalink: /${slug}/\n${front}---\n\nWords about ${slug}.\n`,
      'utf8',
    );
  }
  const cms = await box.site({ contentDir, now: () => TEN_AM_20_OCTOBER_IN_CHICAGO });
  return signedIn(cms);
}

async function dashboard(agent: Browser): Promise<string> {
  const response = await agent.get('/admin');
  assert.equal(response.status, 200);
  return screenOf(await response.text());
}

function card(html: string): string {
  const [, after = ''] = html.split('<h2 class="card-title">Scheduled posts</h2>');
  return after.split('<h2')[0] ?? '';
}

function rows(html: string): [string, string, string][] {
  return [
    ...card(html).matchAll(
      /<td class="wrap-anywhere"><a class="link" href="([^"]*)">([^<]*)<\/a><\/td>\s*<td class="wrap-anywhere">([^<]*)<\/td>/g,
    ),
  ].map(([, href = '', title = '', time = '']) => [title, href, time]);
}

describe('the scheduled posts widget (TASK-451)', () => {
  it('lists the next five scheduled posts, soonest first, in the site time zone, each linking to its editor (AC #1)', async () => {
    const agent = await site([
      { slug: 'published', date: '2026-10-20T14:59:00Z' },
      { slug: 'sixth', date: '2027-02-01T12:00:00Z' },
      { slug: 'third', date: '2026-11-02T15:30:00Z' },
      { slug: 'first', date: '2026-10-20T22:48:00Z' },
      { slug: 'fifth', date: '2026-12-25T06:00:00Z' },
      { slug: 'second', date: '2026-10-21T04:05:00Z', front: 'visibility: unlisted\n' },
      { slug: 'fourth', date: '2026-11-30T18:00:00Z' },
      { slug: 'draft', date: '2026-10-20T16:00:00Z', front: 'draft: true\n' },
      { slug: 'trashed', date: '2026-10-20T16:00:00Z', dir: '_trash/posts' },
      { slug: 'a-page', date: '2026-10-20T16:00:00Z', dir: 'pages' },
    ]);

    const html = await dashboard(agent);

    assert.deepEqual(rows(html), [
      ['first', '/admin/posts/first', '20 Oct, 17:48'],
      ['second', '/admin/posts/second', '20 Oct, 23:05'],
      ['third', '/admin/posts/third', '2 Nov, 09:30'],
      ['fourth', '/admin/posts/fourth', '30 Nov, 12:00'],
      ['fifth', '/admin/posts/fifth', '25 Dec, 00:00'],
    ]);
    const words = text(html);
    assert.ok(words.indexOf('Activity') < words.indexOf('Scheduled posts'), words);
  });

  it('draws nothing while nothing is scheduled (AC #2)', async () => {
    const agent = await site([
      { slug: 'published', date: '2026-10-19T12:00:00Z' },
      { slug: 'draft', date: '2026-10-21T12:00:00Z', front: 'draft: true\n' },
    ]);

    const html = await dashboard(agent);

    assert.doesNotMatch(html, /Scheduled posts/);
  });
});
