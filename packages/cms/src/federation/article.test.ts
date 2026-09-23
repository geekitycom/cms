import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { writeUsers } from '../admin/__testing__/users.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { SiteSettings } from '../admin/settings.ts';
import { renderMarkdown } from '../content/markdown.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { OUTBOX_PAGE_SIZE } from './federation.ts';
import { createActivityId } from './paths.ts';

/** The origin every request in this file is sent to; Fedify checks it. */
const BASE_URL = 'https://blog.example';

/** The one account these sites have, and so the actor every post is announced by. */
const ADA = 'ada';

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
      author: ADA,
      ...settings,
    },
  });
  // decision-14: a post is announced by the actor of its author, so the site
  // needs an account before it can federate anything at all.
  writeUsers(dataDir, [{ username: ADA, profile: { displayName: 'Ada Lovelace' } }]);

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
    author?: string;
    description?: string;
  },
): string {
  const lines = [
    `title: ${JSON.stringify(title)}`,
    `date: '${options.date}'`,
    `permalink: ${options.permalink}`,
    // decision-14 attributes a post to a user, and the outbox is that user's
    // archive as activities: a post naming nobody is on nobody's.
    `author: ${options.author ?? ADA}`,
  ];
  if (options.updated !== undefined) lines.push(`updated: '${options.updated}'`);
  if (options.tags !== undefined) {
    lines.push('tags:', ...options.tags.map((tag) => `  - ${tag}`));
  }
  if (options.categories !== undefined) {
    lines.push('categories:', ...options.categories.map((category) => `  - ${category}`));
  }
  if (options.draft === true) lines.push('draft: true');
  if (options.description !== undefined) {
    lines.push(`description: ${JSON.stringify(options.description)}`);
  }

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

    const response = await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS);

    assert.equal(response.status, 200);
    const article = (await response.json()) as Record<string, unknown>;
    assert.equal(article['type'], 'Article');
    assert.equal(article['id'], `${BASE_URL}/2026/09/hello/`);
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
      await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;

    // One URL for both audiences: the id and the url are the permalink.
    assert.equal(article['url'], `${BASE_URL}/2026/09/hello/`);
    assert.equal(article['published'], '2026-09-02T09:00:00Z');
    assert.equal(article['updated'], '2026-09-03T10:30:00Z');
    assert.equal(article['attributedTo'], `${BASE_URL}/author/${ADA}/`);
    // `as:Public` is how the ActivityStreams context compacts the public
    // collection; it is the form Mastodon and friends both send and expect.
    assert.equal(article['to'], 'as:Public');
    assert.equal(article['cc'], `${BASE_URL}/author/${ADA}/followers/`);
  });

  it('publishes one Hashtag per tag and per category, pointing at their archives', async () => {
    const instance = await site(HELLO);

    const article = (await (
      await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS)
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
      await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;

    const tags = article['tag'];
    const list = (Array.isArray(tags) ? tags : [tags]) as { href?: string }[];
    assert.deepEqual(
      list.map((tag) => tag.href),
      [`${BASE_URL}/topics/notes/`, `${BASE_URL}/topics/meta/`, `${BASE_URL}/filed/general/`],
    );

    const outbox = (await (
      await get(instance, `/author/${ADA}/outbox/`, ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    const page = await fetchLink(instance, outbox['first']);
    assert.ok(
      JSON.stringify(page).includes(`${BASE_URL}/topics/notes/`),
      'the outbox carries the same archive URLs',
    );
  });

  it('serves nothing for a draft, a trashed post, a page or a URL naming nothing', async () => {
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

    // A draft, a trashed post and a URL naming nothing have no public page at
    // all, so they 404 exactly as they do for a browser. A page exists but
    // federates nothing, so it falls through to the negotiator and earns the
    // 406 doc-3 specifies.
    for (const permalink of ['/2026/09/secret/', '/2026/08/gone/', '/2026/09/never-written/']) {
      const response = await get(instance, permalink, ACTIVITY_STREAMS);
      assert.equal(response.status, 404, `${permalink} is not an object`);
    }
    assert.equal((await get(instance, '/about/', ACTIVITY_STREAMS)).status, 406);

    // The published post next to them still is, so the refusals are the filter
    // rather than a middleware that answers nothing.
    assert.equal((await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS)).status, 200);
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

/** The Article served at a post's permalink, as a peer receives it. */
async function articleAt(instance: Cms, pathname: string): Promise<Record<string, unknown>> {
  const response = await get(instance, pathname, ACTIVITY_STREAMS);
  assert.equal(response.status, 200);
  return (await response.json()) as Record<string, unknown>;
}

// Mastodon builds an Article's status from `name`, `summary` and the link and
// discards `content`, so without a summary a post shows as a bare title.
describe('the post summary', () => {
  it('is the description the author wrote, when the post has one', async () => {
    const instance = await site({
      'posts/2026-09-02-hello.md': post('Hello', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hello/',
        description: 'What this post is about, in a sentence.',
        body: 'A *first* post, with a [link](https://example.org/).',
      }),
    });

    const article = await articleAt(instance, '/2026/09/hello/');

    assert.equal(article['summary'], 'What this post is about, in a sentence.');
  });

  it('is the plain text of the first paragraph when there is no description', async () => {
    const instance = await site({
      'posts/2026-09-02-hello.md': post('Hello', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hello/',
        body: 'Fish & chips, *with* a [link](https://example.org/).\n\nA second paragraph.',
      }),
    });

    const article = await articleAt(instance, '/2026/09/hello/');

    assert.equal(article['summary'], 'Fish & chips, with a link.');
  });

  it('cuts a long first paragraph where the feeds do, with no Read more link', async () => {
    const words = Array.from({ length: 80 }, (_, index) => `word${index}`);
    const instance = await site({
      'posts/2026-09-02-hello.md': post('Hello', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hello/',
        body: words.join(' '),
      }),
    });

    const article = await articleAt(instance, '/2026/09/hello/');

    assert.equal(article['summary'], `${words.slice(0, 55).join(' ')} …`);
  });

  it('is left out, not empty, for a post with nothing to summarise', async () => {
    const instance = await site({
      'posts/2026-09-02-empty.md': post('Empty', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/empty/',
        body: '',
      }),
      'posts/2026-09-03-photo.md': post('Photo', {
        date: '2026-09-03T09:00:00Z',
        permalink: '/2026/09/photo/',
        body: '![A heron on the river](https://example.org/heron.jpg)',
      }),
    });

    for (const pathname of ['/2026/09/empty/', '/2026/09/photo/']) {
      const article = await articleAt(instance, pathname);
      assert.equal('summary' in article, false, `${pathname} has no summary property`);
    }
  });
});

/** A post file written out whole, for the shapes {@link post} cannot spell. */
function rawPost(frontMatter: string[], body: string): string {
  return `---\n${[...frontMatter, `author: ${ADA}`].join('\n')}\n---\n\n${body}\n`;
}

// Post Type Discovery decides the object type, and Mastodon reads the two
// differently: a Note's `content` is the status and its `summary` a content
// warning, an Article's `content` is dropped for `name` and `summary`.
describe('the object type', () => {
  const NOTE_BODY = 'Just a *quick* thought about [links](https://example.org/).';

  it('is a Note for an untitled post, carrying everything in content', async () => {
    const instance = await site({
      'posts/2026-09-02-quick.md': rawPost(
        ["date: '2026-09-02T09:00:00Z'", 'permalink: /2026/09/quick/'],
        NOTE_BODY,
      ),
    });

    const note = await articleAt(instance, '/2026/09/quick/');

    assert.equal(note['type'], 'Note');
    assert.equal(note['content'], renderMarkdown(NOTE_BODY));
    assert.equal('summary' in note, false, 'no excerpt Mastodon would show as a content warning');
    assert.equal('name' in note, false, 'no name, which Mastodon never reads on a Note');
  });

  it('is a Note for a post whose text begins with its title', async () => {
    const instance = await site({
      'posts/2026-09-02-quick.md': post('Just a quick thought', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/quick/',
        description: 'A teaser that must not become a content warning.',
        body: NOTE_BODY,
      }),
    });

    const note = await articleAt(instance, '/2026/09/quick/');

    assert.equal(note['type'], 'Note');
    assert.equal(note['content'], renderMarkdown(NOTE_BODY), 'the title is already the text');
    assert.equal('summary' in note, false);
  });

  it('is an Article for a titled post, with its name and summary', async () => {
    const instance = await site(HELLO);

    const article = await articleAt(instance, '/2026/09/hello/');

    assert.equal(article['type'], 'Article');
    assert.equal(article['name'], 'Hello, World!');
    assert.equal(article['summary'], 'A first post, with a link.');
  });

  it('follows an activitypub.type of Note over the derived Article', async () => {
    const instance = await site({
      'posts/2026-09-02-hello.md': rawPost(
        [
          'title: Hello & welcome',
          "date: '2026-09-02T09:00:00Z'",
          'permalink: /2026/09/hello/',
          'activitypub:',
          '  type: Note',
        ],
        HELLO_BODY,
      ),
    });

    const note = await articleAt(instance, '/2026/09/hello/');

    assert.equal(note['type'], 'Note');
    // Mastodon never reads a Note's name, so a title the text does not
    // already start with goes into the content or is lost.
    assert.equal(note['content'], `<p>Hello &amp; welcome</p>\n${renderMarkdown(HELLO_BODY)}`);
    assert.equal('summary' in note, false);
    assert.equal('name' in note, false);
  });

  it('follows an activitypub.type of Article over the derived Note', async () => {
    const instance = await site({
      'posts/2026-09-02-quick.md': rawPost(
        [
          "date: '2026-09-02T09:00:00Z'",
          'permalink: /2026/09/quick/',
          'activitypub:',
          '  type: Article',
        ],
        NOTE_BODY,
      ),
    });

    const article = await articleAt(instance, '/2026/09/quick/');

    assert.equal(article['type'], 'Article');
    assert.equal(article['summary'], 'Just a quick thought about links.');
  });

  it('falls back to the derived type and warns for an activitypub.type it does not know', async (t) => {
    const warn = t.mock.method(console, 'warn', () => undefined);
    const instance = await site({
      'posts/2026-09-02-hello.md': rawPost(
        [
          'title: Hello',
          "date: '2026-09-02T09:00:00Z'",
          'permalink: /2026/09/hello/',
          'activitypub:',
          '  type: Photo',
        ],
        HELLO_BODY,
      ),
    });

    const response = await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS);

    assert.equal(response.status, 200, 'the request is not failed');
    const article = (await response.json()) as Record<string, unknown>;
    assert.equal(article['type'], 'Article');
    const messages = warn.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(
      messages.some(
        (message) =>
          message.includes('posts/2026-09-02-hello.md') &&
          message.includes('"Photo"') &&
          message.includes('Article'),
      ),
      `a warning names the file, the value and the type used instead: ${JSON.stringify(messages)}`,
    );
  });

  it('names the same type in the outbox Create as at the permalink', async () => {
    const instance = await site({
      'posts/2026-09-02-quick.md': rawPost(
        ["date: '2026-09-02T09:00:00Z'", 'permalink: /2026/09/quick/'],
        NOTE_BODY,
      ),
    });

    const outbox = (await (
      await get(instance, `/author/${ADA}/outbox/`, ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    const page = await fetchLink(instance, outbox['first']);

    const activity = (page['orderedItems'] as Record<string, unknown>[])[0];
    assert.equal((activity?.['object'] as Record<string, unknown>)['type'], 'Note');
  });
});

describe('a reply', () => {
  const TARGET = 'https://them.example/2026/09/their-post/';

  it('is a Note naming its target in inReplyTo, with no summary', async () => {
    const instance = await site({
      'posts/2026-09-02-agreed.md': rawPost(
        ["date: '2026-09-02T09:00:00Z'", 'permalink: /2026/09/agreed/', `in-reply-to: ${TARGET}`],
        'Completely agree with this.',
      ),
    });

    const note = await articleAt(instance, '/2026/09/agreed/');

    assert.equal(note['type'], 'Note');
    assert.equal(note['inReplyTo'], TARGET);
    assert.equal(note['content'], renderMarkdown('Completely agree with this.'));
    assert.equal('summary' in note, false);
  });

  it('is a Note with its title at the top of its content when it has one (decision-18)', async () => {
    const instance = await site({
      'posts/2026-09-02-agreed.md': rawPost(
        [
          'title: On their post',
          "date: '2026-09-02T09:00:00Z'",
          'permalink: /2026/09/agreed/',
          `in-reply-to: ${TARGET}`,
        ],
        'Completely agree with this.',
      ),
    });

    const note = await articleAt(instance, '/2026/09/agreed/');

    assert.equal(note['type'], 'Note');
    assert.equal(note['inReplyTo'], TARGET);
    assert.equal(
      note['content'],
      `<p>On their post</p>\n${renderMarkdown('Completely agree with this.')}`,
      'Mastodon never reads a Note name, so the title travels in the content',
    );
  });

  it('keeps inReplyTo when activitypub.type makes it an Article', async () => {
    const instance = await site({
      'posts/2026-09-02-agreed.md': rawPost(
        [
          'title: On their post',
          "date: '2026-09-02T09:00:00Z'",
          'permalink: /2026/09/agreed/',
          `in-reply-to: ${TARGET}`,
          'activitypub:',
          '  type: Article',
        ],
        'Completely agree with this.',
      ),
    });

    const article = await articleAt(instance, '/2026/09/agreed/');

    assert.equal(article['type'], 'Article');
    assert.equal(article['inReplyTo'], TARGET);
  });

  it('sends no inReplyTo for an in-reply-to that is not a URL', async (t) => {
    t.mock.method(console, 'warn', () => undefined);
    const instance = await site({
      'posts/2026-09-02-agreed.md': rawPost(
        ["date: '2026-09-02T09:00:00Z'", 'permalink: /2026/09/agreed/', 'in-reply-to: their post'],
        'Completely agree with this.',
      ),
    });

    const note = await articleAt(instance, '/2026/09/agreed/');

    assert.equal('inReplyTo' in note, false);
  });
});

describe('the outbox', () => {
  it('counts the published posts and pages rather than listing them all at once', async () => {
    const instance = await site(archive(OUTBOX_PAGE_SIZE + 5));

    const outbox = (await (
      await get(instance, `/author/${ADA}/outbox/`, ACTIVITY_STREAMS)
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
      await get(instance, `/author/${ADA}/outbox/`, ACTIVITY_STREAMS)
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
      await get(instance, `/author/${ADA}/outbox/`, ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    const page = await fetchLink(instance, outbox['first']);

    const items = page['orderedItems'] as Record<string, unknown>[];
    assert.equal(items.length, 1);
    const activity = items[0] as Record<string, unknown>;
    assert.equal(activity['type'], 'Create');
    assert.equal(activity['id'], `${BASE_URL}/2026/09/hello/#create`);
    assert.equal(activity['actor'], `${BASE_URL}/author/${ADA}/`);
    assert.equal(activity['to'], 'as:Public');

    const object = activity['object'] as Record<string, unknown>;
    assert.equal(object['type'], 'Article');
    assert.equal(object['id'], `${BASE_URL}/2026/09/hello/`);
    assert.equal(object['name'], 'Hello, World!');
  });

  it('leaves out drafts, trash and pages, exactly as the permalink does', async () => {
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
      await get(instance, `/author/${ADA}/outbox/`, ACTIVITY_STREAMS)
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

  it('leaves out a post whose date has not arrived, and 404s its permalink', async () => {
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
      await get(instance, `/author/${ADA}/outbox/`, ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    assert.equal(before['totalItems'], 1);
    assert.equal((await get(instance, '/2026/09/tomorrow/', ACTIVITY_STREAMS)).status, 404);

    now = new Date('2026-09-04T09:00:00Z');

    const after = (await (
      await get(instance, `/author/${ADA}/outbox/`, ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    assert.equal(after['totalItems'], 2);
    assert.equal((await get(instance, '/2026/09/tomorrow/', ACTIVITY_STREAMS)).status, 200);
  });
});

describe('a post permalink asked for as ActivityStreams', () => {
  it('answers with an Article whose id is the permalink (decision-13)', async () => {
    const instance = await site(HELLO);

    const response = await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS);

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /application\/(activity\+json|ld\+json)/,
    );
    const article = (await response.json()) as Record<string, unknown>;
    assert.equal(article['type'], 'Article');
    // One URL per post: the id a peer files the object under is the URL a
    // reader visits, negotiated by `Accept`.
    assert.equal(article['id'], `${BASE_URL}/2026/09/hello/`);
    assert.equal(article['url'], `${BASE_URL}/2026/09/hello/`);
    assert.equal(article['content'], renderMarkdown(HELLO_BODY));
  });

  it('no longer answers at the old /ap/posts/{slug} object URL', async () => {
    const instance = await site(HELLO);

    assert.equal((await get(instance, '/ap/posts/hello', ACTIVITY_STREAMS)).status, 404);
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
      `${BASE_URL}/2026/09/hello/`,
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

describe('a post whose file already names an activitypub.id', () => {
  /** The post as WordPress left it: announced long ago under `?p=813`. */
  const MIGRATED = {
    'posts/2011-06-06-old-news.md': [
      '---',
      'title: Old news',
      "date: '2011-06-06T09:00:00Z'",
      'permalink: /2011/06/old-news/',
      'activitypub:',
      "  id: 'https://blog.example/?p=813'",
      "  published: '2011-06-06T09:00:00Z'",
      '---',
      '',
      'Body.',
      '',
    ].join('\n'),
  };

  it('keeps the stored id as the object id at its permalink', async () => {
    const instance = await site(MIGRATED);

    const article = (await (
      await get(instance, '/2011/06/old-news/', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;

    // The id its followers, its replies and its RSS subscribers already hold.
    assert.equal(article['id'], 'https://blog.example/?p=813');
    assert.equal(article['url'], `${BASE_URL}/2011/06/old-news/`);
  });

  it('serves the Article at the stored id, query string and all', async () => {
    const instance = await site(MIGRATED);

    const response = await get(instance, '/?p=813', ACTIVITY_STREAMS);

    assert.equal(response.status, 200);
    const article = (await response.json()) as Record<string, unknown>;
    assert.equal(article['type'], 'Article');
    assert.equal(article['id'], 'https://blog.example/?p=813');
    assert.equal(article['name'], 'Old news');
  });

  it('redirects a browser from the stored id to the permalink', async () => {
    const instance = await site(MIGRATED);

    const response = await get(instance, '/?p=813', 'text/html');

    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/2011/06/old-news/');
  });

  it('serves a path-shaped stored id the same way', async () => {
    const instance = await site({
      'posts/2011-06-06-old-news.md': [
        '---',
        'title: Old news',
        "date: '2011-06-06T09:00:00Z'",
        'permalink: /2011/06/old-news/',
        'activitypub:',
        "  id: 'https://blog.example/ap/posts/old-news'",
        "  published: '2011-06-06T09:00:00Z'",
        '---',
        '',
        'Body.',
        '',
      ].join('\n'),
    });

    const object = await get(instance, '/ap/posts/old-news', ACTIVITY_STREAMS);
    assert.equal(object.status, 200);
    assert.equal(
      ((await object.json()) as Record<string, unknown>)['id'],
      'https://blog.example/ap/posts/old-news',
    );

    const browser = await get(instance, '/ap/posts/old-news', 'text/html');
    assert.equal(browser.status, 301);
    assert.equal(browser.headers.get('location'), '/2011/06/old-news/');
  });

  it('leaves the home page alone when no query string names a post', async () => {
    const instance = await site(MIGRATED);

    assert.equal((await get(instance, '/', 'text/html')).status, 200);
    assert.equal((await get(instance, '/?p=999', 'text/html')).status, 200);
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
        `<link rel="alternate" type="application/activity+json" href="${BASE_URL}/2026/09/hello/">`,
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
  it('name the announcing activity as a fragment of the object', () => {
    assert.equal(
      createActivityId('https://example.com/2026/09/hello/').href,
      'https://example.com/2026/09/hello/#create',
    );
  });
});

describe('a site in a subdirectory', () => {
  it('keeps the base path in the article url and in the object id', async () => {
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
        author: ADA,
      },
    });
    writeUsers(dataDir, [{ username: ADA }]);

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
        new Request('https://example.com/2026/09/hello/', {
          headers: { accept: ACTIVITY_STREAMS },
        }),
      )
    ).json()) as Record<string, unknown>;

    // decision-13: the object is served by the permalink rather than by a
    // host-rooted dispatcher, so a site in a subdirectory keeps that directory
    // in its ids as well as in its links.
    assert.equal(article['id'], 'https://example.com/blog/2026/09/hello/');
    assert.equal(article['url'], 'https://example.com/blog/2026/09/hello/');
  });
});
