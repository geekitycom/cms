import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';

import { openContentStore } from './store.ts';
import type { ContentStore } from './store.ts';
import { createContentSync } from './sync.ts';
import type { ContentSync, DocumentChange } from './sync.ts';

const temporaryDirs: string[] = [];
const openStores: ContentStore[] = [];
const runningSyncs: ContentSync[] = [];

/**
 * Every watcher a test started is stopped before the next one runs. macOS
 * quietly stops delivering events once a handful of watchers are live at the
 * same time, so leaving them open until the file finishes makes the later
 * tests flaky for a reason that has nothing to do with the CMS.
 */
afterEach(async () => {
  for (const sync of runningSyncs.splice(0)) await sync.stop();
});

after(async () => {
  for (const sync of runningSyncs.splice(0)) await sync.stop();
  for (const opened of openStores) opened.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A directory of this test's own, removed when the file finishes. */
async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `geekity-${prefix}-`));
  temporaryDirs.push(dir);
  return dir;
}

/** The text of a post or page file, front matter included. */
function markdown(fields: {
  title: string;
  permalink: string;
  date?: string;
  draft?: boolean;
  body?: string;
}): string {
  const lines = [`title: ${fields.title}`, `permalink: ${fields.permalink}`];
  if (fields.date !== undefined) lines.splice(1, 0, `date: ${fields.date}`);
  if (fields.draft !== undefined) lines.push(`draft: ${String(fields.draft)}`);
  return `---\n${lines.join('\n')}\n---\n\n${fields.body ?? 'Body.'}\n`;
}

/** A content directory with these files in it, each written for real. */
async function contentDir(files: Record<string, string>): Promise<string> {
  const dir = await temporaryDir('content');
  await writeFiles(dir, files);
  return dir;
}

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(dir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text, 'utf8');
  }
}

/** A store on a data dir of its own, closed when the file finishes. */
async function store(): Promise<ContentStore> {
  const opened = openContentStore({ dataDir: await temporaryDir('sync-data') });
  openStores.push(opened);
  return opened;
}

/** A store that counts its writes, so a no-op can be proven to write nothing. */
async function countingStore(): Promise<{ store: ContentStore; upserts: number }> {
  const real = await store();
  const counter = {
    store: {
      ...real,
      upsert(document) {
        counter.upserts += 1;
        real.upsert(document);
      },
    } as ContentStore,
    upserts: 0,
  };
  return counter;
}

