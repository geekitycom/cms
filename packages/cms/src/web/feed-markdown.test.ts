import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveNothing } from '../admin/__testing__/harness.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { child, childrenNamed, parseXml } from './__testing__/xml.ts';
import { shared } from './__testing__/shared.ts';

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function site(files: Record<string, string>): Promise<Cms> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-feed-markdown-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-feed-markdown-data-'));
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

const sharedSite = shared(site);

function post(slug: string, day: number, frontMatter: string[], body = ''): Record<string, string> {
  const date = `2026-10-${String(day).padStart(2, '0')}`;
  return {
    [`posts/${date}-${slug}.md`]: [
      '---',
      `date: '${date}T09:00:00Z'`,
      `permalink: /2026/10/${slug}/`,
      ...frontMatter,
      '---',
      '',
      body,
      '',
    ].join('\n'),
  };
}

const ESSAY = 'https://www.thephilosophicalsalon.com/the-idea-of-ai-slop-is-slop/';
const TOOT = 'https://mastodon.example/@ada/1';
const ARTICLE = 'https://blog.example/gulls/';
const EVENT = 'https://events.example/2026/10/indieweb-camp';
const UNKNOWN = 'https://nothing.example/stored/';

const FILES: Record<string, string> = {
  '_data/replyContexts.json': JSON.stringify({
    [ESSAY]: {
      name: 'The Idea of "AI Slop" Is Slop - The Philosophical Salon',
      author: { name: "Francesco D'Isa" },
      published: '2025-11-30T10:00:00Z',
    },
    [TOOT]: { name: 'Gulls are *loud*', author: { name: 'Ada' } },
    [ARTICLE]: { name: 'On gulls', site: 'Gull Weekly' },
    [EVENT]: { name: 'IndieWeb Camp' },
  }),
  '_data/media.json': JSON.stringify({ '2026/10/dog.jpg': { alt: 'A dog asleep on the sand' } }),
  ...post('repost', 1, [`repost-of: ${ESSAY}`], 'Worth reading.'),
  ...post('reply', 2, [`in-reply-to: ${TOOT}`], 'They are.'),
  ...post('like', 3, [`like-of: ${ARTICLE}`]),
  ...post('bookmark', 4, [`bookmark-of: ${UNKNOWN}`]),
  ...post('rsvp', 5, [`in-reply-to: ${EVENT}`, 'rsvp: yes'], 'See you there.'),
  ...post(
    'review',
    6,
    [
      'title: Midnight in Siberia',
      'item:',
      '  kind: book',
      '  name: Midnight in Siberia',
      '  by: David Greene',
      '  year: 2014',
      '  uid: isbn:9780393239959',
      '  url: https://openlibrary.org/books/OL26886936M',
      '  date: 2026-09-30',
      'rating: 4',
    ],
    'A long train ride.',
  ),
  ...post(
    'photos',
    7,
    [
      'photo:',
      '  - url: /uploads/2026/10/beach.jpg',
      '    alt: Waves [breaking] at dusk',
      '  - url: /uploads/2026/10/dog.jpg',
      '  - url: https://cdn.example.org/gull.jpg',
    ],
    'At the beach.',
  ),
  ...post(
    'links',
    8,
    [],
    [
      'See [the archive](/2026/10/) and [the next one](../next/?a=1&b=2), [[Gulls]],',
      '[elsewhere](https://elsewhere.example/), [mail](mailto:gull@example.com) and [the top](#top).',
      '',
      '![A gull](/uploads/2026/10/gull.jpg) and <https://elsewhere.example/bare>',
      '',
      '<img src="gull-close.jpg" srcset="/uploads/2026/10/gull-400.jpg 400w" alt="Closer">',
      '',
      '[ref]: /2026/10/repost/',
    ].join('\n'),
  ),
  ...post('note', 9, [], 'Just *a* note with [a link](https://elsewhere.example/) in it.'),
};

async function markdownOf(cms: Cms, slug: string): Promise<string> {
  const feed = parseXml(await (await cms.app.request('/feed/')).text());
  const link = `https://example.com/2026/10/${slug}/`;
  const item = childrenNamed(child(feed, 'channel'), 'item').find(
    (candidate) => child(candidate, 'link').text === link,
  );
  assert.ok(item !== undefined, `the feed has ${link}`);
  return child(item, 'source:markdown').text;
}

