import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import type { Document } from './document.ts';
import { DuplicatePermalinkError, openContentStore } from './store.ts';
import type { ContentStore } from './store.ts';

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A data dir of this test's own, cleaned up when the file finishes. */
async function dataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-store-'));
  temporaryDirs.push(dir);
  return dir;
}

/** A store on a fresh data dir, closed when the test file finishes. */
async function store(): Promise<ContentStore> {
  const opened = openContentStore({ dataDir: await dataDir() });
  openStores.push(opened);
  return opened;
}

const openStores: ContentStore[] = [];

after(() => {
  for (const opened of openStores) opened.close();
});

/** The smallest post the store will accept, with overrides on top. */
function post(overrides: Partial<Document> = {}): Document {
  return {
    type: 'post',
    path: 'posts/2026-09-02-hello-world.md',
    slug: 'hello-world',
    permalink: '/2026/09/hello-world/',
    title: 'Hello, World!',
    date: '2026-09-02T09:00:00-05:00',
    tags: ['introductions'],
    categories: ['general'],
    draft: false,
    extra: {},
    body: 'Hello.',
    html: '<p>Hello.</p>\n',
    hash: 'a'.repeat(64),
    ...overrides,
  };
}

describe('openContentStore', () => {
  it('creates the database under a data dir that does not exist yet', async () => {
    const dir = path.join(await dataDir(), 'nested', 'data');

    const store = openContentStore({ dataDir: dir });

    try {
      assert.equal(store.file, path.join(dir, 'geekity.db'));
      assert.ok(existsSync(store.file));
    } finally {
      store.close();
    }
  });
});

describe('upsert and get', () => {
  it('returns every field of a document it stored', async () => {
    const index = await store();
    const document = post();

    index.upsert(document);

    assert.deepEqual(index.getByPermalink('/2026/09/hello-world/'), document);
  });

  it('keeps optional fields absent rather than undefined, so documents compare equal', async () => {
    const index = await store();
    const document = post();

    index.upsert(document);

    const stored = index.getByPermalink(document.permalink);
    assert.ok(stored !== undefined);
    assert.deepEqual(Object.keys(stored).sort(), Object.keys(document).sort());
    assert.equal('updated' in stored, false);
    assert.equal('description' in stored, false);
    assert.equal('author' in stored, false);
    assert.equal('activitypub' in stored, false);
  });

  it('round-trips a document that fills in every optional field', async () => {
    const index = await store();
    const document = post({
      updated: '2026-09-03T12:00:00Z',
      description: 'The first post.',
      author: 'andrew',
      activitypub: {
        id: 'https://geekity.example/2026/09/hello-world/',
        published: '2026-09-02T14:00:00Z',
      },
      tags: ['introductions', 'eleventy'],
      extra: { layout: 'post.njk', hero: { src: '/img/a.png', alt: 'A' }, featured: true, rank: 3 },
    });

    index.upsert(document);

    assert.deepEqual(index.getByPermalink(document.permalink), document);
  });

  it('replaces the previous row for a path, tags included', async () => {
    const index = await store();
    index.upsert(post({ tags: ['introductions', 'eleventy'] }));

    index.upsert(post({ title: 'Hello Again', tags: ['eleventy'], draft: true }));

    const stored = index.getByPermalink('/2026/09/hello-world/');
    assert.equal(stored?.title, 'Hello Again');
    assert.deepEqual(stored?.tags, ['eleventy']);
    assert.equal(stored?.draft, true);
    assert.equal(index.counts().total, 1);
  });

  it('looks a document up by its path and by its slug', async () => {
    const index = await store();
    const document = post();

    index.upsert(document);

    assert.deepEqual(index.getByPath(document.path), document);
    assert.deepEqual(index.getBySlug('hello-world'), document);
  });

  it('answers undefined for a permalink, path or slug it does not hold', async () => {
    const index = await store();

    assert.equal(index.getByPermalink('/nope/'), undefined);
    assert.equal(index.getByPath('posts/nope.md'), undefined);
    assert.equal(index.getBySlug('nope'), undefined);
  });

  it('removes a document and reports whether there was one', async () => {
    const index = await store();
    index.upsert(post());

    assert.equal(index.remove('posts/2026-09-02-hello-world.md'), true);
    assert.equal(index.remove('posts/2026-09-02-hello-world.md'), false);
    assert.equal(index.getByPermalink('/2026/09/hello-world/'), undefined);
    assert.deepEqual(index.listAll(), []);
  });
});