/** A sync over a content directory, stopped when the file finishes. */
async function sync(
  dir: string,
  options: {
    watch?: boolean;
    debounceMs?: number;
    store?: ContentStore;
    logger?: { warn(message: string): void };
  } = {},
): Promise<{ sync: ContentSync; store: ContentStore; changes: DocumentChange[] }> {
  const index = options.store ?? (await store());
  const created = createContentSync({
    store: index,
    contentDir: dir,
    watch: options.watch ?? false,
    debounceMs: options.debounceMs ?? 20,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  runningSyncs.push(created);

  const changes: DocumentChange[] = [];
  created.events.on('change', (change) => changes.push(change));

  return { sync: created, store: index, changes };
}

/**
 * Poll until `read` returns something truthy, then hand it back. Bounded, so a
 * watcher that never fires fails the test instead of hanging it.
 *
 * The deadline is generous because it costs nothing: the loop returns the
 * instant the value appears, so only a test that is about to fail ever waits
 * this long. Four seconds was enough on an idle machine and not always enough
 * on a loaded one, where the pre-push hook runs this suite next to a build.
 */
async function eventually<T>(read: () => T | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Long enough for a watcher event and its debounce to have happened, so a test
 * that asserts nothing happened is asserting about a settled watcher.
 */
function settle(ms = 500): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('a full scan', () => {
  it('indexes every post and page under the content directory', async () => {
    const dir = await contentDir({
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00-05:00',
      }),
      'posts/2026-08-15-notes.md': markdown({
        title: 'Notes',
        permalink: '/2026/08/notes/',
        date: '2026-08-15T09:00:00-05:00',
      }),
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
    });
    const { sync: content, store: index } = await sync(dir);

    const result = await content.sync();

    assert.equal(result.created, 3);
    assert.equal(index.counts().total, 3);
    assert.equal(index.getByPermalink('/about/')?.title, 'About');
    assert.equal(index.listPosts().length, 2);
  });

  it('leaves a document whose file has not changed alone', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
    });
    const { sync: content, changes } = await sync(dir);
    await content.sync();
    changes.length = 0;

    const result = await content.sync();

    assert.equal(result.unchanged, 1);
    assert.equal(result.created, 0);
    assert.equal(result.updated, 0);
    assert.deepEqual(changes, []);
  });

  it('rewrites a document whose file changed', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/', body: 'First.' }),
    });
    const { sync: content, store: index } = await sync(dir);
    await content.sync();

    await writeFiles(dir, {
      'pages/about.md': markdown({ title: 'About', permalink: '/about/', body: 'Second.' }),
    });
    const result = await content.sync();

    assert.equal(result.updated, 1);
    assert.match(index.getByPath('pages/about.md')?.html ?? '', /Second\./);
  });

  it('drops rows whose file has gone', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
      'pages/colophon.md': markdown({ title: 'Colophon', permalink: '/colophon/' }),
    });
    const { sync: content, store: index, changes } = await sync(dir);
    await content.sync();
    changes.length = 0;

    await rm(path.join(dir, 'pages/colophon.md'));
    const result = await content.sync();

    assert.equal(result.removed, 1);
    assert.equal(index.getByPath('pages/colophon.md'), undefined);
    assert.equal(index.counts().total, 1);
    assert.deepEqual(
      changes.map((change) => [change.type, change.path]),
      [['deleted', 'pages/colophon.md']],
    );
  });

  it('indexes a document under _trash as trashed, out of the public listings', async () => {
    const dir = await contentDir({
      'posts/2026-09-02-live.md': markdown({
        title: 'Live',
        permalink: '/2026/09/live/',
        date: '2026-09-02T09:00:00Z',
      }),
      '_trash/posts/2026-08-01-binned.md': markdown({
        title: 'Binned',
        permalink: '/2026/08/binned/',
        date: '2026-08-01T09:00:00Z',
      }),
    });
    const { sync: content, store: index } = await sync(dir);

    await content.sync();

    assert.equal(index.counts().total, 2);
    assert.equal(index.counts().trashed, 1);
    assert.deepEqual(
      index.listPosts().map((document) => document.title),
      ['Live'],
    );
    assert.equal(index.listAll({ trashed: true })[0]?.title, 'Binned');
  });

  it('never indexes other underscore-prefixed directories', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
      '_data/site.json': '{"title":"Geekity"}',
      // The federation files decision-9 publishes with the site. They live
      // under `_data/` so a theme and an Eleventy build can read them, and the
      // index must go on ignoring them however deep they nest.
      '_data/federation/followers.json': '[]',
      '_data/federation/inbox/2026-09.jsonl': '{"receivedAt":"2026-09-03T10:00:00Z"}\n',
      '_drafts/pages/secret.md': markdown({ title: 'Secret', permalink: '/secret/' }),
      '_includes/posts/partial.md': markdown({ title: 'Partial', permalink: '/partial/' }),
    });
    const { sync: content, store: index } = await sync(dir);

    const result = await content.sync();

    assert.equal(result.scanned, 1);
    assert.deepEqual(index.listPaths(), ['pages/about.md']);
  });

  it('skips everything that is not a Markdown file under posts or pages', async () => {
    const dir = await contentDir({
      'posts/posts.json': '{"layout":"post"}',
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00Z',
      }),
      'posts/notes.txt': 'not markdown',
      'uploads/2026/09/photo.md': markdown({ title: 'Photo', permalink: '/photo/' }),
      'README.md': '# not content',
    });
    const { sync: content, store: index } = await sync(dir);

    const result = await content.sync();

    assert.equal(result.scanned, 1);
    assert.deepEqual(index.listPaths(), ['posts/2026-09-02-hello.md']);
  });

  it('logs a file it cannot parse and indexes the rest', async () => {
    const warnings: string[] = [];
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
      'pages/broken.md': 'no front matter at all\n',
      'pages/untitled.md': '---\npermalink: /untitled/\n---\n\nNo title.\n',
    });
    const { sync: content, store: index } = await sync(dir, {
      logger: { warn: (message) => warnings.push(message) },
    });

    const result = await content.sync();

    assert.equal(result.failed, 2);
    assert.equal(result.created, 1);
    assert.deepEqual(index.listPaths(), ['pages/about.md']);
    assert.equal(warnings.length, 2);
    assert.match(warnings.join('\n'), /broken\.md/);
  });

  it('indexes a post whose in-reply-to is not a URL, and says so once', async () => {
    const warnings: string[] = [];
    const dir = await contentDir({
      'posts/2026-09-02-agreed.md':
        "---\ndate: '2026-09-02T09:00:00Z'\nin-reply-to: their post\n---\n\nAgreed.\n",
      'posts/2026-09-03-fine.md':
        "---\ndate: '2026-09-03T09:00:00Z'\nin-reply-to: https://them.example/\n---\n\nFine.\n",
    });
    const { sync: content, store: index } = await sync(dir, {
      logger: { warn: (message) => warnings.push(message) },
    });

    await content.sync();
    await content.sync();

    assert.equal(index.listPaths().length, 2, 'both are indexed');
    assert.equal(warnings.length, 1, `one warning, for the one bad file: ${warnings.join(' | ')}`);
    assert.match(warnings[0] ?? '', /posts\/2026-09-02-agreed\.md/);
    assert.match(warnings[0] ?? '', /"their post"/);
    assert.match(warnings[0] ?? '', /not a reply/);
  });

  it('indexes a post whose canonical_href is not an absolute http(s) URL, and says so once', async () => {
    const warnings: string[] = [];
    const dir = await contentDir({
      'posts/2026-09-02-essay.md':
        "---\ndate: '2026-09-02T09:00:00Z'\ncanonical_href: /essays/essay/\n---\n\nWords.\n",
      'posts/2026-09-03-crossposted.md':
        "---\ndate: '2026-09-03T09:00:00Z'\ncanonical_href: https://me.substack.example/p/essay\n---\n\nWords.\n",
      'posts/2026-09-04-plain.md': "---\ndate: '2026-09-04T09:00:00Z'\n---\n\nWords.\n",
    });
    const { sync: content, store: index } = await sync(dir, {
      logger: { warn: (message) => warnings.push(message) },
    });

    await content.sync();
    await content.sync();

    assert.equal(index.listPaths().length, 3, 'all three are indexed');
    assert.equal(warnings.length, 1, `one warning, for the one bad file: ${warnings.join(' | ')}`);
    assert.match(warnings[0] ?? '', /posts\/2026-09-02-essay\.md/);
    assert.match(warnings[0] ?? '', /canonical_href "\/essays\/essay\/"/);
    assert.match(warnings[0] ?? '', /not an absolute http or https URL/);
  });

  it('names a canonical_name that stands without a valid canonical_href, and says so once', async () => {
    const warnings: string[] = [];
    const dir = await contentDir({
      'posts/2026-09-02-alone.md':
        "---\ndate: '2026-09-02T09:00:00Z'\ncanonical_name: Smarter Engineers\n---\n\nWords.\n",
      'posts/2026-09-03-named.md':
        "---\ndate: '2026-09-03T09:00:00Z'\ncanonical_href: https://open.substack.example/p/essay\ncanonical_name: Smarter Engineers\n---\n\nWords.\n",
    });
    const { sync: content, store: index } = await sync(dir, {
      logger: { warn: (message) => warnings.push(message) },
    });

    await content.sync();
    await content.sync();

    assert.equal(index.listPaths().length, 2, 'both are indexed');
    assert.equal(warnings.length, 1, `one warning, for the one bad file: ${warnings.join(' | ')}`);
    assert.match(warnings[0] ?? '', /posts\/2026-09-02-alone\.md/);
    assert.match(warnings[0] ?? '', /canonical_name "Smarter Engineers"/);
    assert.match(warnings[0] ?? '', /no absolute http or https canonical_href/);
  });

  it('is a no-op on a content directory that does not exist', async () => {
    const { sync: content, store: index } = await sync(
      path.join(await temporaryDir('missing'), 'content'),
    );

    const result = await content.sync();

    assert.equal(result.scanned, 0);
    assert.equal(index.counts().total, 0);
  });
});

