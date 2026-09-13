import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

/**
 * The author archive and its feeds, from the outside (TASK-67).
 *
 * decision-14 makes `/author/{username}/` the URL a user's actor will live at,
 * so everything here is about that URL being a real page first: who is listed
 * on it, what it says about them, where its feeds are, and what happens at the
 * spellings a reader or a peer might arrive with.
 */

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/** A post file, attributed to whatever string the case wants to test. */
function post(
  title: string,
  options: { month: string; slug: string; author?: string; draft?: boolean },
): string {
  const author = options.author === undefined ? '' : `author: ${options.author}\n`;
  const draft = options.draft === true ? 'draft: true\n' : '';
  return (
    `---\ntitle: ${title}\ndate: '2026-${options.month}-02T09:00:00Z'\n` +
    `permalink: /2026/${options.month}/${options.slug}/\n${author}${draft}---\n\nBody of ${options.slug}.\n`
  );
}

/** The posts every case here starts from: two of Ada's, one of Grace's. */
const CONTENT: Record<string, string> = {
  '_data/site.json': `${JSON.stringify({ title: 'A Site', postsPerPage: 10 }, null, 2)}\n`,
  'posts/2026-09-02-by-login.md': post('By Login', {
    month: '09',
    slug: 'by-login',
    author: 'ada',
  }),
  'posts/2026-08-02-by-display-name.md': post('By Display Name', {
    month: '08',
    slug: 'by-display-name',
    author: 'Ada Lovelace',
  }),
  'posts/2026-07-02-by-grace.md': post('By Grace', {
    month: '07',
    slug: 'by-grace',
    author: 'grace',
  }),
  'posts/2026-06-02-a-draft.md': post('A Draft', {
    month: '06',
    slug: 'a-draft',
    author: 'ada',
    draft: true,
  }),
};

/**
 * A CMS over `files`, with Ada — who has a profile — and Grace, who has none.
 *
 * Watching is off, so a request only ever sees what the scan indexed.
 */
async function site(
  files: Record<string, string> = CONTENT,
  settings: Record<string, unknown> = {},
): Promise<Cms> {
  const contentDir = await temporaryDir('geekity-author-content-');
  const dataDir = await temporaryDir('geekity-author-data-');
  await writeTree(contentDir, {
    ...files,
    ...(Object.keys(settings).length === 0
      ? {}
      : {
          '_data/site.json': `${JSON.stringify({ title: 'A Site', ...settings }, null, 2)}\n`,
        }),
  });

  const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  await setUserProfile({
    dataDir,
    userId: ada.id,
    profile: {
      displayName: 'Ada Lovelace',
      bio: 'Wrote the first program.',
      avatar: '/uploads/ada.jpg',
      links: [{ label: 'Her notes', href: 'https://ada.example' }],
    },
  });
  await createUser({ dataDir, username: 'grace', password: 'a password of hers' });

  const instance = createCms({ contentDir, dataDir, watch: false });
  started.push(instance);
  await instance.sync();
  return instance;
}