describe('migrations', () => {
  it('are idempotent: reopening the same data dir keeps the rows and the schema', async () => {
    const dir = await dataDir();

    const first = openContentStore({ dataDir: dir });
    first.upsert(post());
    first.close();

    const second = openContentStore({ dataDir: dir });
    try {
      assert.deepEqual(second.getByPermalink('/2026/09/hello-world/'), post());
      assert.deepEqual(appliedMigrations(second.file), [1, 2, 3, 4]);
    } finally {
      second.close();
    }

    const third = openContentStore({ dataDir: dir });
    try {
      assert.deepEqual(appliedMigrations(third.file), [1, 2, 3, 4]);
      assert.equal(third.counts().total, 1);
    } finally {
      third.close();
    }
  });

  it('empties an index written before categories existed, so the next scan re-reads it', async () => {
    const dir = await dataDir();

    // A version 1 database: the documents table, with a row in it, and nothing
    // that knows about categories.
    const legacy = new DatabaseSync(path.join(dir, 'geekity.db'));
    legacy.exec(`
      CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      ${MIGRATION_ONE}
      INSERT INTO migrations (version, applied_at) VALUES (1, '2026-01-01T00:00:00.000Z');
      INSERT INTO documents (
        path, type, slug, permalink, title, date, date_sort, updated, draft, trashed,
        description, author, activitypub, extra, body, html, hash
      ) VALUES (
        'posts/old.md', 'post', 'old', '/old/', 'Old', NULL, NULL, NULL, 0, 0,
        NULL, NULL, NULL, '{}', 'Old.', '<p>Old.</p>', 'b'
      );
    `);
    legacy.close();

    const upgraded = openContentStore({ dataDir: dir });
    try {
      assert.deepEqual(appliedMigrations(upgraded.file), [1, 2, 3, 4]);
      // The hash of a file with no categories has not changed, so a sync would
      // leave a surviving row alone and never learn its categories. The row
      // has to go; the file it was derived from is still on disk.
      assert.equal(upgraded.counts().total, 0);

      upgraded.upsert(post({ path: 'posts/old.md', permalink: '/old/', slug: 'old' }));
      assert.deepEqual(upgraded.getByPath('posts/old.md')?.categories, ['general']);
    } finally {
      upgraded.close();
    }
  });

  it('empties an index whose HTML predates the focusable code block (TASK-86)', async () => {
    const dir = await dataDir();

    // A version 2 database holding a row rendered before `<pre>` carried a
    // tabindex. Its file hashes the same as it always did, so nothing but an
    // empty index makes the next scan render it again.
    const before = openContentStore({ dataDir: dir });
    before.upsert(post({ html: '<pre><code class="language-js">const x = 1;\n</code></pre>\n' }));
    before.close();

    const legacy = new DatabaseSync(path.join(dir, 'geekity.db'));
    legacy.exec('DELETE FROM migrations WHERE version = 3');
    legacy.close();

    const upgraded = openContentStore({ dataDir: dir });
    try {
      assert.deepEqual(appliedMigrations(upgraded.file), [1, 2, 3, 4]);
      assert.equal(upgraded.counts().total, 0, 'the stale HTML survived the upgrade');
    } finally {
      upgraded.close();
    }
  });
});

/** The version 1 schema, as the package shipped it, for the upgrade test above. */
const MIGRATION_ONE = `
  CREATE TABLE documents (
    path         TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    slug         TEXT NOT NULL,
    permalink    TEXT NOT NULL,
    title        TEXT NOT NULL,
    date         TEXT,
    date_sort    TEXT,
    updated      TEXT,
    draft        INTEGER NOT NULL,
    trashed      INTEGER NOT NULL,
    description  TEXT,
    author       TEXT,
    activitypub  TEXT,
    extra        TEXT NOT NULL,
    body         TEXT NOT NULL,
    html         TEXT NOT NULL,
    hash         TEXT NOT NULL
  );

  CREATE UNIQUE INDEX documents_permalink ON documents (permalink);
  CREATE INDEX documents_slug ON documents (slug);
  CREATE INDEX documents_listing ON documents (type, draft, trashed, date_sort DESC);

  CREATE TABLE document_tags (
    path     TEXT NOT NULL REFERENCES documents (path) ON DELETE CASCADE,
    tag      TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (path, tag)
  );

  CREATE INDEX document_tags_tag ON document_tags (tag);
`;

/** Three published posts, newest last in this list, plus the odd ones out. */
function corpus(): Document[] {
  return [
    post({
      path: 'posts/2026-01-01-oldest.md',
      slug: 'oldest',
      permalink: '/2026/01/oldest/',
      title: 'Oldest',
      date: '2026-01-01T00:00:00Z',
      tags: ['eleventy'],
      categories: ['general'],
    }),
    post({
      path: 'posts/2026-06-01-middle.md',
      slug: 'middle',
      permalink: '/2026/06/middle/',
      title: 'Middle',
      // Written as an offset, and later than the UTC noon below once normalised.
      date: '2026-06-01T09:00:00-05:00',
      tags: ['eleventy', 'sqlite'],
      categories: ['general', 'engineering'],
    }),
    post({
      path: 'posts/2026-06-01-earlier-same-day.md',
      slug: 'earlier-same-day',
      permalink: '/2026/06/earlier-same-day/',
      title: 'Earlier Same Day',
      date: '2026-06-01T12:00:00Z',
      tags: ['sqlite'],
      categories: ['engineering'],
    }),
    post({
      path: 'posts/2026-09-01-newest.md',
      slug: 'newest',
      permalink: '/2026/09/newest/',
      title: 'Newest',
      date: '2026-09-01T00:00:00Z',
      tags: ['eleventy'],
      categories: ['general'],
    }),
    post({
      path: 'posts/2026-09-02-a-draft.md',
      slug: 'a-draft',
      permalink: '/2026/09/a-draft/',
      title: 'A Draft',
      date: '2026-09-02T00:00:00Z',
      draft: true,
      tags: ['eleventy'],
      categories: ['general'],
    }),
    post({
      path: '_trash/posts/2026-09-03-thrown-away.md',
      slug: 'thrown-away',
      permalink: '/2026/09/thrown-away/',
      title: 'Thrown Away',
      date: '2026-09-03T00:00:00Z',
      tags: ['eleventy'],
      categories: ['general'],
    }),
    post({
      type: 'page',
      path: 'pages/about.md',
      slug: 'about',
      permalink: '/about/',
      title: 'About',
      date: undefined,
      tags: ['eleventy'],
      categories: ['general'],
    }),
  ];
}