describe('the watcher', () => {
  it('indexes what is already there when it starts', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
    });
    const { sync: content, store: index } = await sync(dir, { watch: true });

    const result = await content.start();

    assert.equal(result.created, 1);
    assert.equal(index.getByPermalink('/about/')?.title, 'About');
  });

  it(
    'starts over a content directory it cannot write to, and says it could not check the watch',
    { skip: process.getuid?.() === 0 ? 'root can write to any directory' : false },
    async () => {
      const dir = await contentDir({
        'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
      });
      await chmod(dir, 0o555);
      const warnings: string[] = [];
      const { sync: content, store: index } = await sync(dir, {
        watch: true,
        logger: { warn: (message) => warnings.push(message) },
      });

      try {
        const result = await content.start();

        assert.equal(result.created, 1);
        assert.equal(index.getByPermalink('/about/')?.title, 'About');
        assert.ok(
          warnings.some((message) => message.includes('cannot be written')),
          `the unchecked watch is named: ${warnings.join(' | ')}`,
        );
      } finally {
        await chmod(dir, 0o755);
      }
    },
  );

  it('indexes documents written into new directories while the boot scan runs', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
    });
    const { sync: content, store: index } = await sync(dir, { watch: true });
    const arrivals = {
      'posts/2026/10/deep/late.md': markdown({ title: 'Late', permalink: '/late/' }),
      'posts/2026/11/later.md': markdown({ title: 'Later', permalink: '/later/' }),
      'imported/pages/away.md': markdown({ title: 'Away', permalink: '/away/' }),
    };
    content.events.on('created', async (change) => {
      if (change.path === 'pages/about.md') await writeFiles(dir, arrivals);
    });

    await content.start();

    await eventually(
      () => Object.keys(arrivals).every((relative) => index.getByPath(relative) !== undefined),
      'every document written during the boot scan to be indexed',
    );
  });

  it('indexes documents in several directories made at once under a running watch, and drops them when a directory goes', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
    });
    const { sync: content, store: index } = await sync(dir, { watch: true });
    await content.start();
    const arrivals: Record<string, string> = {};
    for (const year of ['2019', '2020', '2021']) {
      for (const month of ['01', '06']) {
        arrivals[`posts/${year}/${month}/a.md`] = markdown({
          title: `${year}-${month} a`,
          permalink: `/${year}/${month}/a/`,
        });
        arrivals[`imported/${year}/posts/${month}/b.md`] = markdown({
          title: `${year}-${month} b`,
          permalink: `/imported/${year}/${month}/b/`,
        });
      }
    }

    await Promise.all(
      Object.entries(arrivals).map(async ([relative, text]) => {
        await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
        await writeFile(path.join(dir, relative), text, 'utf8');
      }),
    );

    await eventually(
      () => Object.keys(arrivals).every((relative) => index.getByPath(relative) !== undefined),
      'every document in the new directories to be indexed',
    );

    await rm(path.join(dir, 'imported'), { recursive: true });

    await eventually(
      () => index.listPaths().every((indexed) => !indexed.startsWith('imported/')),
      'the documents of the removed directory to leave the index',
    );
    assert.equal(index.listPaths().length, 1 + Object.keys(arrivals).length / 2);
  });

  it('picks up an edit to a post without a restart', async () => {
    const dir = await contentDir({
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00Z',
        body: 'First draft.',
      }),
    });
    const { sync: content, store: index, changes } = await sync(dir, { watch: true });
    await content.start();
    changes.length = 0;

    await writeFiles(dir, {
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00Z',
        body: 'Rewritten.',
      }),
    });

    const html = await eventually(() => {
      const found = index.getByPath('posts/2026-09-02-hello.md')?.html;
      return found !== undefined && found.includes('Rewritten.') ? found : undefined;
    }, 'the edit to reach the index');

    assert.match(html, /Rewritten\./);
    assert.deepEqual(
      changes.map((change) => [change.type, change.origin]),
      [['updated', 'watch']],
    );
  });

  it('indexes a file created after it started', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
    });
    const { sync: content, store: index } = await sync(dir, { watch: true });
    await content.start();

    await writeFiles(dir, {
      'posts/2026-09-03-new.md': markdown({
        title: 'Brand new',
        permalink: '/2026/09/new/',
        date: '2026-09-03T09:00:00Z',
      }),
    });

    const document = await eventually(
      () => index.getByPath('posts/2026-09-03-new.md'),
      'the new file to be indexed',
    );

    assert.equal(document.title, 'Brand new');
  });

  it('drops the row of a file deleted after it started', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
      'pages/colophon.md': markdown({ title: 'Colophon', permalink: '/colophon/' }),
    });
    const { sync: content, store: index } = await sync(dir, { watch: true });
    await content.start();

    await rm(path.join(dir, 'pages/colophon.md'));

    await eventually(
      () => index.getByPath('pages/colophon.md') === undefined,
      'the deleted file to leave the index',
    );

    assert.deepEqual(index.listPaths(), ['pages/about.md']);
  });

  it('writes nothing and emits nothing when a rewrite does not change the file', async () => {
    const source = markdown({ title: 'About', permalink: '/about/' });
    const dir = await contentDir({ 'pages/about.md': source });
    const index = await countingStore();
    const { sync: content, changes } = await sync(dir, { watch: true, store: index.store });
    await content.start();
    const writesAfterBoot = index.upserts;
    changes.length = 0;

    await writeFiles(dir, { 'pages/about.md': source });
    // Give the watcher room to fire and be found a no-op.
    await settle();

    assert.equal(index.upserts, writesAfterBoot);
    assert.deepEqual(changes, []);
  });

  it('collapses a burst of writes to one update', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/', body: 'One.' }),
    });
    const {
      sync: content,
      store: index,
      changes,
    } = await sync(dir, {
      watch: true,
      debounceMs: 200,
    });
    await content.start();
    changes.length = 0;

    for (const body of ['Two.', 'Three.', 'Four.']) {
      await writeFiles(dir, {
        'pages/about.md': markdown({ title: 'About', permalink: '/about/', body }),
      });
    }

    await eventually(
      () => index.getByPath('pages/about.md')?.html.includes('Four.') === true,
      'the last write of the burst to reach the index',
    );
    await settle();

    assert.deepEqual(
      changes.map((change) => change.type),
      ['updated'],
    );
  });

  it('stops watching when it is stopped', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/', body: 'One.' }),
    });
    const { sync: content, store: index } = await sync(dir, { watch: true });
    await content.start();

    await content.stop();
    await writeFiles(dir, {
      'pages/about.md': markdown({ title: 'About', permalink: '/about/', body: 'Two.' }),
    });
    await settle();

    assert.match(index.getByPath('pages/about.md')?.html ?? '', /One\./);
  });

  it('does not watch when watching is off', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/', body: 'One.' }),
    });
    const { sync: content, store: index } = await sync(dir, { watch: false });
    await content.start();

    await writeFiles(dir, {
      'pages/about.md': markdown({ title: 'About', permalink: '/about/', body: 'Two.' }),
    });
    await settle();

    assert.match(index.getByPath('pages/about.md')?.html ?? '', /One\./);
  });

  it('follows a post moved into the trash, whichever event arrives first', async () => {
    const source = markdown({
      title: 'Hello',
      permalink: '/2026/09/hello/',
      date: '2026-09-02T09:00:00Z',
    });
    const dir = await contentDir({ 'posts/2026-09-02-hello.md': source });
    const { sync: content, store: index } = await sync(dir, { watch: true });
    await content.start();

    await mkdir(path.join(dir, '_trash/posts'), { recursive: true });
    await rename(
      path.join(dir, 'posts/2026-09-02-hello.md'),
      path.join(dir, '_trash/posts/2026-09-02-hello.md'),
    );

    await eventually(
      () => index.getByPath('_trash/posts/2026-09-02-hello.md') !== undefined,
      'the trashed file to be indexed',
    );
    await eventually(() => index.listPosts().length === 0, 'the live row to go');
    assert.equal(index.counts().trashed, 1);
  });

  it('keeps watching after a file it cannot parse is saved', async () => {
    const warnings: string[] = [];
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
    });
    const { sync: content, store: index } = await sync(dir, {
      watch: true,
      logger: { warn: (message) => warnings.push(message) },
    });
    await content.start();

    await writeFiles(dir, { 'pages/broken.md': 'no front matter\n' });
    await eventually(
      () => warnings.some((warning) => warning.includes('broken.md')),
      'the parse failure to be logged',
    );

    await writeFiles(dir, {
      'posts/2026-08-04-later.md': markdown({
        title: 'Later',
        permalink: '/2026/08/later/',
        date: '2026-08-04T09:00:00Z',
      }),
    });
    const document = await eventually(
      () => index.getByPath('posts/2026-08-04-later.md'),
      'the watcher to keep working after a parse failure',
    );

    assert.equal(document.title, 'Later');
    assert.equal(index.getByPath('pages/broken.md'), undefined);
  });
});

