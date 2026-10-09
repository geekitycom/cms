import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Hashtag } from '@fedify/vocab';

import { resolveNothing } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { SiteSettings } from '../admin/settings.ts';
import { renderMarkdown } from '../content/markdown.ts';
import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { postObject } from './article.ts';
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
  users: Parameters<typeof writeUsers>[1] = [
    { username: ADA, profile: { displayName: 'Ada Lovelace' } },
  ],
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
  writeUsers(dataDir, users);

  const instance = createCms({
    dataDir,
    contentDir,
    watch: false,
    baseUrl: BASE_URL,
    hostLookup: resolveNothing,
    ...config,
  });
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

  it('addresses an unlisted post to the followers, with Public in cc (TASK-227)', async () => {
    const instance = await site({
      'posts/2026-09-02-hushed.md': post('Hushed', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hushed/',
      }).replace('---\n\n', 'visibility: unlisted\n---\n\n'),
    });

    const response = await get(instance, '/2026/09/hushed/', ACTIVITY_STREAMS);

    assert.equal(response.status, 200, 'the object is served');
    const article = (await response.json()) as Record<string, unknown>;
    assert.equal(article['to'], `${BASE_URL}/author/${ADA}/followers/`);
    assert.equal(article['cc'], 'as:Public');
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

  it('names a tag in the site’s spelling and points at its lower-case archive (TASK-308)', async () => {
    const instance = await site({
      ...HELLO,
      'posts/2026-09-01-a.md': post('A', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/2026/09/a/',
        tags: ['Notes'],
      }),
      'posts/2026-08-01-b.md': post('B', {
        date: '2026-08-01T09:00:00Z',
        permalink: '/2026/08/b/',
        tags: ['Notes'],
      }),
    });

    const article = (await (
      await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;

    const list = article['tag'] as { name?: string; href?: string }[];
    assert.deepEqual(list[0], {
      type: 'Hashtag',
      name: '#Notes',
      href: `${BASE_URL}/tag/notes/`,
    });

    // What delivery builds from: a file just read, in its own casing.
    const indexed = instance.store.getByPermalink('/2026/09/hello/');
    assert.ok(indexed !== undefined);
    const context = instance.federation.createContext(new URL(BASE_URL), {
      admin: instance.admin,
      store: instance.store,
      config: instance.config,
      actorProfiles: instance.actorProfiles,
      cited: () => undefined,
    });
    const built = postObject(context, { ...indexed, tags: ['NOTES'] });
    let first: unknown;
    for await (const tag of built.getTags()) {
      first = tag;
      break;
    }
    assert.equal((first as Hashtag | undefined)?.name?.toString(), '#Notes');
    assert.equal((first as Hashtag | undefined)?.href?.href, `${BASE_URL}/tag/notes/`);
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

  it('serves nothing for a draft, a page or a URL naming nothing, and a Tombstone for a trashed post', async () => {
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

    for (const permalink of ['/2026/09/secret/', '/2026/09/never-written/']) {
      const response = await get(instance, permalink, ACTIVITY_STREAMS);
      assert.equal(response.status, 404, `${permalink} is not an object`);
    }
    const gone = await get(instance, '/2026/08/gone/', ACTIVITY_STREAMS);
    assert.equal(gone.status, 410);
    assert.equal(((await gone.json()) as Record<string, unknown>)['type'], 'Tombstone');
    assert.equal((await get(instance, '/about/', ACTIVITY_STREAMS)).status, 406);

    // The published post next to them still is, so the refusals are the filter
    // rather than a middleware that answers nothing.
    assert.equal((await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS)).status, 200);
  });

  it('serves nothing on a site with no accounts, which has no actor to attribute a post to (TASK-232)', async () => {
    const instance = await site(
      {
        ...HELLO,
        'posts/2026-09-02-hushed.md': post('Hushed', {
          date: '2026-09-02T09:00:00Z',
          permalink: '/2026/09/hushed/',
        }).replace('---\n\n', 'visibility: unlisted\n---\n\n'),
        'posts/2026-09-01-moved.md': post('Moved', {
          date: '2026-09-01T09:00:00Z',
          permalink: '/2026/09/moved/',
        }).replace('---\n\n', `activitypub:\n  id: ${BASE_URL}/?p=7\n---\n\n`),
      },
      {},
      {},
      [],
    );

    for (const pathname of ['/2026/09/hello/', '/2026/09/hushed/', '/?p=7']) {
      const response = await get(instance, pathname, ACTIVITY_STREAMS);
      assert.equal(response.status, 404, `${pathname} is not an object`);
    }
    assert.equal((await get(instance, '/2026/09/hello/')).status, 200, 'the page is still served');
  });

  it('attributes a post whose author names nobody to the first account (TASK-232)', async () => {
    const instance = await site({
      'posts/2026-09-02-orphan.md': post('Orphan', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/orphan/',
        author: 'grace',
      }),
    });

    const response = await get(instance, '/2026/09/orphan/', ACTIVITY_STREAMS);

    assert.equal(response.status, 200, 'the object is served');
    const article = (await response.json()) as Record<string, unknown>;
    assert.equal(article['attributedTo'], `${BASE_URL}/author/${ADA}/`);
  });
});

