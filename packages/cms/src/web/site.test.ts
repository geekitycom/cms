import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { readSiteSettings, writeSiteJson } from '../admin/settings.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';

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

/**
 * A themes directory holding one theme, `fixture`, with these files in it.
 *
 * A theme is a named directory a site chooses now (decision-15), so an
 * override takes two things rather than one: the theme, and a `site.json` that
 * names it — {@link choosing}.
 */
async function fixtureTheme(files: Record<string, string>): Promise<string> {
  const themesDir = await temporaryDir('geekity-web-themes-');
  await writeTree(path.join(themesDir, 'fixture'), {
    'theme.json': JSON.stringify({ name: 'Fixture', kind: 'site' }),
    ...files,
  });
  return themesDir;
}

/** The `content/_data/site.json` of a site that has chosen `fixture`. */
function choosing(settings: Record<string, unknown> = {}): Record<string, string> {
  return { '_data/site.json': JSON.stringify({ theme: 'fixture', ...settings }) };
}

/**
 * A CMS over a content directory holding `files`, already synced. Watching is
 * off so a request only ever sees what the scan indexed.
 */
async function site(
  files: Record<string, string>,
  config: GeekityConfig = {},
): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await temporaryDir('geekity-web-content-');
  const dataDir = await temporaryDir('geekity-web-data-');
  await writeTree(contentDir, files);

  const instance = createCms({ contentDir, dataDir, watch: false, ...config });
  started.push(instance);
  await instance.sync();
  return { cms: instance, contentDir };
}

/** A post file. */
function post(
  title: string,
  options: {
    date: string;
    permalink: string;
    tags?: string[];
    categories?: string[];
    draft?: boolean;
    body?: string;
  },
): string {
  const tags =
    options.tags === undefined ? '' : `tags:\n${options.tags.map((t) => `  - ${t}`).join('\n')}\n`;
  const categories =
    options.categories === undefined
      ? ''
      : `categories:\n${options.categories.map((c) => `  - ${c}`).join('\n')}\n`;
  const draft = options.draft === true ? 'draft: true\n' : '';
  return `---\ntitle: ${title}\ndate: '${options.date}'\npermalink: ${options.permalink}\n${tags}${categories}${draft}---\n\n${options.body ?? 'Body.'}\n`;
}

/** A page file. */
function page(title: string, permalink: string, body = 'Body.'): string {
  return `---\ntitle: ${title}\npermalink: ${permalink}\n---\n\n${body}\n`;
}

describe('the home page', () => {
  it('lists published posts newest first', async () => {
    const { cms } = await site({
      'posts/2026-09-02-newer.md': post('Newer', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/newer/',
      }),
      'posts/2026-08-15-older.md': post('Older', {
        date: '2026-08-15T09:00:00Z',
        permalink: '/2026/08/older/',
      }),
    });

    const response = await cms.app.request('/');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.ok(html.includes('/2026/09/newer/'), 'the newer post is linked');
    assert.ok(html.includes('/2026/08/older/'), 'the older post is linked');
    assert.ok(
      html.indexOf('Newer') < html.indexOf('Older'),
      'the newer post comes first in the document',
    );
  });

  it('splits the archive into pages and links the next one', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'Paged', postsPerPage: 2 }),
      'posts/one.md': post('One', { date: '2026-09-03T09:00:00Z', permalink: '/one/' }),
      'posts/two.md': post('Two', { date: '2026-09-02T09:00:00Z', permalink: '/two/' }),
      'posts/three.md': post('Three', { date: '2026-09-01T09:00:00Z', permalink: '/three/' }),
    });

    const first = await cms.app.request('/');
    const firstHtml = await first.text();

    assert.ok(firstHtml.includes('href="/one/"'), 'page one holds the newest post');
    assert.ok(firstHtml.includes('href="/two/"'), 'page one holds the second post');
    assert.ok(!firstHtml.includes('href="/three/"'), 'page one stops at the page size');
    assert.ok(firstHtml.includes('href="/page/2/"'), 'page one links to page two');

    const second = await cms.app.request('/page/2/');
    const secondHtml = await second.text();

    assert.equal(second.status, 200);
    assert.ok(secondHtml.includes('href="/three/"'), 'page two holds the oldest post');
    assert.ok(!secondHtml.includes('href="/one/"'), 'page two does not repeat page one');
    assert.ok(secondHtml.includes('href="/"'), 'page two links back');
  });

  it('404s a page past the end of the archive', async () => {
    const { cms } = await site({
      'posts/one.md': post('One', { date: '2026-09-03T09:00:00Z', permalink: '/one/' }),
    });

    assert.equal((await cms.app.request('/page/9/')).status, 404);
  });

  it('sends /page/1/ back to the home page, which is the same listing', async () => {
    const { cms } = await site({});

    const response = await cms.app.request('/page/1/');

    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/');
  });

  it('renders with no posts at all rather than failing', async () => {
    const { cms } = await site({});

    const response = await cms.app.request('/');

    assert.equal(response.status, 200);
    assert.match(await response.text(), /Nothing published yet/);
  });
});