describe('the events', () => {
  /** Every event the sync emits, in order, as `[name, change]`. */
  function record(content: ContentSync): [string, DocumentChange][] {
    const seen: [string, DocumentChange][] = [];
    for (const name of ['created', 'updated', 'deleted', 'published', 'unpublished'] as const) {
      content.events.on(name, (change) => seen.push([name, change]));
    }
    return seen;
  }

  it('reports a new published post as created and published', async () => {
    const dir = await contentDir({});
    const { sync: content } = await sync(dir);
    const seen = record(content);

    await writeFiles(dir, {
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00Z',
      }),
    });
    await content.sync();

    assert.deepEqual(
      seen.map(([name]) => name),
      ['created', 'published'],
    );
    const [, change] = seen[0] as [string, DocumentChange];
    assert.equal(change.previous, undefined);
    assert.equal(change.next?.title, 'Hello');
    assert.equal(change.origin, 'scan');
  });

  it('reports a new draft as created but not published', async () => {
    const dir = await contentDir({});
    const { sync: content } = await sync(dir);
    const seen = record(content);

    await writeFiles(dir, {
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00Z',
        draft: true,
      }),
    });
    await content.sync();

    assert.deepEqual(
      seen.map(([name]) => name),
      ['created'],
    );
  });

  it('carries both documents when a draft is published', async () => {
    const draft = markdown({
      title: 'Hello',
      permalink: '/2026/09/hello/',
      date: '2026-09-02T09:00:00Z',
      draft: true,
    });
    const dir = await contentDir({ 'posts/2026-09-02-hello.md': draft });
    const { sync: content } = await sync(dir);
    await content.sync();
    const seen = record(content);

    await writeFiles(dir, {
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00Z',
        draft: false,
      }),
    });
    await content.sync();

    assert.deepEqual(
      seen.map(([name]) => name),
      ['updated', 'published'],
    );
    const [, change] = seen[1] as [string, DocumentChange];
    assert.equal(change.previous?.draft, true);
    assert.equal(change.next?.draft, false);
  });

  it('reports a published post turned back into a draft as unpublished', async () => {
    const dir = await contentDir({
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00Z',
      }),
    });
    const { sync: content } = await sync(dir);
    await content.sync();
    const seen = record(content);

    await writeFiles(dir, {
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00Z',
        draft: true,
      }),
    });
    await content.sync();

    assert.deepEqual(
      seen.map(([name]) => name),
      ['updated', 'unpublished'],
    );
  });

  it('reports a deleted published post as deleted and unpublished', async () => {
    const dir = await contentDir({
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
    });
    const { sync: content } = await sync(dir);
    await content.sync();
    const seen = record(content);

    await rm(path.join(dir, 'pages/about.md'));
    await content.sync();

    assert.deepEqual(
      seen.map(([name]) => name),
      ['deleted', 'unpublished'],
    );
    const [, change] = seen[0] as [string, DocumentChange];
    assert.equal(change.previous?.title, 'About');
    assert.equal(change.next, undefined);
  });

  it('reports a move into the trash as unpublished, and a restore as published', async () => {
    const source = markdown({
      title: 'Hello',
      permalink: '/2026/09/hello/',
      date: '2026-09-02T09:00:00Z',
    });
    const dir = await contentDir({ 'posts/2026-09-02-hello.md': source });
    const { sync: content, store: index } = await sync(dir);
    await content.sync();

    const trashed = record(content);
    await rm(path.join(dir, 'posts/2026-09-02-hello.md'));
    await writeFiles(dir, { '_trash/posts/2026-09-02-hello.md': source });
    await content.sync();

    assert.deepEqual(
      trashed.map(([name, change]) => [name, change.path]),
      [
        ['deleted', 'posts/2026-09-02-hello.md'],
        ['unpublished', 'posts/2026-09-02-hello.md'],
        ['created', '_trash/posts/2026-09-02-hello.md'],
      ],
    );
    assert.deepEqual(index.listPosts(), []);

    const restored = record(content);
    await rm(path.join(dir, '_trash/posts/2026-09-02-hello.md'));
    await writeFiles(dir, { 'posts/2026-09-02-hello.md': source });
    await content.sync();

    assert.deepEqual(
      restored.map(([name, change]) => [name, change.path]),
      [
        ['deleted', '_trash/posts/2026-09-02-hello.md'],
        ['created', 'posts/2026-09-02-hello.md'],
        ['published', 'posts/2026-09-02-hello.md'],
      ],
    );
    assert.equal(index.listPosts().length, 1);
  });

  it('stops calling a listener that unsubscribed', async () => {
    const dir = await contentDir({});
    const { sync: content } = await sync(dir);
    const seen: string[] = [];
    const unsubscribe = content.events.on('created', (change) => seen.push(change.path));

    await writeFiles(dir, {
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
    });
    await content.sync();
    unsubscribe();
    await writeFiles(dir, {
      'pages/colophon.md': markdown({ title: 'Colophon', permalink: '/colophon/' }),
    });
    await content.sync();

    assert.deepEqual(seen, ['pages/about.md']);
  });

  it('keeps syncing when a listener throws', async () => {
    const warnings: string[] = [];
    const dir = await contentDir({});
    const { sync: content, store: index } = await sync(dir, {
      logger: { warn: (message) => warnings.push(message) },
    });
    content.events.on('created', () => {
      throw new Error('subscriber blew up');
    });

    await writeFiles(dir, {
      'pages/about.md': markdown({ title: 'About', permalink: '/about/' }),
    });
    await content.sync();

    assert.equal(index.getByPath('pages/about.md')?.title, 'About');
    assert.match(warnings.join('\n'), /subscriber blew up/);
  });
});

