/**
 * The two page kinds the source design has that a front matter key turns on
 * here (decision-16, TASK-85): the front page, which is a page's own words
 * over the recent posts, and an archive page, which is a page's own words over
 * every post there has ever been, grouped by month.
 *
 * Both are markup rather than a return value, so all of it is asserted over
 * HTTP against the theme the package ships.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

/** What the site's clock says while these tests run: mid-September 2026. */
const NOW = '2026-09-13T12:00:00Z';

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/** A post file. */
function post(title: string, slug: string, date: string, front = ''): string {
  return `---\ntitle: ${title}\ndate: '${date}'\npermalink: /posts/${slug}/\n${front}---\n\nBody of ${slug}.\n`;
}

/** A page file, with whatever front matter the test is about. */
function page(title: string, slug: string, front = ''): string {
  return `---\ntitle: ${title}\npermalink: /${slug}/\n${front}---\n\nThe words of the ${slug} page.\n`;
}

/** Five published posts across four months, a draft and one still to come. */
const CONTENT: Record<string, string> = {
  'posts/alpha.md': post('Alpha', 'alpha', '2026-09-10T09:00:00Z'),
  'posts/beta.md': post('Beta', 'beta', '2026-09-02T09:00:00Z'),
  'posts/gamma.md': post('Gamma', 'gamma', '2026-08-18T09:00:00Z'),
  'posts/delta.md': post('Delta', 'delta', '2026-07-11T09:00:00Z'),
  'posts/epsilon.md': post('Epsilon', 'epsilon', '2025-12-31T09:00:00Z'),
  'posts/drafted.md': post('Drafted', 'drafted', '2026-09-05T09:00:00Z', 'draft: true\n'),
  'posts/later.md': post('Later', 'later', '2026-10-01T09:00:00Z'),
  'pages/about.md': page('About', 'about'),
  'pages/posts.md': page('Posts', 'posts'),
  'pages/archive.md': page('Everything', 'archive', 'archive: true\n'),
  'pages/plain.md': page('Plain', 'plain'),
};

/**
 * A CMS wearing the packaged theme, over these settings, with an account
 * behind the site author so the bio has somebody to credit.
 */
async function site(settings: Record<string, unknown> = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-kinds-content-');
  const dataDir = await box.dir('geekity-kinds-data-');

  await writeTree(contentDir, {
    ...CONTENT,
    '_data/site.json': JSON.stringify(
      { title: 'A Site', author: 'Ada Lovelace', ...settings },
      null,
      2,
    ),
  });

  const user = await createUser({ dataDir, username: 'ada', password: 'a password of hers' });
  await setUserProfile({ dataDir, userId: user.id, profile: { displayName: 'Ada Lovelace' } });

  return box.open({ contentDir, dataDir, now: () => new Date(NOW) });
}

/** GET a path and read the body. */
async function body(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** The `<main>…</main>` of a page: what the layout drew, without the shell. */
function main(html: string): string {
  return /<main id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
}

/** The titles of a feed's entries, in the order they are printed. */
function feedTitles(html: string): string[] {
  return [...html.matchAll(/<h3 class="feed-title p-name">\s*<a[^>]*>([^<]*)<\/a>/g)].map(
    (match) => match[1] ?? '',
  );
}

/** Every month of an archive page, as `Month Year: title, title`. */
function months(html: string): string[] {
  return [...html.matchAll(/<h2>([^<]*)<\/h2>\s*<ol class="list-none">([\s\S]*?)<\/ol>/g)].map(
    (match) =>
      `${match[1] ?? ''}: ${[...(match[2] ?? '').matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)]
        .map((link) => (link[1] ?? '').replace(/<[^>]*>/g, '').trim())
        .join(', ')}`,
  );
}

describe('the front page a homepage is given (AC #1)', () => {
  it('prints the page’s words, then Recent Posts as an h-feed of h3 entries', async () => {
    const cms = await site({ homepage: 'about' });
    const html = await body(cms, '/');

    assert.match(html, /The words of the about page\./, 'the page’s own body is the front page');
    assert.match(html, /<h2>Recent Posts<\/h2>/, 'nothing heads the posts');
    assert.match(html, /<div class="feed h-feed">/, 'the posts are not an h-feed');
    assert.deepEqual(
      feedTitles(html),
      ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'],
      'the newest five, headed at 3 under the h2',
    );
    assert.doesNotMatch(html, /Drafted|Later/, 'a draft or a post still to come is listed');
  });

  it('leaves off the Published line and ends on the bio', async () => {
    const cms = await site({ homepage: 'about' });
    const content = main(await body(cms, '/'));

    assert.doesNotMatch(content, /page-meta/, 'the front page dates itself');
    assert.match(content, /<div class="bio p-author h-card">/, 'the bio is not on the front page');
    assert.ok(
      content.indexOf('bio p-author') > content.indexOf('feed h-feed'),
      'the bio is above the posts rather than under them',
    );
  });

  it('links the posts page, and only when the site names one', async () => {
    const withPosts = await body(await site({ homepage: 'about', postsPage: 'posts' }), '/');
    assert.match(withPosts, /<p class="front-links">[\s\S]*?href="\/posts\/"[\s\S]*?Posts/);

    const without = await body(await site({ homepage: 'about' }), '/');
    assert.doesNotMatch(without, /front-links/, 'a site with no posts page links one anyway');
  });

  it('still redirects the page’s own permalink to /', async () => {
    const cms = await site({ homepage: 'about' });

    const response = await cms.app.request('/about/');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/');
  });

  it('is not what an ordinary page gets', async () => {
    const cms = await site({ homepage: 'about' });
    const html = await body(cms, '/plain/');

    assert.doesNotMatch(html, /Recent Posts/, 'every page is a front page');
    assert.match(html, /<p class="page-meta">/, 'the page layout is not what a page gets');
  });
});

describe('a page whose front matter says archive: true (AC #3)', () => {
  it('lists every published post under a heading per month, newest first', async () => {
    const cms = await site();
    const html = await body(cms, '/archive/');

    assert.match(html, /The words of the archive page\./, 'the page’s own body is gone');
    assert.deepEqual(months(html), [
      'September 2026: Alpha, Beta',
      'August 2026: Gamma',
      'July 2026: Delta',
      'December 2025: Epsilon',
    ]);
    assert.match(html, /<a href="\/posts\/alpha\/"/, 'the links are the posts’ permalinks');
  });

  it('leaves out a draft and a post whose date has not arrived', async () => {
    const html = await body(await site(), '/archive/');

    assert.doesNotMatch(html, /Drafted/, 'a draft is on the archive');
    assert.doesNotMatch(html, /Later/, 'a post still to come is on the archive');
  });

  it('changes nothing about a page that does not ask for one', async () => {
    const html = await body(await site(), '/plain/');

    assert.doesNotMatch(html, /list-none/, 'an ordinary page lists the archive');
    assert.match(html, /<p class="page-meta">/, 'and is the ordinary page it was');
  });

  it('keeps the page’s own bio and the words above the list', async () => {
    const content = main(await body(await site(), '/archive/'));

    assert.ok(
      content.indexOf('list-none') > content.indexOf('The words of the archive page.'),
      'the list is above the page’s words',
    );
    assert.match(content, /<div class="bio p-author h-card">/, 'the page lost its bio');
  });
});