async function pageMarkdown(cms: Cms, slug: string): Promise<string> {
  const response = await cms.app.request(`/2026/10/${slug}/index.md`);
  assert.equal(response.status, 200);
  return response.text();
}

describe('source:markdown in the RSS feed', () => {
  it('opens a repost with the citation line the page Markdown prints', async () => {
    const cms = await sharedSite(FILES);
    const line =
      `Reposted [The Idea of "AI Slop" Is Slop - The Philosophical Salon](${ESSAY})` +
      " by Francesco D'Isa, 30 November 2025";

    assert.equal(await markdownOf(cms, 'repost'), `${line}\n\nWorth reading.`);
    assert.ok((await pageMarkdown(cms, 'repost')).includes(`\n${line}\n`));
  });

  it('opens a reply, a like and a bookmark with their citation lines', async () => {
    const cms = await sharedSite(FILES);

    assert.equal(
      await markdownOf(cms, 'reply'),
      `In reply to [Gulls are \\*loud\\*](${TOOT}) by Ada\n\nThey are.`,
    );
    assert.equal(await markdownOf(cms, 'like'), `Liked [On gulls](${ARTICLE}) · Gull Weekly`);
    assert.equal(
      await markdownOf(cms, 'bookmark'),
      `Bookmarked [a page on nothing.example](${UNKNOWN})`,
    );
    for (const slug of ['reply', 'like', 'bookmark']) {
      const lead = (await markdownOf(cms, slug)).split('\n')[0] ?? '';
      assert.ok((await pageMarkdown(cms, slug)).includes(`\n${lead}\n`), slug);
    }
  });

  it('carries an RSVP line', async () => {
    const cms = await sharedSite(FILES);

    assert.equal(
      await markdownOf(cms, 'rsvp'),
      `Going to [IndieWeb Camp](${EVENT})\n\nSee you there.`,
    );
  });

  it('opens a review with the item, its details and the rating', async () => {
    const cms = await sharedSite(FILES);
    const lead = [
      'Review of [Midnight in Siberia](https://openlibrary.org/books/OL26886936M)' +
        ' (book, 2014), by David Greene, ISBN 9780393239959',
      'Finished on 30 September 2026.',
      'Rated 4 out of 5',
    ].join('\n\n');

    assert.equal(await markdownOf(cms, 'review'), `${lead}\n\nA long train ride.`);
    assert.ok((await pageMarkdown(cms, 'review')).includes(`\n${lead}\n`));
  });

  it('shows the photos as Markdown images with their alt text', async () => {
    const cms = await sharedSite(FILES);

    assert.equal(
      await markdownOf(cms, 'photos'),
      [
        '![Waves \\[breaking\\] at dusk](https://example.com/uploads/2026/10/beach.jpg)',
        '![A dog asleep on the sand](https://example.com/uploads/2026/10/dog.jpg)',
        '![](https://cdn.example.org/gull.jpg)',
        'At the beach.',
      ].join('\n\n'),
    );
  });

  it('makes every relative URL in the body absolute on the base URL', async () => {
    const cms = await sharedSite(FILES);

    assert.equal(
      await markdownOf(cms, 'links'),
      [
        'See [the archive](https://example.com/2026/10/) and' +
          ' [the next one](https://example.com/2026/10/next/?a=1&b=2),' +
          ' [Gulls](https://example.com/wiki/gulls/),',
        '[elsewhere](https://elsewhere.example/), [mail](mailto:gull@example.com) and [the top](#top).',
        '',
        '![A gull](https://example.com/uploads/2026/10/gull.jpg) and <https://elsewhere.example/bare>',
        '',
        '<img src="https://example.com/2026/10/links/gull-close.jpg"' +
          ' srcset="https://example.com/uploads/2026/10/gull-400.jpg 400w" alt="Closer">',
        '',
        '[ref]: https://example.com/2026/10/repost/',
      ].join('\n'),
    );
  });

  it('leaves a plain note as it was written', async () => {
    const cms = await sharedSite(FILES);

    assert.equal(
      await markdownOf(cms, 'note'),
      'Just *a* note with [a link](https://elsewhere.example/) in it.',
    );
  });
});