// Mastodon 4.5 reads `interactionPolicy.canQuote` by its plain keys and treats
// a post without one as quotable by nobody (FEP-044f).
describe('image attachments (TASK-141 AC #5)', () => {
  it('attaches each uploaded image with its alt text as the name, leaving decorative ones out', async () => {
    const instance = await site({
      '_data/media.json': JSON.stringify({ '2026/09/rule.png': { decorative: true } }),
      'posts/2026-09-02-pictures.md': post('Pictures', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/pictures/',
        body: [
          '![A dog asleep on a rug](/uploads/2026/09/dog.jpg)',
          '![](/uploads/2026/09/rule.png)',
          '![](/uploads/2026/09/undescribed.webp)',
          '![Somebody else’s](https://elsewhere.example/theirs.png)',
        ].join('\n\n'),
      }),
    });

    const article = (await (
      await get(instance, '/2026/09/pictures/', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;

    const raw = article['attachment'];
    const attachments = (Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[];
    assert.deepEqual(attachments, [
      {
        type: 'Image',
        mediaType: 'image/jpeg',
        url: `${BASE_URL}/uploads/2026/09/dog.jpg`,
        name: 'A dog asleep on a rug',
      },
      {
        type: 'Image',
        mediaType: 'image/webp',
        url: `${BASE_URL}/uploads/2026/09/undescribed.webp`,
      },
    ]);
  });

  it('attaches nothing to a post with no images', async () => {
    const instance = await site(HELLO);

    const article = (await (
      await get(instance, '/2026/09/hello/', ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;

    assert.equal(article['attachment'], undefined);
  });
});

describe('a recording as an attachment (TASK-213 AC #13)', () => {
  const RECORDING = [
    'enclosure:',
    '  url: /uploads/2026/09/episode-12.mp3',
    '  type: audio/mpeg',
    '  length: 23456789',
    '  alternates:',
    '    - url: https://cdn.example.com/episode-12.mp4',
    '      type: video/mp4',
  ];

  async function attachmentsOf(
    files: Record<string, string>,
    permalink: string,
  ): Promise<Record<string, unknown>[]> {
    const instance = await site(files);
    const object = (await (await get(instance, permalink, ACTIVITY_STREAMS)).json()) as Record<
      string,
      unknown
    >;
    const raw = object['attachment'];
    return (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[];
  }

  it('attaches the main file as Audio, named for the post, before the images', async () => {
    const attachments = await attachmentsOf(
      {
        'posts/2026-09-02-episode.md': rawPost(
          [
            'title: Episode twelve',
            "date: '2026-09-02T09:00:00Z'",
            'permalink: /2026/09/episode/',
            ...RECORDING,
          ],
          '![The studio](/uploads/2026/09/studio.jpg)',
        ),
      },
      '/2026/09/episode/',
    );

    assert.deepEqual(attachments, [
      {
        type: 'Audio',
        mediaType: 'audio/mpeg',
        url: `${BASE_URL}/uploads/2026/09/episode-12.mp3`,
        name: 'Episode twelve',
      },
      {
        type: 'Image',
        mediaType: 'image/jpeg',
        url: `${BASE_URL}/uploads/2026/09/studio.jpg`,
        name: 'The studio',
      },
    ]);
  });

  it('attaches a video as Video, and names a note by its words', async () => {
    const attachments = await attachmentsOf(
      {
        'posts/2026-09-02-clip.md': rawPost(
          [
            "date: '2026-09-02T09:00:00Z'",
            'permalink: /2026/09/clip/',
            'enclosure:',
            '  url: /uploads/2026/09/clip.webm',
            '  type: video/webm',
            '  length: 4096',
          ],
          'A quick clip of the garden.',
        ),
      },
      '/2026/09/clip/',
    );

    assert.deepEqual(attachments, [
      {
        type: 'Video',
        mediaType: 'video/webm',
        url: `${BASE_URL}/uploads/2026/09/clip.webm`,
        name: 'A quick clip of the garden.',
      },
    ]);
  });

  it('leaves a post without one as it was', async () => {
    const attachments = await attachmentsOf(
      {
        'posts/2026-09-02-half.md': rawPost(
          [
            'title: Half a recording',
            "date: '2026-09-02T09:00:00Z'",
            'permalink: /2026/09/half/',
            'enclosure:',
            '  url: /uploads/2026/09/half.mp3',
          ],
          'No length, so no enclosure.',
        ),
      },
      '/2026/09/half/',
    );

    assert.deepEqual(attachments, []);
  });
});

describe('photos as attachments (TASK-166 AC #4)', () => {
  async function objectAt(
    files: Record<string, string>,
    permalink: string,
  ): Promise<Record<string, unknown>> {
    const instance = await site(files);
    return (await (await get(instance, permalink, ACTIVITY_STREAMS)).json()) as Record<
      string,
      unknown
    >;
  }

  it('attaches each photo as an Image named by its alt text, the library’s when the post gives none', async () => {
    const object = await objectAt(
      {
        '_data/media.json': JSON.stringify({ '2026/09/dog.png': { alt: 'A dog asleep on a rug' } }),
        'posts/2026-09-02-beach.md': rawPost(
          [
            "date: '2026-09-02T09:00:00Z'",
            'permalink: /2026/09/beach/',
            'photo:',
            '  - url: /uploads/2026/09/beach.jpg',
            '    alt: Waves breaking at dusk',
            '  - url: /uploads/2026/09/dog.png',
            '  - url: https://cdn.example/cat.webp',
            '    alt: A cat on a wall',
          ],
          'At the beach. ![Waves breaking at dusk](/uploads/2026/09/beach.jpg)',
        ),
      },
      '/2026/09/beach/',
    );

    assert.equal(object['type'], 'Note', 'a photo post federates as a Note');
    assert.deepEqual(object['attachment'], [
      {
        type: 'Image',
        mediaType: 'image/jpeg',
        url: `${BASE_URL}/uploads/2026/09/beach.jpg`,
        name: 'Waves breaking at dusk',
      },
      {
        type: 'Image',
        mediaType: 'image/png',
        url: `${BASE_URL}/uploads/2026/09/dog.png`,
        name: 'A dog asleep on a rug',
      },
      { type: 'Image', url: 'https://cdn.example/cat.webp', name: 'A cat on a wall' },
    ]);
  });
});

describe('the quote policy (TASK-125 AC #1)', () => {
  const QUOTABLE = { canQuote: { automaticApproval: 'as:Public' } };

  it('lets anybody quote an Article and a Note, under the GoToSocial context', async () => {
    const instance = await site({
      ...HELLO,
      'posts/2026-09-02-quick.md': rawPost(
        ["date: '2026-09-02T09:00:00Z'", 'permalink: /2026/09/quick/'],
        'A quick thought.',
      ),
    });

    for (const [pathname, type] of [
      ['/2026/09/hello/', 'Article'],
      ['/2026/09/quick/', 'Note'],
    ] as const) {
      const object = await articleAt(instance, pathname);
      assert.equal(object['type'], type);
      assert.deepEqual(object['interactionPolicy'], QUOTABLE, `${pathname} is quotable`);
      assert.ok(
        (object['@context'] as unknown[]).includes('https://gotosocial.org/ns'),
        'the gts terms interactionPolicy, canQuote and automaticApproval are defined',
      );
    }
  });

  it('carries the same policy on the Create the outbox lists', async () => {
    const instance = await site(HELLO);

    const outbox = (await (
      await get(instance, `/author/${ADA}/outbox/`, ACTIVITY_STREAMS)
    ).json()) as Record<string, unknown>;
    const page = await fetchLink(instance, outbox['first']);
    const items = page['orderedItems'] as Record<string, unknown>[];
    const object = items[0]?.['object'] as Record<string, unknown>;
    assert.deepEqual(object['interactionPolicy'], QUOTABLE);
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

  it('is the first paragraph as escaped text when there is no description', async () => {
    const instance = await site({
      'posts/2026-09-02-hello.md': post('Hello', {
        date: '2026-09-02T09:00:00Z',
        permalink: '/2026/09/hello/',
        body: 'Fish & chips, *with* a [link](https://example.org/).\n\nA second paragraph.',
      }),
    });

    const article = await articleAt(instance, '/2026/09/hello/');

    assert.equal(article['summary'], 'Fish &amp; chips, with a link.');
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

  // `summary` is HTML by the ActivityStreams vocabulary, and text that is inert
  // on the page has to stay inert there (TASK-259).
  it('keeps escaped markup, a backslash-escaped tag, a code span and a description as text', async () => {
    const files: Record<string, string> = {};
    const bodies = {
      escaped: '&lt;img src=x onerror=alert(1)&gt;',
      backslash: '\\<img src=x onerror=alert(1)>',
      code: '`<img src=x onerror=alert(1)>`',
    };
    for (const [slug, body] of Object.entries(bodies)) {
      files[`posts/2026-09-02-${slug}.md`] = post('Hello', {
        date: '2026-09-02T09:00:00Z',
        permalink: `/2026/09/${slug}/`,
        body,
      });
    }
    files['posts/2026-09-02-described.md'] = post('Hello', {
      date: '2026-09-02T09:00:00Z',
      permalink: '/2026/09/described/',
      description: '<img src=x onerror=alert(1)>',
    });
    const instance = await site(files);

    for (const slug of [...Object.keys(bodies), 'described']) {
      const article = await articleAt(instance, `/2026/09/${slug}/`);
      assert.equal(article['summary'], '&lt;img src=x onerror=alert(1)&gt;', slug);
      assert.deepEqual(
        Object.values(article['summaryMap'] as Record<string, string>),
        ['&lt;img src=x onerror=alert(1)&gt;'],
        slug,
      );
    }
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

// A fediverse client filters and translates by the language a status names,
// which is the key of its contentMap (TASK-154).
describe('the post language (TASK-154 AC #4)', () => {
  const FRENCH = rawPost(
    [
      'title: Bonjour',
      "date: '2026-09-02T09:00:00Z'",
      'permalink: /2026/09/bonjour/',
      'lang: fr-CA',
    ],
    'Un *premier* billet.',
  );
  const NOTE = rawPost(
    ["date: '2026-09-02T09:00:00Z'", 'permalink: /2026/09/note/', 'lang: de'],
    'Nur ein Gedanke.',
  );
  const ENGLISH = rawPost(
    ['title: Hello', "date: '2026-09-02T09:00:00Z'", 'permalink: /2026/09/hello/'],
    'A *first* post.',
  );

  it('keys an Article’s contentMap and summaryMap by the language its front matter names', async () => {
    const instance = await site({ 'posts/2026-09-02-bonjour.md': FRENCH });

    const article = await articleAt(instance, '/2026/09/bonjour/');

    assert.equal(article['content'], '<p>Un <em>premier</em> billet.</p>\n');
    assert.deepEqual(article['contentMap'], { 'fr-ca': '<p>Un <em>premier</em> billet.</p>\n' });
    assert.equal(article['summary'], 'Un premier billet.');
    assert.deepEqual(article['summaryMap'], { 'fr-ca': 'Un premier billet.' });
  });

  it('keys a Note’s contentMap by its language and sends no summaryMap', async () => {
    const instance = await site({ 'posts/2026-09-02-note.md': NOTE });

    const note = await articleAt(instance, '/2026/09/note/');

    assert.equal(note['type'], 'Note');
    assert.deepEqual(note['contentMap'], { de: '<p>Nur ein Gedanke.</p>\n' });
    assert.equal('summaryMap' in note, false);
  });

  it('keys them by the site’s language for a post that names none', async () => {
    const instance = await site({ 'posts/2026-09-02-hello.md': ENGLISH }, { language: 'en-GB' });

    const article = await articleAt(instance, '/2026/09/hello/');

    assert.deepEqual(article['contentMap'], { 'en-gb': '<p>A <em>first</em> post.</p>\n' });
    assert.deepEqual(article['summaryMap'], { 'en-gb': 'A first post.' });
  });
});

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

  it('leaves out an unlisted post, whose object is still served (TASK-227)', async () => {
    const instance = await site({
      ...HELLO,
      'posts/2026-09-01-hushed.md': post('Hushed', {
        date: '2026-09-01T09:00:00Z',
        permalink: '/2026/09/hushed/',
      }).replace('---\n\n', 'visibility: unlisted\n---\n\n'),
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
      hostLookup: resolveNothing,
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

describe('a cited page in a note (TASK-262)', () => {
  const GIF = 'https://giphy.com/gifs/no-nope-tracy-morgan-spfi6nabVuq5y';
  const UNFETCHED = 'https://unread.example/2026/10/post/';
  const PICTURE = 'https://pics.example/cat.jpg';
  const CONTEXTS = {
    [GIF]: { url: GIF, name: 'No No No <GIF> & more' },
    [PICTURE]: {
      url: PICTURE,
      picture: { src: '/uploads/cited/cat.jpg', width: 10, height: 10, kind: 'photo' },
    },
  };

  async function noteAt(lines: string[], body = ''): Promise<Record<string, unknown>> {
    const instance = await site({
      '_data/replyContexts.json': JSON.stringify(CONTEXTS),
      'posts/2026-10-01-cited.md': rawPost(
        ["date: '2026-10-01T09:00:00Z'", 'permalink: /2026/10/cited/', ...lines],
        body,
      ),
    });
    return (await (await get(instance, '/2026/10/cited/', ACTIVITY_STREAMS)).json()) as Record<
      string,
      unknown
    >;
  }

  it('names a reposted page by its stored title, linking the cited URL', async () => {
    const note = await noteAt([`repost-of: ${GIF}`]);

    assert.equal(
      note['content'],
      `<p>Reposted <a href="${GIF}">No No No &lt;GIF&gt; &amp; more</a></p>\n`,
    );
  });

  it('says Liked and Bookmarked with the same name', async () => {
    const liked = await noteAt([`like-of: ${GIF}`], 'So good.');
    const bookmarked = await noteAt([`bookmark-of: ${GIF}`]);

    assert.match(
      String(liked['content']),
      new RegExp(`^<p>Liked <a href="${GIF}">No No No &lt;GIF&gt; &amp; more</a></p>`),
    );
    assert.match(
      String(bookmarked['content']),
      new RegExp(`^<p>Bookmarked <a href="${GIF}">No No No &lt;GIF&gt; &amp; more</a></p>`),
    );
  });

  it('uses the host form when nothing was fetched, never the bare URL', async () => {
    const page = await noteAt([`like-of: ${UNFETCHED}`]);
    const image = await noteAt([`like-of: ${PICTURE}`]);

    assert.equal(
      page['content'],
      `<p>Liked <a href="${UNFETCHED}">a page on unread.example</a></p>\n`,
    );
    assert.equal(
      image['content'],
      `<p>Liked <a href="${PICTURE}">an image from pics.example</a></p>\n`,
    );
  });

  it('keeps the anchor plain, so Mastodon still builds a card from it', async () => {
    const note = await noteAt([`repost-of: ${GIF}`]);
    const anchors = String(note['content']).match(/<a\b[^>]*>/g) ?? [];

    assert.deepEqual(anchors, [`<a href="${GIF}">`]);
    assert.equal('tag' in note, false, 'no Mention or Hashtag points at the cited page');
  });

  it('names a recording on a wordless like by the cited page', async () => {
    const note = await noteAt([
      `like-of: ${GIF}`,
      'enclosure:',
      '  url: /uploads/2026/10/clip.mp3',
      '  type: audio/mpeg',
      '  length: 4096',
    ]);

    assert.deepEqual(note['attachment'], {
      type: 'Audio',
      mediaType: 'audio/mpeg',
      url: `${BASE_URL}/uploads/2026/10/clip.mp3`,
      name: 'Liked No No No <GIF> & more',
    });
  });
});

describe('an RSVP (TASK-198)', () => {
  const EVENT = 'https://events.example/2026/10/indieweb-camp';

  it('is a Note replying to the event, its content opening with what its author will do', async () => {
    const instance = await site({
      '_data/replyContexts.json': JSON.stringify({ [EVENT]: { name: 'IndieWeb Camp' } }),
      'posts/2026-09-02-camp.md': rawPost(
        [
          "date: '2026-09-02T09:00:00Z'",
          'permalink: /2026/09/camp/',
          `in-reply-to: ${EVENT}`,
          'rsvp: maybe',
        ],
        'If the trains run.',
      ),
    });

    const note = await articleAt(instance, '/2026/09/camp/');

    assert.equal(note['type'], 'Note');
    assert.equal(note['inReplyTo'], EVENT);
    assert.equal(
      note['content'],
      `<p>Maybe going to <a href="${EVENT}">IndieWeb Camp</a></p>\n${renderMarkdown('If the trains run.')}`,
    );
  });
});

describe('an event (TASK-200 AC #1)', () => {
  it('is an Event with its name, its times, its place and its description', async () => {
    const instance = await site({
      'posts/2026-09-02-camp.md': rawPost(
        [
          'title: IndieWeb Camp',
          "date: '2026-09-02T09:00:00Z'",
          'permalink: /2026/09/camp/',
          "start: '2026-10-10T14:00:00Z'",
          "end: '2026-10-10T22:00:00Z'",
          'location: Chicago Public Library',
        ],
        'Two days of building our own websites.',
      ),
    });

    const event = await articleAt(instance, '/2026/09/camp/');

    assert.equal(event['type'], 'Event');
    assert.equal(event['name'], 'IndieWeb Camp');
    assert.equal(event['startTime'], '2026-10-10T14:00:00Z');
    assert.equal(event['endTime'], '2026-10-10T22:00:00Z');
    assert.deepEqual(event['location'], { type: 'Place', name: 'Chicago Public Library' });
    assert.equal(event['content'], renderMarkdown('Two days of building our own websites.'));
    assert.equal(event['summary'], 'Two days of building our own websites.');
    assert.equal(event['url'], 'https://blog.example/2026/09/camp/');
  });

  it('names where to join an online event by its address', async () => {
    const instance = await site({
      'posts/2026-09-02-club.md': rawPost(
        [
          'title: Homebrew Website Club',
          "date: '2026-09-02T09:00:00Z'",
          'permalink: /2026/09/club/',
          "start: '2026-10-14T00:30:00Z'",
          'location: https://meet.example/hwc',
        ],
        'Bring a site.',
      ),
    });

    const event = await articleAt(instance, '/2026/09/club/');

    assert.equal(event['type'], 'Event');
    assert.equal(event['endTime'], undefined);
    assert.deepEqual(event['location'], {
      type: 'Place',
      name: 'https://meet.example/hwc',
      url: 'https://meet.example/hwc',
    });
  });
});
