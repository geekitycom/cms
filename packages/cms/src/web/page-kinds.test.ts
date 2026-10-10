/**
 * The two page kinds the source design has that a front matter key turns on
 * here (decision-16, TASK-85): the front page, which is a page's own title and
 * words and nothing else (TASK-317), and an archive page, which is a page's own
 * words over every post there has ever been, grouped by month.
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

/** Every month of an archive page, as `Month Year: title, title`. */
function months(html: string): string[] {
  return [...html.matchAll(/<h2>([^<]*)<\/h2>\s*<ol class="list-none">([\s\S]*?)<\/ol>/g)].map(
    (match) =>
      `${match[1] ?? ''}: ${[...(match[2] ?? '').matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)]
        .map((link) => (link[1] ?? '').replace(/<[^>]*>/g, '').trim())
        .join(', ')}`,
  );
}

describe('the front page a homepage is given (TASK-317)', () => {
  it('prints the page’s own title and words and nothing else (AC #1)', async () => {
    const cms = await site({ homepage: 'about', postsPage: 'posts' });
    const content = main(await body(cms, '/'));

    assert.match(content, /<h2 class="section-title">About<\/h2>/, 'the page’s title is gone');
    assert.match(content, /The words of the about page\./, 'the page’s own body is gone');
    assert.doesNotMatch(content, /Recent Posts|feed h-feed|Alpha/, 'the posts are still listed');
    assert.doesNotMatch(
      content,
      /front-links|href="\/search\/"/,
      'the line of links is still there',
    );
    assert.doesNotMatch(content, /class="bio|h-card/, 'the bio is still there');
    assert.doesNotMatch(content, /page-meta/, 'the front page dates itself');
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

    assert.match(html, /<h1 class="p-name">Plain<\/h1>/, 'the page layout is not what a page gets');
    assert.match(html, /<p class="page-meta">/);
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