async function populated(): Promise<ContentStore> {
  const index = await store();
  index.upsertAll(corpus());
  return index;
}

function titles(documents: Document[]): string[] {
  return documents.map((document) => document.title);
}

describe('listPosts', () => {
  it('returns published posts newest first, comparing dates as instants', async () => {
    const index = await populated();

    assert.deepEqual(titles(index.listPosts()), ['Newest', 'Middle', 'Earlier Same Day', 'Oldest']);
  });

  it('excludes drafts, trashed documents and pages', async () => {
    const index = await populated();

    const listed = index.listPosts();

    assert.equal(
      listed.some((document) => document.draft),
      false,
    );
    assert.equal(
      listed.some((document) => document.path.startsWith('_trash/')),
      false,
    );
    assert.equal(
      listed.every((document) => document.type === 'post'),
      true,
    );
  });

  it('paginates with a page size and an offset', async () => {
    const index = await populated();

    assert.deepEqual(titles(index.listPosts({ limit: 2 })), ['Newest', 'Middle']);
    assert.deepEqual(titles(index.listPosts({ limit: 2, offset: 2 })), [
      'Earlier Same Day',
      'Oldest',
    ]);
    assert.deepEqual(index.listPosts({ limit: 2, offset: 4 }), []);
    assert.deepEqual(titles(index.listPosts({ offset: 3 })), ['Oldest']);
  });

  it('reports the page count through counts(), so pagination has a total', async () => {
    const index = await populated();

    assert.deepEqual(index.counts(), {
      total: 7,
      posts: 4,
      pages: 1,
      drafts: 1,
      scheduled: 0,
      trashed: 1,
    });
  });
});

describe('neighbours', () => {
  it('answers with the published posts either side of one by date', async () => {
    const index = await populated();
    const middle = index.getByPermalink('/2026/06/middle/');
    assert.ok(middle !== undefined);

    const either = index.neighbours(middle);

    assert.equal(either.previous?.title, 'Earlier Same Day', 'the older post');
    assert.equal(either.next?.title, 'Newest', 'the newer post');
  });

  it('leaves the end of the archive off rather than wrapping round it', async () => {
    const index = await populated();
    const newest = index.getByPermalink('/2026/09/newest/');
    const oldest = index.getByPermalink('/2026/01/oldest/');
    assert.ok(newest !== undefined && oldest !== undefined);

    assert.equal(index.neighbours(newest).next, undefined);
    assert.equal(index.neighbours(newest).previous?.title, 'Middle');
    assert.equal(index.neighbours(oldest).previous, undefined);
    assert.equal(index.neighbours(oldest).next?.title, 'Earlier Same Day');
  });

  it('never offers a draft, a trashed post, a page or a post that is not due yet', async () => {
    let now = new Date('2026-09-05T00:00:00Z');
    const index = openContentStore({ dataDir: await dataDir(), now: () => now });
    openStores.push(index);
    index.upsertAll(corpus());
    index.upsert(
      post({
        path: 'posts/2026-12-01-scheduled.md',
        slug: 'scheduled',
        permalink: '/2026/12/scheduled/',
        title: 'Scheduled',
        date: '2026-12-01T00:00:00Z',
      }),
    );
    const newest = index.getByPermalink('/2026/09/newest/');
    assert.ok(newest !== undefined);

    // The draft, the trashed post and the scheduled one are all dated after it.
    assert.equal(index.neighbours(newest).next, undefined);

    now = new Date('2026-12-02T00:00:00Z');
    assert.equal(
      index.neighbours(newest).next?.title,
      'Scheduled',
      'and the scheduled one becomes the neighbour on its date',
    );
  });

  it('has no neighbours for a page, which is not part of anybody’s archive', async () => {
    const index = await populated();
    const about = index.getByPermalink('/about/');
    assert.ok(about !== undefined);

    assert.deepEqual(index.neighbours(about), {});
  });

  it('separates two posts sharing an instant by path, the way the listings order them', async () => {
    const index = await store();
    index.upsertAll([
      post({
        path: 'posts/a.md',
        slug: 'a',
        permalink: '/a/',
        title: 'A',
        date: '2026-01-01T00:00:00Z',
      }),
      post({
        path: 'posts/b.md',
        slug: 'b',
        permalink: '/b/',
        title: 'B',
        date: '2026-01-01T00:00:00Z',
      }),
    ]);
    const b = index.getByPermalink('/b/');
    assert.ok(b !== undefined);

    // Newest first is `date DESC, path DESC`, so B is listed before A.
    assert.equal(index.neighbours(b).previous?.title, 'A');
    assert.equal(index.neighbours(b).next, undefined);
  });
});