describe('a single document', () => {
  it('renders a post with its title, date, tags and body HTML', async () => {
    const { cms } = await site({
      'posts/2026-09-02-hello.md': post('Hello, World!', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hello/',
        tags: ['introductions', 'eleventy'],
        body: '## What it does\n\nA *file-first* CMS.\n',
      }),
    });

    const response = await cms.app.request('/2026/09/hello/');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.ok(html.includes('Hello, World!'), 'the title is on the page');
    assert.ok(html.includes('2026-09-02'), 'the date is on the page');
    assert.ok(html.includes('/tag/introductions/'), 'the first tag links to its archive');
    assert.ok(html.includes('/tag/eleventy/'), 'the second tag links to its archive');
    assert.ok(
      html.includes('<h2 id="what-it-does">What it does</h2>'),
      'the body HTML is rendered rather than escaped',
    );
    assert.ok(html.includes('<em>file-first</em>'), 'inline Markdown is rendered too');
  });

  it('renders a page through the page template, which has no date line', async () => {
    const { cms } = await site({
      'pages/about.md': page('About', '/about/', 'Who runs this site.'),
    });

    const response = await cms.app.request('/about/');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('About'), 'the title is on the page');
    assert.ok(html.includes('Who runs this site.'), 'the body is on the page');
    assert.ok(!html.includes('<time'), 'a page carries no publish date');
  });

  it('404s a draft, which the public site must not show', async () => {
    const { cms } = await site({
      'posts/2026-09-02-secret.md': post('Secret', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/secret/',
        draft: true,
      }),
    });

    const response = await cms.app.request('/2026/09/secret/');

    assert.equal(response.status, 404);
    assert.ok(!(await response.text()).includes('Secret'), 'the title does not leak');
  });

  it('404s a trashed document', async () => {
    const { cms } = await site({
      '_trash/posts/2026-09-02-gone.md': post('Gone', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/gone/',
      }),
    });

    assert.equal(cms.store.getByPermalink('/2026/09/gone/')?.title, 'Gone');
    assert.equal((await cms.app.request('/2026/09/gone/')).status, 404);
  });

  it('404s a path no document claims, through the theme', async () => {
    const { cms } = await site({});

    const response = await cms.app.request('/nothing-here/');

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /Not found/);
  });
});

describe('a tag archive', () => {
  const tagged = {
    'posts/notes.md': post('Notes', {
      date: '2026-09-03T09:00:00Z',
      permalink: '/notes/',
      tags: ['eleventy', 'notes'],
    }),
    'posts/more-notes.md': post('More notes', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/more-notes/',
      tags: ['eleventy'],
    }),
    'posts/unrelated.md': post('Unrelated', {
      date: '2026-09-01T09:00:00Z',
      permalink: '/unrelated/',
      tags: ['other'],
    }),
  };

  it('lists the posts carrying that tag and nothing else', async () => {
    const { cms } = await site(tagged);

    const response = await cms.app.request('/tag/eleventy/');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('href="/notes/"'), 'a tagged post is listed');
    assert.ok(html.includes('href="/more-notes/"'), 'the other tagged post is listed');
    assert.ok(!html.includes('href="/unrelated/"'), 'an untagged post is not');
    assert.ok(html.includes('eleventy'), 'the tag names the archive');
  });

  it('leaves drafts out of the archive', async () => {
    const { cms } = await site({
      ...tagged,
      'posts/hidden.md': post('Hidden', {
        date: '2026-08-04T09:00:00Z',
        permalink: '/hidden/',
        tags: ['eleventy'],
        draft: true,
      }),
    });

    const html = await (await cms.app.request('/tag/eleventy/')).text();

    assert.ok(!html.includes('href="/hidden/"'), 'the draft is not listed');
  });

  it('paginates, at /tag/{tag}/page/N/', async () => {
    const { cms } = await site({
      ...tagged,
      '_data/site.json': JSON.stringify({ title: 'Paged', postsPerPage: 1 }),
    });

    const first = await (await cms.app.request('/tag/eleventy/')).text();
    assert.ok(first.includes('href="/tag/eleventy/page/2/"'), 'page one links to page two');

    const second = await cms.app.request('/tag/eleventy/page/2/');
    assert.equal(second.status, 200);
    assert.ok(
      (await second.text()).includes('href="/more-notes/"'),
      'page two holds the older post',
    );
  });

  it('404s a tag nothing carries', async () => {
    const { cms } = await site(tagged);

    assert.equal((await cms.app.request('/tag/nobody-uses-this/')).status, 404);
  });

  it('is not at the old /tags/ base', async () => {
    const { cms } = await site(tagged);

    assert.equal((await cms.app.request('/tags/eleventy/')).status, 404);
  });
});

