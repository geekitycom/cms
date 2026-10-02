import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const INDIENEWS = 'https://news.indieweb.org/en';
const MASTODON = 'https://brid.gy/publish/mastodon';
const INDIENEWS_COPY = 'https://news.indieweb.org/en/blog.example/2026/09/tagged/';

function post(slug: string, frontMatter: string[] = []): string {
  return [
    '---',
    `title: Post ${slug}`,
    "date: '2026-09-02T09:00:00Z'",
    `permalink: /2026/09/${slug}/`,
    ...frontMatter,
    '---',
    '',
    'Words.',
    '',
  ].join('\n');
}

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', language: 'en', timezone: 'UTC' }),
  '_data/syndicationTargets.json': JSON.stringify([
    { id: 'indienews', name: 'IndieNews', url: INDIENEWS, tag: 'indienews' },
    { id: 'mastodon', name: 'Mastodon', url: MASTODON },
  ]),
  '_data/syndication.json': JSON.stringify({
    '/2026/09/tagged/': { [INDIENEWS]: INDIENEWS_COPY },
  }),
  'posts/tagged.md': post('tagged', ['tags: [indienews]']),
  'posts/listed.md': post('listed', ['syndicate-to: [mastodon]']),
  'posts/by-hand.md': post('by-hand', [
    'syndication:',
    '  - https://www.social.example/@me/1',
    '  - javascript:alert(1)',
  ]),
  'posts/plain.md': post('plain', ['tags: [indieweb]']),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-syndication-content-');
  const dataDir = await box.dir('geekity-syndication-data-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  cms = await box.open({ contentDir, dataDir, now: () => new Date('2026-09-13T12:00:00Z') });
});

async function page(slug: string): Promise<string> {
  const response = await cms.app.request(`/2026/09/${slug}/`);
  assert.equal(response.status, 200);
  return await response.text();
}

/** The h-entry on a page, so a link outside it does not count. */
function entry(html: string): string {
  const match = /<article class="blog-post h-entry"[\s\S]*?<\/article>/.exec(html);
  assert.ok(match !== null, 'the page has an h-entry');
  return match[0];
}

describe('a post’s syndication targets on its page (TASK-155 AC #4)', () => {
  it('links to a target selected by tag inside the h-entry, as IndieNews asks', async () => {
    assert.match(
      entry(await page('tagged')),
      /<a class="u-syndication small" href="https:\/\/news\.indieweb\.org\/en">IndieNews<\/a>/,
    );
  });

  it('links to a target listed in syndicate-to', async () => {
    const html = entry(await page('listed'));

    assert.match(
      html,
      /<a class="u-syndication small" href="https:\/\/brid\.gy\/publish\/mastodon">Mastodon<\/a>/,
    );
    assert.doesNotMatch(html, /news\.indieweb\.org/, 'and to no target it did not select');
  });

  it('links to no target from a post that selects none', async () => {
    const html = await page('plain');

    assert.doesNotMatch(html, /news\.indieweb\.org|brid\.gy/);
  });
});

describe('a post’s copies on its page (TASK-155 AC #6, #7)', () => {
  it('prints the copy a target answered with as u-syndication', async () => {
    assert.match(
      entry(await page('tagged')),
      /Also on <a class="u-syndication" href="https:\/\/news\.indieweb\.org\/en\/blog\.example\/2026\/09\/tagged\/">news\.indieweb\.org<\/a>/,
    );
  });

  it('prints a copy listed by hand the same way, and drops one that is no web URL', async () => {
    const html = entry(await page('by-hand'));

    assert.match(
      html,
      /Also on <a class="u-syndication" href="https:\/\/www\.social\.example\/@me\/1">social\.example<\/a>/,
    );
    assert.doesNotMatch(html, /javascript:/);
  });
});