describe('listPostsSince', () => {
  it('returns the published posts dated at or after an instant, newest first', async () => {
    const index = await populated();

    assert.deepEqual(titles(index.listPostsSince('2026-06-01T00:00:00.000Z')), [
      'Newest',
      'Middle',
      'Earlier Same Day',
    ]);
    assert.deepEqual(titles(index.listPostsSince('2026-09-01T00:00:00.000Z')), ['Newest']);
    assert.deepEqual(index.listPostsSince('2026-10-01T00:00:00.000Z'), []);
  });

  it('leaves out the drafts, the trash, the pages and anything not due yet', async () => {
    let now = new Date('2026-09-05T00:00:00Z');
    const index = openContentStore({ dataDir: await dataDir(), now: () => now });
    openStores.push(index);
    index.upsertAll(corpus());
    index.upsert(
      post({
        path: 'posts/2026-12-01-scheduled.md',
        slug: 'scheduled',
        permalink: '/2026/12/scheduled/',
        title: 'Scheduled',
        date: '2026-12-01T00:00:00Z',
      }),
    );

    assert.deepEqual(titles(index.listPostsSince('2026-09-01T00:00:00.000Z')), ['Newest']);

    now = new Date('2026-12-02T00:00:00Z');
    assert.deepEqual(titles(index.listPostsSince('2026-09-01T00:00:00.000Z')), [
      'Scheduled',
      'Newest',
    ]);
  });
});

describe('listByTag', () => {
  it('returns the documents carrying a tag, newest first', async () => {
    const index = await populated();

    assert.deepEqual(titles(index.listByTag('sqlite')), ['Middle', 'Earlier Same Day']);
  });

  it('excludes drafts and trashed documents and paginates', async () => {
    const index = await populated();

    assert.deepEqual(titles(index.listByTag('eleventy')), ['Newest', 'Middle', 'Oldest', 'About']);
    assert.deepEqual(titles(index.listByTag('eleventy', { type: 'post' })), [
      'Newest',
      'Middle',
      'Oldest',
    ]);
    assert.deepEqual(titles(index.listByTag('eleventy', { limit: 1, offset: 1 })), ['Middle']);
    assert.equal(index.countByTag('eleventy'), 4);
    assert.equal(index.countByTag('eleventy', { type: 'post' }), 3);
    assert.deepEqual(index.listByTag('nothing-uses-this'), []);
  });

  it('reports the tags in use with their counts', async () => {
    const index = await populated();

    assert.deepEqual(index.listTags(), [
      { tag: 'eleventy', count: 4 },
      { tag: 'sqlite', count: 2 },
    ]);
  });
});

describe('listByCategory', () => {
  it('returns the documents filed under a category, newest first', async () => {
    const index = await populated();

    assert.deepEqual(titles(index.listByCategory('engineering')), ['Middle', 'Earlier Same Day']);
  });

  it('excludes drafts and trashed documents and paginates', async () => {
    const index = await populated();

    assert.deepEqual(titles(index.listByCategory('general')), [
      'Newest',
      'Middle',
      'Oldest',
      'About',
    ]);
    assert.deepEqual(titles(index.listByCategory('general', { type: 'post' })), [
      'Newest',
      'Middle',
      'Oldest',
    ]);
    assert.deepEqual(titles(index.listByCategory('general', { limit: 1, offset: 1 })), ['Middle']);
    assert.equal(index.countByCategory('general'), 4);
    assert.equal(index.countByCategory('general', { type: 'post' }), 3);
    assert.deepEqual(index.listByCategory('nothing-is-filed-here'), []);
  });

  it('reports the categories in use with their counts', async () => {
    const index = await populated();

    assert.deepEqual(index.listCategories(), [
      { category: 'general', count: 4 },
      { category: 'engineering', count: 2 },
    ]);
  });

  it('reports every term in use with both counts, for the management screens', async () => {
    const index = await populated();

    // Alphabetical rather than by count: this is what a screen that manages
    // the terms lists, and the second count is every file carrying the term —
    // drafts, scheduled and trash included — because that is what a rename
    // would rewrite.
    assert.deepEqual(index.listTermUsage('tag'), [
      { term: 'eleventy', published: 4, total: 6 },
      { term: 'sqlite', published: 2, total: 2 },
    ]);
    assert.deepEqual(index.listTermUsage('category'), [
      { term: 'engineering', published: 2, total: 2 },
      { term: 'general', published: 4, total: 6 },
    ]);
  });

  it('keeps the two taxonomies apart', async () => {
    const index = await populated();

    assert.deepEqual(index.listByCategory('eleventy'), []);
    assert.deepEqual(index.listByTag('general'), []);
  });

  it('replaces a document’s categories on a rewrite rather than adding to them', async () => {
    const index = await store();
    index.upsert(post({ categories: ['general', 'engineering'] }));

    index.upsert(post({ categories: ['engineering'] }));

    assert.deepEqual(index.getByPath('posts/2026-09-02-hello-world.md')?.categories, [
      'engineering',
    ]);
    assert.equal(index.countByCategory('general'), 0);
  });
});