describe('the search index (TASK-22 AC #2)', () => {
  it('is filled by the boot scan and follows every edit, trashing and deletion', async () => {
    const dir = await contentDir({
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00Z',
        body: 'Aardvarks at dawn.',
      }),
    });
    const { sync: content, store: index } = await sync(dir, { watch: true });
    await content.start();

    assert.equal(index.countSearch('aardvarks'), 1, 'the boot scan did not index the words');

    await writeFiles(dir, {
      'posts/2026-09-02-hello.md': markdown({
        title: 'Hello',
        permalink: '/2026/09/hello/',
        date: '2026-09-02T09:00:00Z',
        body: 'Badgers at dusk.',
      }),
    });
    await eventually(() => index.countSearch('badgers') === 1, 'the edit to be searchable');
    assert.equal(index.countSearch('aardvarks'), 0);

    await mkdir(path.join(dir, '_trash/posts'), { recursive: true });
    await rename(
      path.join(dir, 'posts/2026-09-02-hello.md'),
      path.join(dir, '_trash/posts/2026-09-02-hello.md'),
    );
    await eventually(
      () =>
        index.getByPath('_trash/posts/2026-09-02-hello.md') !== undefined &&
        index.getByPath('posts/2026-09-02-hello.md') === undefined,
      'the trashed file to replace the live one in the index',
    );
    assert.equal(index.countSearch('badgers'), 0, 'a trashed post is still found');

    await rm(path.join(dir, '_trash/posts/2026-09-02-hello.md'));
    await eventually(() => index.listPaths().length === 0, 'the deleted file to leave the index');
    assert.equal(index.countSearch('badgers'), 0);
  });
});