describe('the author archive (AC #3)', () => {
  it('lists that user’s published posts, newest first', async () => {
    const cms = await site();

    const response = await cms.app.request('/author/ada/');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('/2026/09/by-login/'), 'a post attributed by username is hers');
    assert.ok(
      html.includes('/2026/08/by-display-name/'),
      'a post attributed by display name reads as hers too (AC #2)',
    );
    assert.ok(
      html.indexOf('By Login') < html.indexOf('By Display Name'),
      'the newer post comes first',
    );
    assert.equal(html.includes('/2026/07/by-grace/'), false, 'somebody else’s post is not hers');
    assert.equal(html.includes('/2026/06/a-draft/'), false, 'a draft is on nobody’s archive');
  });

  it('heads the archive with the profile (AC #5)', async () => {
    const cms = await site();

    const html = await (await cms.app.request('/author/ada/')).text();

    assert.ok(html.includes('Ada Lovelace'), 'the display name is the heading');
    assert.ok(html.includes('Wrote the first program.'), 'the bio is printed');
    assert.ok(html.includes('/uploads/ada.jpg'), 'the avatar is shown');
    assert.ok(html.includes('https://ada.example'), 'the links are listed');
  });

  it('gives a user with no profile an archive under their username', async () => {
    const cms = await site();

    const response = await cms.app.request('/author/grace/');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('grace'), 'they are called by their username');
    assert.ok(html.includes('/2026/07/by-grace/'), 'their post is listed');
  });

  it('paginates like the home page', async () => {
    const cms = await site(CONTENT, { postsPerPage: 1 });

    const first = await (await cms.app.request('/author/ada/')).text();
    assert.ok(first.includes('/2026/09/by-login/'), 'page one holds the newest');
    assert.equal(first.includes('/2026/08/by-display-name/'), false, 'and stops at the page size');
    assert.ok(first.includes('/author/ada/page/2/'), 'and links to page two');

    const second = await cms.app.request('/author/ada/page/2/');
    const secondHtml = await second.text();
    assert.equal(second.status, 200);
    assert.ok(secondHtml.includes('/2026/08/by-display-name/'), 'page two holds the older post');

    assert.equal((await cms.app.request('/author/ada/page/9/')).status, 404);
  });

  it('404s for a username nobody has', async () => {
    const cms = await site();

    assert.equal((await cms.app.request('/author/babbage/')).status, 404);
    assert.equal((await cms.app.request('/author/babbage/feed/')).status, 404);
  });

  it('answers for a user who exists but has published nothing', async () => {
    const cms = await site({
      '_data/site.json': CONTENT['_data/site.json'] as string,
      'posts/2026-09-02-by-login.md': CONTENT['posts/2026-09-02-by-login.md'] as string,
    });

    // Unlike a tag archive, which exists only while something carries the
    // term, a person exists whether or not they have written anything: after
    // decision-14 this URL is their actor's id, and an id that 404s until its
    // owner publishes would be an account that came into being with a post.
    const response = await cms.app.request('/author/grace/');

    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('grace'), 'the archive is still theirs');
  });

  it('redirects the spellings that are not the canonical one', async () => {
    const cms = await site();

    const slashless = await cms.app.request('/author/ada');
    assert.equal(slashless.status, 301);
    assert.equal(slashless.headers.get('location'), '/author/ada/');

    const pageOne = await cms.app.request('/author/ada/page/1/');
    assert.equal(pageOne.status, 301);
    assert.equal(pageOne.headers.get('location'), '/author/ada/');

    const feed = await cms.app.request('/author/ada/feed');
    assert.equal(feed.status, 301);
    assert.equal(feed.headers.get('location'), '/author/ada/feed/');
  });

  it('answers WordPress’s older feed spellings the way every listing does', async () => {
    const cms = await site();

    const alias = await cms.app.request('/author/ada/feed/rss/');
    assert.equal(alias.status, 301);
    assert.equal(alias.headers.get('location'), '/author/ada/feed/');

    const query = await cms.app.request('/author/ada/?feed=atom');
    assert.equal(query.status, 301);
    assert.equal(query.headers.get('location'), '/author/ada/feed/atom/');
  });

  it('keeps the URL from a document permalinked under it (AC #4)', async () => {
    const cms = await site({
      ...CONTENT,
      'pages/impostor.md':
        '---\ntitle: Impostor\npermalink: /author/ada/\n---\n\nNot the archive.\n',
    });

    const html = await (await cms.app.request('/author/ada/')).text();

    assert.ok(html.includes('/2026/09/by-login/'), 'the archive answers');
    assert.equal(html.includes('Not the archive.'), false, 'the page does not');
  });

  it('answers JSON when a reader asks for it, as every listing does', async () => {
    const cms = await site();

    const response = await cms.app.request('/author/ada/', {
      headers: { accept: 'application/json' },
    });
    const body = (await response.json()) as { url: string }[];

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.map((entry) => entry.url),
      ['http://localhost:3000/2026/09/by-login/', 'http://localhost:3000/2026/08/by-display-name/'],
    );
  });
});

describe('the author feeds (AC #3)', () => {
  it('serves the three formats over the same posts', async () => {
    const cms = await site();

    const rss = await cms.app.request('/author/ada/feed/');
    const rssBody = await rss.text();
    assert.equal(rss.status, 200);
    assert.match(rss.headers.get('content-type') ?? '', /application\/rss\+xml/);
    assert.ok(rssBody.includes('/2026/09/by-login/'), 'her post is in it');
    assert.equal(rssBody.includes('/2026/07/by-grace/'), false, 'and nobody else’s is');

    const atom = await cms.app.request('/author/ada/feed/atom/');
    assert.equal(atom.status, 200);
    assert.match(atom.headers.get('content-type') ?? '', /application\/atom\+xml/);
    assert.ok((await atom.text()).includes('/2026/08/by-display-name/'));

    const json = await cms.app.request('/author/ada/feed/json/');
    assert.equal(json.status, 200);
    assert.match(json.headers.get('content-type') ?? '', /application\/feed\+json/);
    const feed = (await json.json()) as { title: string; items: { url: string }[] };
    assert.ok(feed.title.includes('Ada Lovelace'), 'the feed is named after the person');
    assert.deepEqual(
      feed.items.map((item) => item.url),
      ['http://localhost:3000/2026/09/by-login/', 'http://localhost:3000/2026/08/by-display-name/'],
    );
  });

  it('is advertised on the archive', async () => {
    const cms = await site();

    const html = await (await cms.app.request('/author/ada/')).text();

    assert.ok(html.includes('href="/author/ada/feed/"'), 'the RSS feed is linked');
    assert.ok(html.includes('href="/author/ada/feed/atom/"'), 'and Atom');
    assert.ok(html.includes('href="/author/ada/feed/json/"'), 'and JSON Feed');
  });
});

describe('a byline (AC #2, AC #5)', () => {
  it('names the author and links to their archive', async () => {
    const cms = await site();

    const html = await (await cms.app.request('/2026/08/by-display-name/')).text();

    assert.ok(html.includes('/author/ada/'), 'the byline links to the archive');
    assert.ok(html.includes('Ada Lovelace'), 'and prints the display name');
  });

  it('prints a name that is nobody’s without linking anywhere', async () => {
    const cms = await site({
      '_data/site.json': CONTENT['_data/site.json'] as string,
      'posts/2026-09-02-by-a-stranger.md': post('By A Stranger', {
        month: '09',
        slug: 'by-a-stranger',
        author: 'Charles Babbage',
      }),
    });

    const html = await (await cms.app.request('/2026/09/by-a-stranger/')).text();

    assert.ok(html.includes('Charles Babbage'), 'the name the file gives is printed');
    assert.equal(html.includes('/author/Charles'), false, 'but it links to no archive');
  });
});