describe('listByAuthor (TASK-67 AC #3)', () => {
  /** Posts by two people, one of whom two files name two different ways. */
  async function attributed(): Promise<ContentStore> {
    const index = await store();
    index.upsertAll([
      post({
        path: 'posts/2026-01-01-by-login.md',
        slug: 'by-login',
        permalink: '/2026/01/by-login/',
        title: 'By Login',
        date: '2026-01-01T00:00:00Z',
        author: 'ada',
      }),
      post({
        path: 'posts/2026-02-01-by-display-name.md',
        slug: 'by-display-name',
        permalink: '/2026/02/by-display-name/',
        title: 'By Display Name',
        date: '2026-02-01T00:00:00Z',
        author: 'Ada Lovelace',
      }),
      post({
        path: 'posts/2026-03-01-by-somebody-else.md',
        slug: 'by-somebody-else',
        permalink: '/2026/03/by-somebody-else/',
        title: 'By Somebody Else',
        date: '2026-03-01T00:00:00Z',
        author: 'grace',
      }),
      post({
        path: 'posts/2026-04-01-a-draft-of-hers.md',
        slug: 'a-draft-of-hers',
        permalink: '/2026/04/a-draft-of-hers/',
        title: 'A Draft Of Hers',
        date: '2026-04-01T00:00:00Z',
        draft: true,
        author: 'ada',
      }),
      post({
        path: '_trash/posts/2026-05-01-thrown-away.md',
        slug: 'thrown-away',
        permalink: '/2026/05/thrown-away/',
        title: 'Thrown Away',
        date: '2026-05-01T00:00:00Z',
        author: 'ada',
      }),
      post({
        type: 'page',
        path: 'pages/her-page.md',
        slug: 'her-page',
        permalink: '/her-page/',
        title: 'Her Page',
        date: undefined,
        author: 'ada',
      }),
      post({
        path: 'posts/2099-01-01-not-due-yet.md',
        slug: 'not-due-yet',
        permalink: '/2099/01/not-due-yet/',
        title: 'Not Due Yet',
        date: '2099-01-01T00:00:00Z',
        author: 'ada',
      }),
    ]);
    return index;
  }

  it('returns the published posts filed under any of the names, newest first', async () => {
    const index = await attributed();

    assert.deepEqual(titles(index.listByAuthor(['ada', 'Ada Lovelace'])), [
      'By Display Name',
      'By Login',
    ]);
    assert.equal(index.countByAuthor(['ada', 'Ada Lovelace']), 2);
  });

  it('leaves out drafts, the trash, pages and posts that are not due', async () => {
    const index = await attributed();

    const listed = titles(index.listByAuthor(['ada', 'Ada Lovelace']));
    for (const hidden of ['A Draft Of Hers', 'Thrown Away', 'Her Page', 'Not Due Yet']) {
      assert.equal(listed.includes(hidden), false, `${hidden} is not on an archive`);
    }
  });

  it('paginates like every other listing', async () => {
    const index = await attributed();

    assert.deepEqual(titles(index.listByAuthor(['ada', 'Ada Lovelace'], { limit: 1 })), [
      'By Display Name',
    ]);
    assert.deepEqual(titles(index.listByAuthor(['ada', 'Ada Lovelace'], { limit: 1, offset: 1 })), [
      'By Login',
    ]);
  });

  it('is empty for a name nothing carries, and for no names at all', async () => {
    const index = await attributed();

    assert.deepEqual(index.listByAuthor(['babbage']), []);
    assert.equal(index.countByAuthor(['babbage']), 0);
    assert.deepEqual(index.listByAuthor([]), []);
    assert.equal(index.countByAuthor([]), 0);
  });
});

describe('listAll', () => {
  it('shows the admin drafts alongside published documents, but not the trash', async () => {
    const index = await populated();

    assert.deepEqual(titles(index.listAll()), [
      'A Draft',
      'Newest',
      'Middle',
      'Earlier Same Day',
      'Oldest',
      'About',
    ]);
  });

  it('filters by type, draft, trash, tag and category', async () => {
    const index = await populated();

    assert.deepEqual(titles(index.listAll({ type: 'page' })), ['About']);
    assert.deepEqual(titles(index.listAll({ draft: true })), ['A Draft']);
    assert.deepEqual(titles(index.listAll({ trashed: true })), ['Thrown Away']);
    assert.deepEqual(titles(index.listAll({ tag: 'sqlite' })), ['Middle', 'Earlier Same Day']);
    assert.deepEqual(titles(index.listAll({ category: 'engineering' })), [
      'Middle',
      'Earlier Same Day',
    ]);
    assert.deepEqual(titles(index.listAll({ limit: 1 })), ['A Draft']);
  });

  it('lists every indexed path, so a sync can prune what the tree no longer has', async () => {
    const index = await populated();

    assert.deepEqual(index.listPaths(), [
      '_trash/posts/2026-09-03-thrown-away.md',
      'pages/about.md',
      'posts/2026-01-01-oldest.md',
      'posts/2026-06-01-earlier-same-day.md',
      'posts/2026-06-01-middle.md',
      'posts/2026-09-01-newest.md',
      'posts/2026-09-02-a-draft.md',
    ]);
  });
});

