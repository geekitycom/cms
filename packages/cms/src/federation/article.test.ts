import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { SiteSettings } from '../admin/settings.ts';
import { renderMarkdown } from '../content/markdown.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { OUTBOX_PAGE_SIZE } from './federation.ts';
import { createActivityId, postObjectId } from './paths.ts';

/** The origin every request in this file is sent to; Fedify checks it. */
const BASE_URL = 'https://blog.example';

/** What a peer asks for when it wants the ActivityStreams document. */
const ACTIVITY_STREAMS = 'application/activity+json';

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
 * A federated CMS over a content directory holding `files`, already synced.
 *
 * The settings are written before the CMS opens the database, because
 * {@link createCms} seeds an empty settings table from `site.json` and
 * federation reads what it finds there on every request.
 */
async function site(
  files: Record<string, string>,
  settings: Partial<SiteSettings> = {},
  config: GeekityConfig = {},
): Promise<Cms> {
  const dataDir = await temporaryDir('geekity-article-data-');
  const contentDir = await temporaryDir('geekity-article-content-');
  await writeTree(contentDir, files);

  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'Geekity',
      tagline: 'A file-first CMS',
      baseUrl: BASE_URL,
      timezone: 'UTC',
      postsPerPage: 10,
      author: 'Ada',
      actorHandle: 'blog',
      actorType: 'Person',
      avatar: '',
      ...settings,
    },
  });

  const instance = createCms({ dataDir, contentDir, watch: false, baseUrl: BASE_URL, ...config });
  started.push(instance);
  await instance.sync();
  return instance;
}

/** A request to the site's own origin, since Fedify answers by origin. */
async function get(instance: Cms, pathname: string, accept?: string): Promise<Response> {
  const request = new Request(
    `${BASE_URL}${pathname}`,
    accept === undefined ? {} : { headers: { accept } },
  );
  return await instance.app.request(request);
}

/** A post file, front matter and all. */
function post(
  title: string,
  options: {
    date: string;
    permalink: string;
    updated?: string;
    tags?: string[];
    categories?: string[];
    draft?: boolean;
    body?: string;
  },
): string {
  const lines = [
    `title: ${JSON.stringify(title)}`,
    `date: '${options.date}'`,
    `permalink: ${options.permalink}`,
  ];
  if (options.updated !== undefined) lines.push(`updated: '${options.updated}'`);
  if (options.tags !== undefined) {
    lines.push('tags:', ...options.tags.map((tag) => `  - ${tag}`));
  }
  if (options.categories !== undefined) {
    lines.push('categories:', ...options.categories.map((category) => `  - ${category}`));
  }
  if (options.draft === true) lines.push('draft: true');

  return `---\n${lines.join('\n')}\n---\n\n${options.body ?? 'Body.'}\n`;
}

const HELLO_BODY = 'A *first* post, with a [link](https://example.org/).';

/** One published post, at `/2026/09/hello/`, tagged and filed. */
const HELLO = {
  'posts/2026-09-02-hello.md': post('Hello, World!', {
    date: '2026-09-02T09:00:00Z',
    updated: '2026-09-03T10:30:00Z',
    permalink: '/2026/09/hello/',
    tags: ['notes', 'meta'],
    categories: ['general'],
    body: HELLO_BODY,
  }),
};