describe('the taxonomy bases', () => {
  const filed = {
    'posts/notes.md': post('Notes', {
      date: '2026-09-03T09:00:00Z',
      permalink: '/notes/',
      tags: ['eleventy'],
      categories: ['general'],
    }),
    'posts/more.md': post('More notes', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/more-notes/',
      tags: ['eleventy'],
      categories: ['general'],
    }),
  };

  /** The same content with the bases named in `content/_data/site.json`. */
  async function based(bases: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return await site({
      ...filed,
      '_data/site.json': JSON.stringify({ title: 'Based', ...bases, ...extra }),
    });
  }

  it('moves both archives when the site names its own', async () => {
    const { cms } = await based({ tagBase: 'topics', categoryBase: 'filed-under' });

    assert.equal((await cms.app.request('/topics/eleventy/')).status, 200);
    assert.equal((await cms.app.request('/filed-under/general/')).status, 200);
    assert.equal((await cms.app.request('/tag/eleventy/')).status, 404);
    assert.equal((await cms.app.request('/category/general/')).status, 404);
  });

  it('moves the paging, the canonical redirect and the JSON listing with them', async () => {
    const { cms } = await based(
      { tagBase: 'topics', categoryBase: 'filed-under' },
      {
        postsPerPage: 1,
      },
    );

    const first = await (await cms.app.request('/topics/eleventy/')).text();
    assert.ok(first.includes('href="/topics/eleventy/page/2/"'), 'page one links to page two');
    assert.equal((await cms.app.request('/topics/eleventy/page/2/')).status, 200);

    const redirect = await cms.app.request('/topics/eleventy');
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/topics/eleventy/');

    const collapsed = await cms.app.request('/topics/eleventy/page/1/');
    assert.equal(collapsed.status, 301);
    assert.equal(collapsed.headers.get('location'), '/topics/eleventy/');

    const json = await cms.app.request('/topics/eleventy/index.json');
    assert.equal(json.status, 200);
  });

  it('moves the tag feeds and the links the theme renders', async () => {
    const { cms } = await based({ tagBase: 'topics', categoryBase: 'filed-under' });

    assert.equal((await cms.app.request('/topics/eleventy/feed/')).status, 200);
    assert.equal((await cms.app.request('/topics/eleventy/feed/atom/')).status, 200);
    assert.equal((await cms.app.request('/topics/eleventy/feed/json/')).status, 200);
    assert.equal((await cms.app.request('/tag/eleventy/feed/')).status, 404);

    const archive = await (await cms.app.request('/topics/eleventy/')).text();
    assert.ok(archive.includes('href="/topics/eleventy/feed/"'), 'the archive advertises its feed');

    const article = await (await cms.app.request('/notes/')).text();
    assert.ok(article.includes('href="/topics/eleventy/"'), 'the tag link follows the base');
    assert.ok(article.includes('href="/filed-under/general/"'), 'the category link follows too');
  });

  it('ignores a base that could not work and serves the default instead', async () => {
    const { cms } = await based({ tagBase: 'admin', categoryBase: 'a/b' });

    assert.equal((await cms.app.request('/tag/eleventy/')).status, 200);
    assert.equal((await cms.app.request('/category/general/')).status, 200);
  });
});

describe('a category archive', () => {
  const filed = {
    'posts/notes.md': post('Notes', {
      date: '2026-09-03T09:00:00Z',
      permalink: '/notes/',
      tags: ['eleventy'],
      categories: ['general', 'meta'],
    }),
    'posts/more-notes.md': post('More notes', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/more-notes/',
      categories: ['general'],
    }),
    'posts/unrelated.md': post('Unrelated', {
      date: '2026-09-01T09:00:00Z',
      permalink: '/unrelated/',
      categories: ['other'],
    }),
  };

  it('lists the posts filed under that category and nothing else', async () => {
    const { cms } = await site(filed);

    const response = await cms.app.request('/category/general/');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(html.includes('href="/notes/"'), 'a filed post is listed');
    assert.ok(html.includes('href="/more-notes/"'), 'the other filed post is listed');
    assert.ok(!html.includes('href="/unrelated/"'), 'a post filed elsewhere is not');
    assert.ok(html.includes('general'), 'the category names the archive');
  });

  it('is a different archive from the tag of the same name', async () => {
    const { cms } = await site(filed);

    assert.equal((await cms.app.request('/tag/general/')).status, 404);
    assert.equal((await cms.app.request('/category/eleventy/')).status, 404);
  });

  it('leaves drafts and the trash out of the archive', async () => {
    const { cms } = await site({
      ...filed,
      'posts/hidden.md': post('Hidden', {
        date: '2026-08-04T09:00:00Z',
        permalink: '/hidden/',
        categories: ['general'],
        draft: true,
      }),
      '_trash/posts/gone.md': post('Gone', {
        date: '2026-08-05T09:00:00Z',
        permalink: '/gone/',
        categories: ['general'],
      }),
    });

    const html = await (await cms.app.request('/category/general/')).text();

    assert.ok(!html.includes('href="/hidden/"'), 'the draft is not listed');
    assert.ok(!html.includes('href="/gone/"'), 'the trashed post is not listed');
    assert.ok(!html.includes('Hidden'), 'the draft title does not leak');
    assert.ok(!html.includes('Gone'), 'the trashed title does not leak');
  });

  it('paginates, at /category/{slug}/page/N/', async () => {
    const { cms } = await site({
      ...filed,
      '_data/site.json': JSON.stringify({ title: 'Paged', postsPerPage: 1 }),
    });

    const first = await (await cms.app.request('/category/general/')).text();
    assert.ok(first.includes('href="/category/general/page/2/"'), 'page one links to page two');

    const second = await cms.app.request('/category/general/page/2/');
    assert.equal(second.status, 200);
    assert.ok(
      (await second.text()).includes('href="/more-notes/"'),
      'page two holds the older post',
    );
  });

  it('301s the archive URL that arrived without its trailing slash', async () => {
    const { cms } = await site(filed);

    const response = await cms.app.request('/category/general');

    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/category/general/');
  });

  it('404s a category nothing is filed under', async () => {
    const { cms } = await site(filed);

    assert.equal((await cms.app.request('/category/nobody-files-here/')).status, 404);
    assert.equal((await cms.app.request('/category/nobody-files-here/page/2/')).status, 404);
  });

  it('serves the archive as JSON at /category/{slug}/index.json', async () => {
    const { cms } = await site(filed);

    const response = await cms.app.request('/category/general/index.json');
    const body = (await response.json()) as { url: string }[];

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(
      body.map((entry) => entry.url),
      ['http://localhost:3000/notes/', 'http://localhost:3000/more-notes/'],
    );
  });

  it('links a post to every category it is filed under', async () => {
    const { cms } = await site(filed);

    const html = await (await cms.app.request('/notes/')).text();

    assert.ok(html.includes('/category/general/'), 'the first category links to its archive');
    assert.ok(html.includes('/category/meta/'), 'the second category links to its archive');
  });
});