describe('listFederated', () => {
  /** The same corpus, with an `activitypub.published` on the documents named here. */
  async function announced(...paths: string[]): Promise<ContentStore> {
    const index = await store();
    index.upsertAll(
      corpus().map((document) =>
        paths.includes(document.path)
          ? {
              ...document,
              activitypub: { published: document.date ?? '2026-01-01T00:00:00Z' },
            }
          : document,
      ),
    );
    return index;
  }

  it('lists the posts the site has announced, newest first', async () => {
    const index = await announced(
      'posts/2026-09-01-newest.md',
      'posts/2026-01-01-oldest.md',
      'posts/2026-06-01-middle.md',
    );

    assert.deepEqual(titles(index.listFederated()), ['Newest', 'Middle', 'Oldest']);
  });

  it('leaves out a post the site has never announced', async () => {
    const index = await announced('posts/2026-09-01-newest.md');

    assert.deepEqual(titles(index.listFederated()), ['Newest']);
  });

  it('keeps drafts and the trash, which are what a Delete is sent for', async () => {
    const index = await announced(
      '_trash/posts/2026-09-03-thrown-away.md',
      'posts/2026-09-02-a-draft.md',
    );

    assert.deepEqual(titles(index.listFederated()), ['Thrown Away', 'A Draft']);
  });

  it('leaves out a page and an activitypub block that records no announcement', async () => {
    const index = await store();
    index.upsertAll([
      ...corpus().map((document) =>
        document.path === 'pages/about.md'
          ? { ...document, activitypub: { published: '2026-01-01T09:00:00Z' } }
          : document,
      ),
      post({
        path: 'posts/2026-09-04-stamped-later.md',
        slug: 'stamped-later',
        permalink: '/2026/09/stamped-later/',
        title: 'Not Announced Yet',
        date: '2026-09-04T09:00:00Z',
        // A migrated post's stored id on its own says nothing about whether
        // this site has ever delivered it.
        activitypub: { id: 'https://blog.example/?p=813' },
      }),
    ]);

    assert.deepEqual(index.listFederated(), []);
  });

  it('paginates, so the federation screen can ask for one page of them', async () => {
    const index = await announced(
      'posts/2026-09-01-newest.md',
      'posts/2026-06-01-middle.md',
      'posts/2026-01-01-oldest.md',
    );

    assert.deepEqual(titles(index.listFederated({ limit: 2 })), ['Newest', 'Middle']);
    assert.deepEqual(titles(index.listFederated({ limit: 2, offset: 2 })), ['Oldest']);
  });
});

describe('scheduled documents', () => {
  /** A store whose clock this test moves, and the handle that moves it. */
  async function scheduledCorpus(): Promise<{ index: ContentStore; set: (now: string) => void }> {
    let now = new Date('2026-09-03T12:00:00Z');
    const index = openContentStore({ dataDir: await dataDir(), now: () => now });
    openStores.push(index);
    index.upsertAll([
      ...corpus(),
      post({
        path: 'posts/2026-09-04-tomorrow.md',
        slug: 'tomorrow',
        permalink: '/2026/09/tomorrow/',
        title: 'Tomorrow',
        date: '2026-09-04T09:00:00Z',
        tags: ['scheduling'],
        categories: ['engineering'],
      }),
    ]);
    return {
      index,
      set: (instant: string) => {
        now = new Date(instant);
      },
    };
  }

  it('keeps a future-dated post out of listPosts until the clock reaches its date', async () => {
    let now = new Date('2026-09-03T12:00:00Z');
    const index = openContentStore({ dataDir: await dataDir(), now: () => now });
    openStores.push(index);
    index.upsert(post({ date: '2026-09-04T09:00:00Z' }));

    assert.deepEqual(titles(index.listPosts()), []);

    now = new Date('2026-09-04T09:00:00Z');

    assert.deepEqual(titles(index.listPosts()), ['Hello, World!']);
  });

  it('keeps it out of both taxonomy archives and out of the terms in use', async () => {
    const { index, set } = await scheduledCorpus();

    assert.deepEqual(titles(index.listByTag('scheduling')), []);
    assert.equal(index.countByTag('scheduling'), 0);
    assert.equal(
      index.listTags().some((entry) => entry.tag === 'scheduling'),
      false,
    );
    assert.equal(index.countByCategory('engineering'), 2);
    assert.deepEqual(
      index.listCategories().find((entry) => entry.category === 'engineering'),
      { category: 'engineering', count: 2 },
    );

    set('2026-09-04T09:00:00Z');

    assert.deepEqual(titles(index.listByTag('scheduling')), ['Tomorrow']);
    assert.equal(index.countByTag('scheduling'), 1);
    assert.equal(index.countByCategory('engineering'), 3);
  });

  it('counts it as scheduled rather than as part of the public archive', async () => {
    const { index, set } = await scheduledCorpus();

    assert.equal(index.counts().posts, 4);
    assert.equal(index.counts().scheduled, 1);

    set('2026-09-04T09:00:00Z');

    assert.equal(index.counts().posts, 5);
    assert.equal(index.counts().scheduled, 0);
  });

  it('is still in the index, so the admin can list it and filter for it', async () => {
    const { index } = await scheduledCorpus();

    assert.equal(index.getByPermalink('/2026/09/tomorrow/')?.title, 'Tomorrow');
    assert.ok(titles(index.listAll()).includes('Tomorrow'));
    assert.deepEqual(titles(index.listAll({ scheduled: true })), ['Tomorrow']);
    assert.equal(titles(index.listAll({ scheduled: false })).includes('Tomorrow'), false);
    assert.equal(titles(index.listAll({ scheduled: false })).includes('A Draft'), true);
  });

  it('answers when it is next due, and reports nothing once everything has come due', async () => {
    const { index, set } = await scheduledCorpus();

    assert.equal(index.nextDue(), '2026-09-04T09:00:00.000Z');

    set('2026-09-04T09:00:00Z');

    assert.equal(index.nextDue(), undefined);
  });

  it('lists what has come due since an instant, oldest first, and nothing twice', async () => {
    const { index, set } = await scheduledCorpus();
    index.upsert(
      post({
        path: 'posts/2026-09-05-later.md',
        slug: 'later',
        permalink: '/2026/09/later/',
        title: 'Later',
        date: '2026-09-05T09:00:00Z',
      }),
    );
    const watermark = '2026-09-03T12:00:00.000Z';

    assert.deepEqual(titles(index.listDueSince(watermark)), []);

    set('2026-09-05T09:00:00Z');

    assert.deepEqual(titles(index.listDueSince(watermark)), ['Tomorrow', 'Later']);
    assert.deepEqual(titles(index.listDueSince('2026-09-04T09:00:00.000Z')), ['Later']);
  });

  it('leaves a draft and a trashed document out of what comes due', async () => {
    let now = new Date('2026-09-03T12:00:00Z');
    const index = openContentStore({ dataDir: await dataDir(), now: () => now });
    openStores.push(index);
    index.upsertAll([
      post({ path: 'posts/a.md', slug: 'a', permalink: '/a/', title: 'A Draft', draft: true }),
      post({
        path: '_trash/posts/b.md',
        slug: 'b',
        permalink: '/b/',
        title: 'Thrown Away',
        date: '2026-09-04T09:00:00Z',
      }),
    ]);
    index.upsert(
      post({
        path: 'posts/c.md',
        slug: 'c',
        permalink: '/c/',
        title: 'A Draft Ahead',
        date: '2026-09-04T09:00:00Z',
        draft: true,
      }),
    );

    assert.equal(index.nextDue(), undefined);

    now = new Date('2026-09-04T09:00:00Z');

    assert.deepEqual(titles(index.listDueSince('2026-09-03T12:00:00.000Z')), []);
  });
});

