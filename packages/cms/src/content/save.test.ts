import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { DocumentContent } from './document.ts';
import { parseDocument } from './parser.ts';
import { contentFilePath, freeSlug, saveDocument } from './save.ts';
import { openContentStore } from './store.ts';
import type { ContentStore } from './store.ts';

const temporaryDirs: string[] = [];
const stores: ContentStore[] = [];

after(async () => {
  for (const store of stores) store.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

async function scratch(): Promise<{ contentDir: string; store: ContentStore }> {
  const contentDir = await temporaryDir('geekity-save-content-');
  const dataDir = await temporaryDir('geekity-save-data-');
  const store = openContentStore({ dataDir });
  stores.push(store);
  return { contentDir, store };
}

function draft(overrides: Partial<DocumentContent> = {}): DocumentContent {
  return {
    title: 'Hello world',
    date: '2026-09-02T10:00:00.000Z',
    permalink: '/2026/09/hello-world/',
    tags: [],
    categories: [],
    draft: true,
    extra: {},
    body: 'A first paragraph.',
    ...overrides,
  };
}

describe('contentFilePath', () => {
  it('puts a post under posts/ with its date as the filename prefix', () => {
    assert.equal(
      contentFilePath({ type: 'post', slug: 'hello-world', date: '2026-09-02T10:00:00.000Z' }),
      'posts/2026-09-02-hello-world.md',
    );
  });

  it('puts a page under pages/ with no date prefix', () => {
    assert.equal(contentFilePath({ type: 'page', slug: 'about' }), 'pages/about.md');
  });

  it('refuses a post with no date, because the filename needs one', () => {
    assert.throws(() => contentFilePath({ type: 'post', slug: 'hello' }), TypeError);
  });
});

describe('saveDocument', () => {
  it('writes the file and indexes it in one call', async () => {
    const { contentDir, store } = await scratch();

    const document = await saveDocument({
      contentDir,
      store,
      path: 'posts/2026-09-02-hello-world.md',
      content: draft(),
    });

    const written = await readFile(
      path.join(contentDir, 'posts/2026-09-02-hello-world.md'),
      'utf8',
    );
    assert.match(written, /^---\n/);
    assert.match(written, /^title: Hello world$/m);
    assert.match(written, /^draft: true$/m);
    assert.match(written, /A first paragraph\./);

    assert.equal(document.slug, 'hello-world');
    assert.equal(document.draft, true);
    assert.equal(
      store.getByPath('posts/2026-09-02-hello-world.md')?.title,
      'Hello world',
      'the index was updated without waiting for the watcher',
    );
  });

  it('creates the directory the file goes in', async () => {
    const { contentDir, store } = await scratch();

    await saveDocument({
      contentDir,
      store,
      path: 'pages/about.md',
      content: draft({ permalink: '/about/', draft: false, date: undefined }),
    });

    assert.equal(store.getByPermalink('/about/')?.title, 'Hello world');
  });

  it('leaves no temporary file behind, and the bytes it indexes are the bytes on disk', async () => {
    const { contentDir, store } = await scratch();

    const document = await saveDocument({
      contentDir,
      store,
      path: 'posts/2026-09-02-hello-world.md',
      content: draft(),
    });

    const entries = await readdir(path.join(contentDir, 'posts'));
    assert.deepEqual(entries, ['2026-09-02-hello-world.md']);

    const reread = await readFile(path.join(contentDir, 'posts/2026-09-02-hello-world.md'), 'utf8');
    assert.equal(
      parseDocument(reread, { path: 'posts/2026-09-02-hello-world.md' }).hash,
      document.hash,
    );
  });
});

describe('saveDocument, dates', () => {
  it('rewrites a hand-written offset as the UTC instant it names', async () => {
    const { contentDir, store } = await scratch();

    const document = await saveDocument({
      contentDir,
      store,
      path: 'posts/2026-06-02-reading-the-index.md',
      content: draft({
        date: '2026-06-02T07:30:00-05:00',
        updated: '2026-06-03T09:00:00-05:00',
        activitypub: {
          id: 'https://example.com/ap/posts/x',
          published: '2026-06-02T07:30:00-05:00',
        },
        permalink: '/2026/06/reading-the-index/',
      }),
    });

    const written = await readFile(
      path.join(contentDir, 'posts/2026-06-02-reading-the-index.md'),
      'utf8',
    );
    assert.match(written, /^date: '2026-06-02T12:30:00Z'$/m);
    assert.match(written, /^updated: '2026-06-03T14:00:00Z'$/m);
    assert.match(written, /^ {2}published: '2026-06-02T12:30:00Z'$/m);
    assert.equal(document.date, '2026-06-02T12:30:00Z');
    assert.equal(
      document.hash,
      store.getByPath('posts/2026-06-02-reading-the-index.md')?.hash,
      'the hash the index holds is the hash of the bytes on disk',
    );
  });

  it('reads an offset-less date as the wall clock in the timezone it is given', async () => {
    const { contentDir, store } = await scratch();

    const document = await saveDocument({
      contentDir,
      store,
      timezone: 'America/Chicago',
      path: 'posts/2026-09-04-hello-world.md',
      content: draft({ date: '2026-09-04 09:00', permalink: '/2026/09/hello-world/' }),
    });

    assert.equal(document.date, '2026-09-04T14:00:00Z');
  });

  it('leaves the permalink and the path exactly where they were', async () => {
    const { contentDir, store } = await scratch();

    const document = await saveDocument({
      contentDir,
      store,
      timezone: 'America/Chicago',
      path: 'posts/2026-06-02-reading-the-index.md',
      // A flat URL a hand-written file chose. Converting its date must not
      // move it, because the permalink in the file is what counts.
      content: draft({ date: '2026-06-02T07:30:00-05:00', permalink: '/reading-the-index/' }),
    });

    assert.equal(document.permalink, '/reading-the-index/');
    assert.equal(document.path, 'posts/2026-06-02-reading-the-index.md');
  });

  it('refuses a date nobody can read rather than writing one it invented', async () => {
    const { contentDir, store } = await scratch();

    await assert.rejects(
      saveDocument({
        contentDir,
        store,
        path: 'posts/2026-09-02-hello-world.md',
        content: draft({ date: 'one fine morning' }),
      }),
      TypeError,
    );
  });
});

describe('freeSlug', () => {
  it('hands back the slug it was given when nothing claims it', async () => {
    const { contentDir, store } = await scratch();

    assert.equal(
      await freeSlug({ contentDir, store, type: 'post', slug: 'hello', date: '2026-09-02' }),
      'hello',
    );
  });

  it('numbers a slug whose file already exists', async () => {
    const { contentDir, store } = await scratch();
    await mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await writeFile(path.join(contentDir, 'posts/2026-09-02-hello.md'), '---\ntitle: x\n---\n');

    assert.equal(
      await freeSlug({ contentDir, store, type: 'post', slug: 'hello', date: '2026-09-02' }),
      'hello-2',
    );
  });

  it('numbers a slug the index already holds at that permalink', async () => {
    const { contentDir, store } = await scratch();
    await saveDocument({
      contentDir,
      store,
      path: 'pages/about.md',
      content: draft({ permalink: '/about/', draft: false, date: undefined }),
    });

    assert.equal(await freeSlug({ contentDir, store, type: 'page', slug: 'about' }), 'about-2');
  });
});