describe('a scheduled post', () => {
  /** A site whose clock this test moves, holding one post dated ahead of it. */
  async function scheduledSite(): Promise<{ cms: Cms; set: (instant: string) => void }> {
    let now = new Date('2026-09-03T12:00:00Z');
    const { cms } = await site(
      {
        'posts/2026-09-03-live.md': post('Live', {
          date: '2026-09-03T09:00:00Z',
          permalink: '/2026/09/live/',
          tags: ['eleventy'],
          categories: ['general'],
        }),
        'posts/2026-09-04-tomorrow.md': post('Tomorrow', {
          date: '2026-09-04T09:00:00Z',
          permalink: '/2026/09/tomorrow/',
          tags: ['scheduling'],
          categories: ['general'],
        }),
      },
      { now: () => now },
    );
    return {
      cms,
      set: (instant: string) => {
        now = new Date(instant);
      },
    };
  }

  it('is absent from the home page and its permalink 404s until its date', async () => {
    const { cms, set } = await scheduledSite();

    const before = await cms.app.request('/');
    const beforeHtml = await before.text();

    assert.ok(!beforeHtml.includes('/2026/09/tomorrow/'), 'the scheduled post is not linked');
    assert.ok(!beforeHtml.includes('Tomorrow'), 'its title does not leak');
    assert.ok(beforeHtml.includes('/2026/09/live/'), 'the published one is still there');
    assert.equal((await cms.app.request('/2026/09/tomorrow/')).status, 404);
    assert.equal((await cms.app.request('/2026/09/tomorrow/index.json')).status, 404);
    assert.equal((await cms.app.request('/2026/09/tomorrow/index.md')).status, 404);

    set('2026-09-04T09:00:00Z');

    const after = await cms.app.request('/');

    assert.ok((await after.text()).includes('/2026/09/tomorrow/'), 'it is linked once due');
    assert.equal((await cms.app.request('/2026/09/tomorrow/')).status, 200);
  });

  it('creates no archive of its own, and is missing from one it shares', async () => {
    const { cms, set } = await scheduledSite();

    assert.equal((await cms.app.request('/tag/scheduling/')).status, 404);
    const shared = await (await cms.app.request('/category/general/')).text();
    assert.ok(!shared.includes('Tomorrow'), 'it is not in the archive it shares');
    assert.ok(shared.includes('Live'), 'the published one is');

    set('2026-09-04T09:00:00Z');

    assert.equal((await cms.app.request('/tag/scheduling/')).status, 200);
    assert.ok(
      (await (await cms.app.request('/category/general/')).text()).includes('Tomorrow'),
      'it joins the shared archive once due',
    );
  });
});