describe('permalinks', () => {
  it('are unique: a second document at the same URL fails with both paths named', async () => {
    const index = await store();
    index.upsert(post());

    assert.throws(
      () => {
        index.upsert(post({ path: 'posts/2026-09-02-duplicate.md', title: 'Duplicate' }));
      },
      (error: unknown) => {
        assert.ok(error instanceof DuplicatePermalinkError);
        assert.equal(error.permalink, '/2026/09/hello-world/');
        assert.equal(error.path, 'posts/2026-09-02-duplicate.md');
        assert.equal(error.conflictingPath, 'posts/2026-09-02-hello-world.md');
        assert.match(error.message, /posts\/2026-09-02-duplicate\.md/);
        assert.match(error.message, /posts\/2026-09-02-hello-world\.md/);
        return true;
      },
    );

    assert.equal(index.getByPermalink('/2026/09/hello-world/')?.title, 'Hello, World!');
    assert.equal(index.counts().total, 1);
  });

  it('are indexed, so a lookup does not scan the table', async () => {
    const index = await store();
    index.upsert(post());

    assert.match(
      queryPlan(index.file, 'SELECT * FROM documents WHERE permalink = ?'),
      /documents_permalink/,
    );
  });

  it('leave the batch untouched when one document in it conflicts', async () => {
    const index = await store();
    index.upsert(post());

    assert.throws(() => {
      index.upsertAll([
        post({
          path: 'posts/2026-10-01-fine.md',
          slug: 'fine',
          permalink: '/2026/10/fine/',
          title: 'Fine',
        }),
        post({ path: 'posts/2026-09-02-duplicate.md', title: 'Duplicate' }),
      ]);
    }, DuplicatePermalinkError);

    assert.equal(index.getByPermalink('/2026/10/fine/'), undefined);
    assert.equal(index.counts().total, 1);
  });
});

/** Read the schema versions a database has recorded, without going through the store. */
function appliedMigrations(file: string): number[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare('SELECT version FROM migrations ORDER BY version')
      .all()
      .map((row) => Number(row['version']));
  } finally {
    db.close();
  }
}

/** SQLite's own account of how it would run a query, so "indexed" is checkable. */
function queryPlan(file: string, sql: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((row) => String(row['detail']))
      .join('\n');
  } finally {
    db.close();
  }
}