describe('the post object', () => {
  it('serves an Article whose content is the HTML and whose source is the Markdown', async () => {
    const instance = await site(HELLO);

    const response = await get(instance, '/ap/posts/hello', ACTIVITY_STREAMS);

    assert.equal(response.status, 200);
    const article = (await response.json()) as Record<string, unknown>;
    assert.equal(article['type'], 'Article');
    assert.equal(article['id'], `${BASE_URL}/ap/posts/hello`);
    assert.equal(article['name'], 'Hello, World!');
    assert.equal(article['content'], renderMarkdown(HELLO_BODY));
    assert.deepEqual(article['source'], {
      content: HELLO_BODY,
      mediaType: 'text/markdown',
    });
  });

  it('carries the permalink, the dates, the actor and the addressing doc-4 asks for', async () => {
    const instance = await site(HELLO);

    const article = (await (
      await get(instance, '/ap/posts/hello', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;

    // The id is built from the slug, the url from the permalink, so a post
    // that moves keeps its object.
    assert.equal(article['url'], `${BASE_URL}/2026/09/hello/`);
    assert.equal(article['published'], '2026-09-02T09:00:00Z');
    assert.equal(article['updated'], '2026-09-03T10:30:00Z');
    assert.equal(article['attributedTo'], `${BASE_URL}/ap/actor`);
    // `as:Public` is how the ActivityStreams context compacts the public
    // collection; it is the form Mastodon and friends both send and expect.
    assert.equal(article['to'], 'as:Public');
    assert.equal(article['cc'], `${BASE_URL}/ap/actor/followers`);
  });

  it('publishes one Hashtag per tag and per category, pointing at their archives', async () => {
    const instance = await site(HELLO);

    const article = (await (
      await get(instance, '/ap/posts/hello', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;

    const tags = article['tag'];
    const list = (Array.isArray(tags) ? tags : [tags]) as {
      type?: string;
      name?: string;
      href?: string;
    }[];
    assert.deepEqual(
      list.map((tag) => [tag.type, tag.name, tag.href]),
      [
        ['Hashtag', '#notes', `${BASE_URL}/tag/notes/`],
        ['Hashtag', '#meta', `${BASE_URL}/tag/meta/`],
        ['Hashtag', '#general', `${BASE_URL}/category/general/`],
      ],
    );
  });

  it('points its hashtags at the bases the site is configured with (AC #5)', async () => {
    const instance = await site(HELLO, { tagBase: 'topics', categoryBase: 'filed' });

    const article = (await (
      await get(instance, '/ap/posts/hello', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;

    const tags = article['tag'];
    const list = (Array.isArray(tags) ? tags : [tags]) as { href?: string }[];
    assert.deepEqual(
      list.map((tag) => tag.href),
      [`${BASE_URL}/topics/notes/`, `${BASE_URL}/topics/meta/`, `${BASE_URL}/filed/general/`],
    );

    const outbox = (await (
      await get(instance, '/ap/actor/outbox', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    const page = await fetchLink(instance, outbox['first']);
    assert.ok(
      JSON.stringify(page).includes(`${BASE_URL}/topics/notes/`),
      'the outbox carries the same archive URLs',
    );
  });

  it('dispatches nothing for a draft, a trashed post, a page or an unknown slug', async () => {
    const instance = await site({
      ...HELLO,
      'posts/2026-09-01-secret.md': post('Secret', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/2026/09/secret/',
        draft: true,
      }),
      '_trash/posts/2026-08-30-gone.md': post('Gone', {
        date: '2026-08-30T09:00:00Z',
        permalink: '/2026/08/gone/',
      }),
      'pages/about.md': post('About', {
        date: '2026-01-01T09:00:00Z',
        permalink: '/about/',
      }),
    });

    for (const slug of ['secret', 'gone', 'about', 'never-written']) {
      const response = await get(instance, `/ap/posts/${slug}`, ACTIVITY_STREAMS);
      assert.equal(response.status, 404, `/ap/posts/${slug} is not an object`);
    }

    // The published post next to them still is, so the 404s are the filter
    // rather than a broken dispatcher.
    assert.equal((await get(instance, '/ap/posts/hello', ACTIVITY_STREAMS)).status, 200);
  });
});

/** `count` posts, each an hour older than the one before, newest `post-1`. */
function archive(count: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let index = 1; index <= count; index += 1) {
    const hour = String(count - index).padStart(2, '0');
    files[`posts/2026-09-02-post-${String(index)}.md`] = post(`Post ${String(index)}`, {
      date: `2026-09-02T${hour}:00:00Z`,
      permalink: `/2026/09/post-${String(index)}/`,
    });
  }
  return files;
}

/** Follow a link the collection published, and read it as ActivityStreams. */
async function fetchLink(instance: Cms, href: unknown): Promise<Record<string, unknown>> {
  assert.equal(typeof href, 'string', 'the collection published a link to follow');
  const url = new URL(href as string);
  const response = await instance.app.request(
    new Request(url, { headers: { accept: ACTIVITY_STREAMS } }),
  );
  assert.equal(response.status, 200, `${url.href} answers`);
  return (await response.json()) as Record<string, unknown>;
}

describe('the outbox', () => {
  it('counts the published posts and pages rather than listing them all at once', async () => {
    const instance = await site(archive(OUTBOX_PAGE_SIZE + 5));

    const outbox = (await (
      await get(instance, '/ap/actor/outbox', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;

    assert.equal(outbox['type'], 'OrderedCollection');
    assert.equal(outbox['totalItems'], OUTBOX_PAGE_SIZE + 5);
    assert.equal(outbox['orderedItems'], undefined, 'the collection itself carries no items');
    assert.ok(outbox['first'], 'it points at its first page');
    assert.ok(outbox['last'], 'and at its last');
  });

  it('lists Create activities newest first, a page at a time', async () => {
    const total = OUTBOX_PAGE_SIZE + 5;
    const instance = await site(archive(total));

    const outbox = (await (
      await get(instance, '/ap/actor/outbox', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    const first = await fetchLink(instance, outbox['first']);

    const names = (first['orderedItems'] as { object?: { name?: string } }[]).map(
      (activity) => activity.object?.name,
    );
    assert.equal(names.length, OUTBOX_PAGE_SIZE);
    assert.deepEqual(names.slice(0, 3), ['Post 1', 'Post 2', 'Post 3']);

    const second = await fetchLink(instance, first['next']);
    const rest = (second['orderedItems'] as { object?: { name?: string } }[]).map(
      (activity) => activity.object?.name,
    );
    assert.deepEqual(rest, ['Post 21', 'Post 22', 'Post 23', 'Post 24', 'Post 25']);
    assert.equal(second['next'], undefined, 'the last page has nothing after it');
  });

  it('wraps each post in a Create whose id is derived from the article', async () => {
    const instance = await site(HELLO);

    const outbox = (await (
      await get(instance, '/ap/actor/outbox', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    const page = await fetchLink(instance, outbox['first']);

    const items = page['orderedItems'] as Record<string, unknown>[];
    assert.equal(items.length, 1);
    const activity = items[0] as Record<string, unknown>;
    assert.equal(activity['type'], 'Create');
    assert.equal(activity['id'], `${BASE_URL}/ap/posts/hello#create`);
    assert.equal(activity['actor'], `${BASE_URL}/ap/actor`);
    assert.equal(activity['to'], 'as:Public');

    const object = activity['object'] as Record<string, unknown>;
    assert.equal(object['type'], 'Article');
    assert.equal(object['id'], `${BASE_URL}/ap/posts/hello`);
    assert.equal(object['name'], 'Hello, World!');
  });

  it('leaves out drafts, trash and pages, exactly as the object dispatcher does', async () => {
    const instance = await site({
      ...HELLO,
      'posts/2026-09-01-secret.md': post('Secret', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/2026/09/secret/',
        draft: true,
      }),
      '_trash/posts/2026-08-30-gone.md': post('Gone', {
        date: '2026-08-30T09:00:00Z',
        permalink: '/2026/08/gone/',
      }),
      'pages/about.md': post('About', {
        date: '2026-01-01T09:00:00Z',
        permalink: '/about/',
      }),
    });

    const outbox = (await (
      await get(instance, '/ap/actor/outbox', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    const page = await fetchLink(instance, outbox['first']);

    assert.equal(outbox['totalItems'], 1);
    assert.deepEqual(
      (page['orderedItems'] as { object?: { name?: string } }[]).map(
        (activity) => activity.object?.name,
      ),
      ['Hello, World!'],
    );
  });

  it('leaves out a post whose date has not arrived, and 404s its object', async () => {
    let now = new Date('2026-09-03T12:00:00Z');
    const instance = await site(
      {
        ...HELLO,
        'posts/2026-09-04-tomorrow.md': post('Tomorrow', {
          date: '2026-09-04T09:00:00Z',
          permalink: '/2026/09/tomorrow/',
        }),
      },
      {},
      { now: () => now },
    );

    const before = (await (
      await get(instance, '/ap/actor/outbox', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    assert.equal(before['totalItems'], 1);
    assert.equal((await get(instance, '/ap/posts/tomorrow', ACTIVITY_STREAMS)).status, 404);
    assert.equal((await get(instance, '/2026/09/tomorrow/', ACTIVITY_STREAMS)).status, 404);

    now = new Date('2026-09-04T09:00:00Z');

    const after = (await (
      await get(instance, '/ap/actor/outbox', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    assert.equal(after['totalItems'], 2);
    assert.equal((await get(instance, '/ap/posts/tomorrow', ACTIVITY_STREAMS)).status, 200);
  });
});

describe('a post permalink asked for as ActivityStreams', () => {
  it('answers with the same Article the object URL serves', async () => {
    const instance = await site(HELLO);

    const response = await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS);

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /application\/(activity\+json|ld\+json)/,
    );
    const article = (await response.json()) as Record<string, unknown>;
    assert.equal(article['type'], 'Article');
    // The id is the object URL, not the permalink: one post, one object,
    // whichever door a peer came in by.
    assert.equal(article['id'], `${BASE_URL}/ap/posts/hello`);
    assert.equal(article['content'], renderMarkdown(HELLO_BODY));
  });

  it('answers the profiled application/ld+json spelling too', async () => {
    const instance = await site(HELLO);

    const response = await get(
      instance,
      '/2026/09/hello/',
      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    );

    assert.equal(response.status, 200);
    assert.equal(
      ((await response.json()) as Record<string, unknown>)['id'],
      `${BASE_URL}/ap/posts/hello`,
    );
  });

  it('leaves the HTML, Markdown and JSON representations alone', async () => {
    const instance = await site(HELLO);

    const html = await get(
      instance,
      '/2026/09/hello/',
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    );
    const markdown = await get(instance, '/2026/09/hello/', 'text/markdown');
    const json = await get(instance, '/2026/09/hello/', 'application/json');
    const extension = await get(instance, '/2026/09/hello/index.json', ACTIVITY_STREAMS);

    assert.match(html.headers.get('content-type') ?? '', /text\/html/);
    assert.match(markdown.headers.get('content-type') ?? '', /text\/markdown/);
    assert.match(json.headers.get('content-type') ?? '', /application\/json/);
    // A named representation still wins over the header, as doc-3 says.
    assert.match(extension.headers.get('content-type') ?? '', /application\/json/);
  });

  it('does not answer for a draft, a page or a listing', async () => {
    const instance = await site({
      ...HELLO,
      'posts/2026-09-01-secret.md': post('Secret', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/2026/09/secret/',
        draft: true,
      }),
      'pages/about.md': post('About', {
        date: '2026-01-01T09:00:00Z',
        permalink: '/about/',
      }),
    });

    // A draft has no public URL at all, so it 404s exactly as it does for a
    // browser. A page and a listing exist but federate nothing, so they fall
    // through to the negotiator and earn the 406 doc-3 specifies for a request
    // whose only acceptable type is one the resource does not offer.
    assert.equal((await get(instance, '/2026/09/secret/', ACTIVITY_STREAMS)).status, 404);
    assert.equal((await get(instance, '/about/', ACTIVITY_STREAMS)).status, 406);
    assert.equal((await get(instance, '/', ACTIVITY_STREAMS)).status, 406);
  });
});

describe('the HTML post page', () => {
  it('links to the ActivityStreams object with rel=alternate', async () => {
    const instance = await site(HELLO);

    const response = await get(instance, '/2026/09/hello/', 'text/html');
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.ok(
      html.includes(
        `<link rel="alternate" type="application/activity+json" href="${BASE_URL}/ap/posts/hello">`,
      ),
      `the page advertises its object id:\n${html}`,
    );
  });

  it('does not advertise one on a page, a listing or a draft preview', async () => {
    const instance = await site({
      ...HELLO,
      'pages/about.md': post('About', {
        date: '2026-01-01T09:00:00Z',
        permalink: '/about/',
      }),
    });

    for (const pathname of ['/about/', '/', '/tag/notes/']) {
      const html = await (await get(instance, pathname, 'text/html')).text();
      assert.ok(
        !html.includes('application/activity+json'),
        `${pathname} federates nothing, so it advertises nothing`,
      );
    }
  });
});

describe('object ids', () => {
  it('are host-rooted even when the site lives in a subdirectory', () => {
    // Fedify serves the federation endpoints on the host, not under the base
    // path, so the id has to be built the same way or a peer dereferences a
    // URL that answers nothing.
    assert.equal(
      postObjectId('hello', 'https://example.com/blog'),
      'https://example.com/ap/posts/hello',
    );
    assert.equal(
      postObjectId('hello', 'https://example.com'),
      'https://example.com/ap/posts/hello',
    );
  });

  it('escape a slug that would otherwise change the shape of the path', () => {
    assert.equal(
      postObjectId('a b/c', 'https://example.com'),
      'https://example.com/ap/posts/a%20b%2Fc',
    );
  });

  it('name the announcing activity as a fragment of the object', () => {
    assert.equal(
      createActivityId('https://example.com/ap/posts/hello').href,
      'https://example.com/ap/posts/hello#create',
    );
  });
});

describe('a site in a subdirectory', () => {
  it('keeps the base path in the article url and off the object id', async () => {
    const dataDir = await temporaryDir('geekity-article-sub-data-');
    const contentDir = await temporaryDir('geekity-article-sub-content-');
    await writeTree(contentDir, HELLO);

    await writeSiteJson({
      contentDir,
      settings: {
        ...DEFAULT_SITE_SETTINGS,
        title: 'Geekity',
        tagline: '',
        baseUrl: 'https://example.com/blog',
        timezone: 'UTC',
        postsPerPage: 10,
        author: 'Ada',
        actorHandle: 'blog',
        actorType: 'Person',
        avatar: '',
      },
    });

    const instance = createCms({
      dataDir,
      contentDir,
      watch: false,
      baseUrl: 'https://example.com/blog',
    });
    started.push(instance);
    await instance.sync();

    const article = (await (
      await instance.app.request(
        new Request('https://example.com/ap/posts/hello', {
          headers: { accept: ACTIVITY_STREAMS },
        }),
      )
    ).json()) as Record<string, unknown>;

    assert.equal(article['id'], 'https://example.com/ap/posts/hello');
    assert.equal(article['url'], 'https://example.com/blog/2026/09/hello/');
  });
});