describe('canonical URLs', () => {
  const files = {
    'posts/notes.md': post('Notes', {
      date: '2026-09-03T09:00:00Z',
      permalink: '/notes/',
      tags: ['eleventy'],
    }),
    'pages/about.md': page('About', '/about/'),
    '_data/site.json': JSON.stringify({ title: 'Canonical', postsPerPage: 1 }),
  };

  it('301s a document URL that arrived without its trailing slash', async () => {
    const { cms } = await site(files);

    const response = await cms.app.request('/about');

    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/about/');
  });

  it('301s a listing URL that arrived without its trailing slash', async () => {
    const { cms } = await site(files);

    for (const [requested, canonical] of [
      ['/tag/eleventy', '/tag/eleventy/'],
      ['/page/1', '/'],
    ] as const) {
      const response = await cms.app.request(requested);
      assert.equal(response.status, 301, `${requested} redirects`);
      assert.equal(response.headers.get('location'), canonical);
    }
  });

  it('keeps the query string when it redirects', async () => {
    const { cms } = await site(files);

    const response = await cms.app.request('/about?utm_source=elsewhere');

    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/about/?utm_source=elsewhere');
  });

  it('404s rather than redirecting when the canonical URL is empty too', async () => {
    const { cms } = await site(files);

    const response = await cms.app.request('/nothing-here');

    assert.equal(response.status, 404);
  });

  it('does not redirect a draft into existence', async () => {
    const { cms } = await site({
      'posts/secret.md': post('Secret', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/secret/',
        draft: true,
      }),
    });

    assert.equal((await cms.app.request('/secret')).status, 404);
  });
});