describe('search (TASK-22)', () => {
  /** What a search found, as titles in the order it ranked them. */
  function found(index: ContentStore, query: string): string[] {
    return index.search(query).map((hit) => hit.document.title);
  }

  it('finds published posts and pages by any word in them (AC #1)', async () => {
    const index = await store();
    index.upsertAll([
      post({ title: 'On gardening', html: '<p>Tomatoes want sun.</p>' }),
      post({
        type: 'page',
        path: 'pages/about.md',
        slug: 'about',
        permalink: '/about/',
        title: 'About',
        date: undefined,
        html: '<p>I grow tomatoes.</p>',
      }),
    ]);

    assert.deepEqual(found(index, 'tomatoes').sort(), ['About', 'On gardening']);
    assert.deepEqual(found(index, 'sun'), ['On gardening']);
    assert.equal(index.countSearch('tomatoes'), 2);
  });

  it('ranks a title match above a match in the body (AC #1)', async () => {
    const index = await store();
    index.upsertAll([
      post({
        path: 'posts/a.md',
        permalink: '/a/',
        title: 'Notes',
        date: '2026-09-02T00:00:00Z',
        html: '<p>Some thoughts on sqlite, among many other things.</p>',
      }),
      post({
        path: 'posts/b.md',
        permalink: '/b/',
        title: 'Why sqlite',
        date: '2026-01-01T00:00:00Z',
        html: '<p>A small database.</p>',
      }),
    ]);

    assert.deepEqual(found(index, 'sqlite'), ['Why sqlite', 'Notes']);
  });

  it('never returns a draft, a trashed document or one not yet due (AC #3)', async () => {
    const index = openContentStore({
      dataDir: await dataDir(),
      now: () => new Date('2026-09-10T00:00:00Z'),
    });
    openStores.push(index);
    index.upsertAll([
      post({ path: 'posts/live.md', permalink: '/live/', title: 'Live', html: '<p>zebra</p>' }),
      post({
        path: 'posts/draft.md',
        permalink: '/draft/',
        title: 'Draft',
        draft: true,
        html: '<p>zebra</p>',
      }),
      post({
        path: '_trash/posts/gone.md',
        permalink: '/gone/',
        title: 'Gone',
        html: '<p>zebra</p>',
      }),
      post({
        path: 'posts/later.md',
        permalink: '/later/',
        title: 'Later',
        date: '2026-12-01T00:00:00Z',
        html: '<p>zebra</p>',
      }),
    ]);

    assert.deepEqual(found(index, 'zebra'), ['Live']);
    assert.equal(index.countSearch('zebra'), 1);
  });

  it('follows a document that is rewritten or removed (AC #2)', async () => {
    const index = await store();
    index.upsert(post({ html: '<p>Original words.</p>' }));
    assert.deepEqual(found(index, 'original'), ['Hello, World!']);

    index.upsert(post({ html: '<p>Replacement words.</p>' }));
    assert.deepEqual(found(index, 'original'), []);
    assert.deepEqual(found(index, 'replacement'), ['Hello, World!']);

    index.remove(post().path);
    assert.deepEqual(found(index, 'replacement'), []);
    assert.deepEqual(found(index, 'words'), []);
  });

  it('matches stems, prefixes, phrases and letters without their accents', async () => {
    const index = await store();
    index.upsert(post({ html: '<p>Running to the café for a quick coffee.</p>' }));

    assert.equal(found(index, 'run').length, 1);
    assert.equal(found(index, 'cafe').length, 1);
    assert.equal(found(index, 'cof*').length, 1);
    assert.equal(found(index, '"quick coffee"').length, 1);
    assert.equal(found(index, '"coffee quick"').length, 0);
  });

  it('requires every word', async () => {
    const index = await store();
    index.upsert(post({ html: '<p>Apples and pears.</p>' }));

    assert.equal(found(index, 'apples pears').length, 1);
    assert.equal(found(index, 'apples plums').length, 0);
  });

  it('searches the description and the taxonomy as well as the body', async () => {
    const index = await store();
    index.upsert(post({ description: 'About otters', tags: ['wildlife'], categories: ['nature'] }));

    assert.equal(found(index, 'otters').length, 1);
    assert.equal(found(index, 'wildlife').length, 1);
    assert.equal(found(index, 'nature').length, 1);
  });

  it('marks the matched words in the snippet', async () => {
    const index = await store();
    index.upsert(post({ html: '<p>The quick brown fox.</p>' }));

    const [hit] = index.search('brown');
    assert.equal(hit?.snippet, 'The quick \u0002brown\u0003 fox.');
  });

  it('pages through the results', async () => {
    const index = await store();
    index.upsertAll(
      [1, 2, 3].map((n) =>
        post({
          path: `posts/${String(n)}.md`,
          permalink: `/${String(n)}/`,
          title: `Post ${String(n)}`,
          date: `2026-0${String(n)}-01T00:00:00Z`,
          html: '<p>common</p>',
        }),
      ),
    );

    // Equal relevance falls back to newest first.
    assert.deepEqual(
      index.search('common', { limit: 2 }).map((hit) => hit.document.title),
      ['Post 3', 'Post 2'],
    );
    assert.deepEqual(
      index.search('common', { limit: 2, offset: 2 }).map((hit) => hit.document.title),
      ['Post 1'],
    );
  });

  it('finds nothing, and does not throw, for a query that is all syntax', async () => {
    const index = await store();
    index.upsert(post());

    for (const query of ['', '"', 'AND', 'NEAR(', '*', '-', 'title:', '^hello', '(']) {
      assert.doesNotThrow(() => index.search(query), query);
      assert.equal(index.countSearch(query), index.search(query).length, query);
    }
    assert.deepEqual(found(index, ''), []);
  });

  it('hands back documents that equal the ones it was given', async () => {
    const index = await store();
    index.upsert(post());

    assert.deepEqual(index.search('hello')[0]?.document, post());
  });
});

describe('the search index migration (TASK-22 AC #2)', () => {
  it('empties an index written before search existed, so the next scan fills it', async () => {
    const dir = await dataDir();

    // A version 3 database: rows, and no full-text table to find them in.
    const before = openContentStore({ dataDir: dir });
    before.upsert(post());
    before.close();

    const legacy = new DatabaseSync(path.join(dir, 'geekity.db'));
    legacy.exec('DROP TABLE documents_fts; DELETE FROM migrations WHERE version = 4');
    legacy.close();

    const upgraded = openContentStore({ dataDir: dir });
    try {
      assert.deepEqual(appliedMigrations(upgraded.file), [1, 2, 3, 4]);
      assert.equal(upgraded.counts().total, 0, 'a row survived with no words indexed for it');

      upgraded.upsert(post());
      assert.equal(upgraded.countSearch('hello'), 1);
    } finally {
      upgraded.close();
    }
  });
});