describe('the conversation under a post', () => {
  const files = {
    'posts/2026-09-02-hello.md': post('Hello, World!', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/hello/',
    }),
  };

  /** The object id the fediverse knows the post by. */
  const HELLO = 'https://example.com/2026/09/hello/';

  /** A CMS whose posts are federated, so a reply can name one. */
  async function federated(): Promise<Cms> {
    const { cms } = await site(files, { baseUrl: 'https://example.com' });
    return cms;
  }

  /** Log a reply the way the inbox logs one: a compacted `Create` of a `Note`. */
  function reply(
    cms: Cms,
    options: { id: string; inReplyTo: string; actor?: string; content?: string; url?: string },
  ): void {
    const actor = options.actor ?? 'https://remote.example/users/ada';
    cms.admin.logInboxActivity({
      activityId: `${options.id}/activity`,
      activityType: 'Create',
      actorId: actor,
      objectId: options.id,
      json: JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${options.id}/activity`,
        type: 'Create',
        actor,
        object: {
          id: options.id,
          type: 'Note',
          attributedTo: actor,
          content: options.content ?? '<p>Good post.</p>',
          inReplyTo: options.inReplyTo,
          published: '2026-09-02T10:00:00Z',
          ...(options.url === undefined ? {} : { url: options.url }),
        },
      }),
    });
  }

  /** Log a like or a boost of the post. */
  function reaction(cms: Cms, type: 'Like' | 'Announce', id: string, actor: string): void {
    cms.admin.logInboxActivity({
      activityId: id,
      activityType: type,
      actorId: actor,
      objectId: HELLO,
      json: JSON.stringify({ id, type, actor, object: HELLO }),
    });
  }

  it('shows the replies the inbox logged, with author, avatar, time and a link', async () => {
    const cms = await federated();
    cms.admin.putFollower({
      username: 'ada',
      actorId: 'https://remote.example/users/ada',
      inboxId: 'https://remote.example/users/ada/inbox',
      sharedInboxId: null,
      handle: '@ada@remote.example',
      name: 'Ada Lovelace',
      iconUrl: 'https://remote.example/avatars/ada.png',
      url: 'https://remote.example/@ada',
    });
    reply(cms, {
      id: 'https://remote.example/notes/1',
      inReplyTo: HELLO,
      url: 'https://remote.example/@ada/1',
    });
    reply(cms, {
      id: 'https://remote.example/notes/2',
      inReplyTo: 'https://remote.example/notes/1',
      actor: 'https://remote.example/users/bob',
      content: '<p>Agreed<script>alert(1)</script>.</p>',
    });

    const html = await (await cms.app.request('/2026/09/hello/')).text();

    assert.ok(html.includes('Ada Lovelace'), 'the author is named from the follower profile');
    assert.ok(html.includes('https://remote.example/avatars/ada.png'), 'the avatar is shown');
    assert.ok(
      html.includes('href="https://remote.example/@ada"'),
      'the author links to the remote profile',
    );
    assert.ok(
      html.includes('href="https://remote.example/@ada/1"'),
      'the reply links to the remote note',
    );
    assert.ok(html.includes('datetime="2026-09-02T10:00:00.000Z"'), 'the reply carries its time');
    assert.ok(html.includes('<p>Good post.</p>'), 'the reply content is rendered');
    assert.ok(html.includes('@bob@remote.example'), 'an author nobody follows is named by handle');
    assert.ok(!html.includes('alert(1)'), 'the remote HTML is sanitised');

    // The answer to the reply is nested inside it rather than beside it.
    const first = html.indexOf('<p>Good post.</p>');
    const nested = html.indexOf('comment-replies');
    assert.ok(nested > first && nested < html.indexOf('Agreed'), 'the answer is nested');
  });

  it('shows the likes and the boosts as counts with the actors behind them', async () => {
    const cms = await federated();
    reaction(cms, 'Like', 'https://remote.example/likes/1', 'https://remote.example/users/ada');
    reaction(cms, 'Like', 'https://remote.example/likes/2', 'https://remote.example/users/bob');
    reaction(
      cms,
      'Announce',
      'https://remote.example/boosts/1',
      'https://remote.example/users/cal',
    );

    const html = await (await cms.app.request('/2026/09/hello/')).text();

    assert.ok(html.includes('2 likes'), 'the likes are counted');
    assert.ok(html.includes('1 boost'), 'the boosts are counted, in the singular');
    assert.ok(html.includes('<details'), 'the actors are behind a disclosure');
    assert.ok(html.includes('@ada@remote.example'), 'the first liker is listed');
    assert.ok(html.includes('@cal@remote.example'), 'the booster is listed');
  });

  it('drops a reply whose author deleted it', async () => {
    const cms = await federated();
    reply(cms, { id: 'https://remote.example/notes/1', inReplyTo: HELLO });
    cms.admin.logInboxActivity({
      activityId: 'https://remote.example/deletes/1',
      activityType: 'Delete',
      actorId: 'https://remote.example/users/ada',
      objectId: 'https://remote.example/notes/1',
      json: JSON.stringify({
        type: 'Delete',
        actor: 'https://remote.example/users/ada',
        object: { id: 'https://remote.example/notes/1', type: 'Tombstone' },
      }),
    });

    const html = await (await cms.app.request('/2026/09/hello/')).text();

    assert.ok(!html.includes('Good post.'), 'the deleted reply is gone');
    assert.ok(!html.includes('class="conversation"'), 'and the section goes with it');
  });

  it('renders no section at all under a post nobody has answered', async () => {
    const cms = await federated();

    const html = await (await cms.app.request('/2026/09/hello/')).text();

    assert.ok(!html.includes('conversation'), 'there is no empty conversation section');
  });

  it('lets the chosen theme replace the partial', async () => {
    const themesDir = await fixtureTheme({
      'partials/conversation.njk':
        '<p class="my-own">{{ conversation.counts.total }} interactions</p>\n',
    });
    const { cms } = await site(
      { ...files, ...choosing() },
      { baseUrl: 'https://example.com', themesDir },
    );
    reply(cms, { id: 'https://remote.example/notes/1', inReplyTo: HELLO });

    const html = await (await cms.app.request('/2026/09/hello/')).text();

    assert.ok(html.includes('<p class="my-own">1 interactions</p>'), 'the override is used');
    assert.ok(!html.includes('Good post.'), 'and the packaged partial is not');
  });
});

describe('theme assets', () => {
  it('serves the default theme stylesheet from /theme/ with cache headers', async () => {
    const { cms } = await site({});

    const response = await cms.app.request('/theme/style.css');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/css/);
    assert.match(response.headers.get('cache-control') ?? '', /max-age=\d+/);
    assert.ok(response.headers.get('etag') !== null, 'an ETag is set');
    assert.ok(response.headers.get('last-modified') !== null, 'a Last-Modified is set');
    assert.match(await response.text(), /body/);
  });

  it('answers 304 when the ETag still matches', async () => {
    const { cms } = await site({});
    const first = await cms.app.request('/theme/style.css');
    const etag = first.headers.get('etag') ?? '';

    const second = await cms.app.request('/theme/style.css', {
      headers: { 'if-none-match': etag },
    });

    assert.equal(second.status, 304);
    assert.equal(await second.text(), '');
  });

  it('prefers an asset the chosen theme ships over the packaged one', async () => {
    const themesDir = await fixtureTheme({ 'static/style.css': 'body { color: rebeccapurple }\n' });
    const { cms } = await site(choosing(), { themesDir });

    const response = await cms.app.request('/theme/style.css');

    assert.equal(await response.text(), 'body { color: rebeccapurple }\n');
  });

  it('refuses to walk out of the theme directory', async () => {
    const { cms } = await site({});

    for (const attempt of [
      '/theme/../../package.json',
      '/theme/%2e%2e%2f%2e%2e%2fpackage.json',
      '/theme/..%2F..%2Fpackage.json',
    ]) {
      const response = await cms.app.request(attempt);
      assert.equal(response.status, 404, `${attempt} is refused`);
      assert.ok(!(await response.text()).includes('"@geekity/cms"'), 'no file escapes');
    }
  });

  it('404s an asset neither theme has', async () => {
    const { cms } = await site({});

    assert.equal((await cms.app.request('/theme/nope.css')).status, 404);
  });
});

describe('uploads', () => {
  it('serves a file from content/uploads at the URL Eleventy copies it to', async () => {
    const { cms } = await site({ 'uploads/2026/09/notes.txt': 'Attached.\n' });

    const response = await cms.app.request('/uploads/2026/09/notes.txt');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/plain/);
    assert.match(response.headers.get('cache-control') ?? '', /max-age=\d+/);
    assert.ok(response.headers.get('etag') !== null, 'an ETag is set');
    assert.equal(await response.text(), 'Attached.\n');
  });

  it('answers 304 when the ETag still matches', async () => {
    const { cms } = await site({ 'uploads/2026/09/notes.txt': 'Attached.\n' });
    const first = await cms.app.request('/uploads/2026/09/notes.txt');

    const second = await cms.app.request('/uploads/2026/09/notes.txt', {
      headers: { 'if-none-match': first.headers.get('etag') ?? '' },
    });

    assert.equal(second.status, 304);
    assert.equal(await second.text(), '');
  });

  it('refuses to walk out of the uploads directory', async () => {
    const { cms } = await site({
      'posts/secret.md': post('Secret', { date: '2026-09-03', permalink: '/secret/' }),
    });

    for (const attempt of [
      '/uploads/../posts/secret.md',
      '/uploads/%2e%2e%2fposts%2fsecret.md',
      '/uploads/..%2Fposts%2Fsecret.md',
    ]) {
      const response = await cms.app.request(attempt);
      assert.ok(
        !(await response.text()).includes('title: Secret'),
        `${attempt} escaped the uploads directory`,
      );
    }
  });

  it('404s an upload that is not there', async () => {
    const { cms } = await site({});

    assert.equal((await cms.app.request('/uploads/2026/09/nope.png')).status, 404);
  });
});

describe('overriding one template', () => {
  const files = {
    'posts/notes.md': post('Notes', {
      date: '2026-09-03T09:00:00Z',
      permalink: '/notes/',
      tags: ['eleventy'],
    }),
    'pages/about.md': page('About', '/about/'),
  };

  it('takes the overridden template from the theme and the rest from the package', async () => {
    const themesDir = await fixtureTheme({
      'layouts/post.njk': '<!doctype html><h1>overridden: {{ title }}</h1>{{ content | safe }}',
    });
    const { cms } = await site({ ...files, ...choosing() }, { themesDir });

    const overridden = await (await cms.app.request('/notes/')).text();
    assert.ok(overridden.includes('overridden: Notes'), 'the site post layout rendered');

    for (const [url, marker] of [
      ['/', 'global-header'],
      ['/about/', 'page-body'],
      ['/tag/eleventy/', 'Tagged'],
      ['/nothing-here/', 'Not found'],
    ] as const) {
      const response = await cms.app.request(url);
      const html = await response.text();
      assert.ok(!html.includes('overridden'), `${url} did not use the post override`);
      assert.ok(html.includes(marker), `${url} still came from the packaged theme`);
    }
  });

  it('is fine with a themes directory that does not exist', async () => {
    const { cms } = await site(files, { themesDir: '/definitely/not/a/directory' });

    assert.equal((await cms.app.request('/notes/')).status, 200);
    assert.equal((await cms.app.request('/theme/style.css')).status, 200);
  });

  it('lets an override reach the same context an Eleventy layout gets', async () => {
    const themesDir = await fixtureTheme({
      'layouts/post.njk': [
        '<!doctype html>',
        '<p id="title">{{ title }}</p>',
        '<p id="date">{{ date | date("html") }}</p>',
        '<p id="tags">{{ tags | join(",") }}</p>',
        '<p id="url">{{ page.url }}</p>',
        '<p id="fileSlug">{{ page.fileSlug }}</p>',
        '<p id="inputPath">{{ page.inputPath }}</p>',
        '<p id="description">{{ description }}</p>',
        '<p id="series">{{ series }}</p>',
        '<p id="siteTitle">{{ site.title }}</p>',
        '<div id="content">{{ content | safe }}</div>',
      ].join('\n'),
    });
    const { cms } = await site(
      {
        ...choosing({ title: 'Fixture Site' }),
        'posts/2026-09-02-hello.md': [
          '---',
          'title: Hello',
          "date: '2026-09-02T09:00:00Z'",
          'permalink: /2026/09/hello/',
          'tags:',
          '  - one',
          '  - two',
          'description: A description.',
          'series: notebook',
          '---',
          '',
          'Body **text**.',
          '',
        ].join('\n'),
      },
      { themesDir },
    );

    const html = await (await cms.app.request('/2026/09/hello/')).text();
    const value = (id: string): string =>
      new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1]?.trim() ?? '';

    assert.equal(value('title'), 'Hello');
    assert.equal(value('date'), '2026-09-02');
    assert.equal(value('tags'), 'one,two');
    assert.equal(value('url'), '/2026/09/hello/');
    assert.equal(value('fileSlug'), 'hello');
    assert.equal(value('inputPath'), './posts/2026-09-02-hello.md');
    assert.equal(value('description'), 'A description.');
    assert.equal(value('series'), 'notebook', 'an unmodelled front matter key is in the context');
    assert.equal(
      value('siteTitle'),
      'Fixture Site',
      'content/_data/site.json is the `site` global',
    );
    assert.ok(html.includes('<p>Body <strong>text</strong>.</p>'), 'content is the rendered body');
  });
});

describe('the site menu', () => {
  /** The menu links one page carries, as `label -> href`, in menu order. */
  function menu(html: string): Array<[string, string]> {
    const nav = /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    return [...nav.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((match) => [
      match[2] ?? '',
      match[1] ?? '',
    ]);
  }

  /** The label of the item marked as the page being read, if there is one. */
  function current(html: string): string | undefined {
    const nav = /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    return /aria-current="page"[^>]*>([^<]*)</.exec(nav)?.[1];
  }

  it('renders the setting in order on every kind of page, marking the current one (AC #1)', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({
        title: 'Menu Site',
        navigation: [
          { label: 'Home', url: '/' },
          { label: 'About', url: '/about/' },
          { label: 'Elsewhere', url: 'https://example.org/' },
        ],
      }),
      'posts/2026-09-02-hello.md': post('Hello', {
        date: '2026-09-02T10:00:00Z',
        permalink: '/2026/09/hello/',
        tags: ['notes'],
      }),
      'pages/about.md': page('About', '/about/'),
    });

    const expected: Array<[string, string]> = [
      ['Home', '/'],
      ['About', '/about/'],
      ['Elsewhere', 'https://example.org/'],
    ];

    const home = await (await cms.app.request('/')).text();
    assert.deepEqual(menu(home), expected, 'the home page');
    assert.equal(current(home), 'Home');

    const article = await (await cms.app.request('/2026/09/hello/')).text();
    assert.deepEqual(menu(article), expected, 'a post');
    assert.equal(current(article), undefined, 'a post is on no menu item');

    const about = await (await cms.app.request('/about/')).text();
    assert.deepEqual(menu(about), expected, 'a page');
    assert.equal(current(about), 'About');

    const archive = await (await cms.app.request('/tag/notes/')).text();
    assert.deepEqual(menu(archive), expected, 'a tag archive');
    assert.equal(current(archive), undefined);
  });

  it('shows no menu at all for a site.json that names none (AC #3)', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({ title: 'Old Site', tagline: 'from before the setting' }),
      'pages/about.md': page('About', '/about/'),
    });

    const home = await (await cms.app.request('/')).text();
    assert.deepEqual(menu(home), []);
    assert.ok(!home.includes('site-nav'), 'and no empty <nav> either');
  });

  it('puts a page that opted in on the menu, after the items (AC #2)', async () => {
    const { cms } = await site({
      '_data/site.json': JSON.stringify({
        title: 'Menu Site',
        navigation: [{ label: 'Home', url: '/' }],
      }),
      'pages/about.md': `---\ntitle: About\npermalink: /about/\nnavigation: true\n---\n\nBody.\n`,
      'pages/now.md': `---\ntitle: Now\npermalink: /now/\nnavigation: true\nnavigationOrder: 1\n---\n\nBody.\n`,
      'pages/colophon.md': page('Colophon', '/colophon/'),
    });

    const home = await (await cms.app.request('/')).text();
    assert.deepEqual(menu(home), [
      ['Home', '/'],
      ['Now', '/now/'],
      ['About', '/about/'],
    ]);

    const now = await (await cms.app.request('/now/')).text();
    assert.equal(current(now), 'Now');
  });
});

describe('the timezone setting as a lens on the dates', () => {
  /** One post, published at two in the morning UTC on 2 September. */
  const files = {
    'posts/2026-09-02-just-after-midnight.md': [
      '---',
      'title: Just after midnight',
      "date: '2026-09-02T02:00:00Z'",
      'permalink: /2026/09/just-after-midnight/',
      '---',
      '',
      'Body.',
      '',
    ].join('\n'),
  };

  /** Put the site in one zone, the way the settings screen would. */
  async function setTimezone(contentDir: string, timezone: string): Promise<void> {
    await writeSiteJson({
      contentDir,
      settings: { ...readSiteSettings(contentDir), timezone },
    });
  }

  it('changes what a page shows without changing a file', async () => {
    const { cms, contentDir } = await site(files);
    const file = path.join(contentDir, 'posts', '2026-09-02-just-after-midnight.md');
    const before = await readFile(file, 'utf8');

    await setTimezone(contentDir, 'UTC');
    const inUtc = await (await cms.app.request('/2026/09/just-after-midnight/')).text();
    assert.match(inUtc, /2 September 2026/);
    assert.match(inUtc, /datetime="2026-09-02T02:00:00\.000Z"/, 'iso stays the instant');

    await setTimezone(contentDir, 'America/Chicago');
    const inChicago = await (await cms.app.request('/2026/09/just-after-midnight/')).text();
    assert.match(inChicago, /1 September 2026/, 'the evening before, where the site lives');
    assert.match(inChicago, /datetime="2026-09-02T02:00:00\.000Z"/, 'and iso has not moved');

    assert.equal(await readFile(file, 'utf8'), before, 'and nothing on disk changed');
    assert.equal(
      cms.store.getByPermalink('/2026/09/just-after-midnight/')?.permalink,
      '/2026/09/just-after-midnight/',
      'nor did the URL',
    );
  });
});
