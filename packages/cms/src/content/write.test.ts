import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { commentsFile } from '../comments/records.ts';
import { siteRecords } from '../cms/site-records.ts';
import { resolveConfig } from '../config.ts';
import { refuseWritesUnder, WritesRefusedError } from '../files/atomic.ts';
import { createUser, setUserProfile } from '../site/users.ts';
import type { Document } from './document.ts';
import { blankForm } from './document-form.ts';
import type { EditorForm } from './document-form.ts';
import { POST_KIND } from './document-kind.ts';
import { DuplicatePermalinkError, openContentStore } from './store.ts';
import type { ContentStore } from './store.ts';
import type { DocumentChange } from './sync.ts';
import { releasePermalink, writeDocument } from './write.ts';
import type { DocumentSite } from './write.ts';

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

interface Scratch {
  readonly site: DocumentSite;
  readonly store: ContentStore;
  readonly contentDir: string;
  readonly announced: DocumentChange[];
  readonly config: DocumentSite['config'];
}

async function scratch(
  learnHandles: DocumentSite['learnHandles'] = async () => {},
): Promise<Scratch> {
  const contentDir = await temporaryDir('geekity-write-content-');
  const dataDir = await temporaryDir('geekity-write-data-');
  const store = openContentStore({ dataDir });
  stores.push(store);
  const announced: DocumentChange[] = [];
  const config = resolveConfig({ contentDir, dataDir, baseUrl: 'https://example.com' });
  const site: DocumentSite = {
    ...siteRecords(config),
    store,
    config,
    announce: (change) => {
      announced.push(change);
      return Promise.resolve();
    },
    writer: undefined,
    citedContext: () => Promise.resolve(undefined),
    storedContext: () => undefined,
    learnHandles,
  };
  return { site, store, contentDir, announced, config: site.config };
}

function form(overrides: Partial<EditorForm>): EditorForm {
  return {
    ...blankForm(POST_KIND, 'UTC', new Date('2026-09-02T10:00:00.000Z')),
    ...overrides,
  };
}

async function created(site: DocumentSite, overrides: Partial<EditorForm>): Promise<Document> {
  const written = await writeDocument(site, {
    kind: POST_KIND,
    document: undefined,
    form: form(overrides),
    draft: true,
  });
  assert.equal(written.outcome, 'saved');
  return written.saved;
}

async function postFiles(contentDir: string): Promise<string[]> {
  return (await readdir(path.join(contentDir, 'posts'))).sort();
}

function edited(document: Document, overrides: Partial<EditorForm>): EditorForm {
  return form({
    title: document.title,
    slug: document.slug,
    permalink: document.permalink,
    date: document.date ?? '',
    body: document.body,
    hash: document.hash,
    ...overrides,
  });
}

describe('writeDocument', () => {
  it('saves a new post, indexes it and announces it as created', async () => {
    const { site, store, contentDir, announced } = await scratch();

    const saved = await created(site, { title: 'Hello world', body: 'Words.' });

    assert.equal(saved.path, 'posts/2026-09-02-hello-world.md');
    assert.deepEqual(await postFiles(contentDir), ['2026-09-02-hello-world.md']);
    assert.equal(store.getByPath(saved.path)?.title, 'Hello world');
    assert.deepEqual(
      announced.map((change) => [change.type, change.path]),
      [['created', saved.path]],
    );
  });

  it('refuses a form before it touches anything', async () => {
    const { site, store, contentDir, announced } = await scratch();
    const saved = await created(site, { title: 'Hello world', body: 'Words.' });

    const written = await writeDocument(site, {
      kind: POST_KIND,
      document: saved,
      form: edited(saved, { slug: 'moved', lang: 'not a tag' }),
      draft: true,
    });

    assert.equal(written.outcome, 'refused');
    assert.deepEqual(await postFiles(contentDir), ['2026-09-02-hello-world.md']);
    assert.equal(store.getByPath(saved.path)?.hash, saved.hash);
    assert.equal(announced.length, 1);
  });

  it('moves a renamed draft to its new file and takes the old one away', async () => {
    const { site, store, contentDir } = await scratch();
    const saved = await created(site, { title: 'Hello world', body: 'Words.' });

    const written = await writeDocument(site, {
      kind: POST_KIND,
      document: saved,
      form: edited(saved, { slug: 'moved', permalink: '' }),
      draft: true,
    });

    assert.equal(written.outcome, 'saved');
    assert.deepEqual(await postFiles(contentDir), ['2026-09-02-moved.md']);
    assert.equal(store.getByPath(saved.path), undefined);
    assert.equal(store.getByPath('posts/2026-09-02-moved.md')?.permalink, '/2026/09/moved/');
  });

  it('keeps the old index row when a rename fails before its file is written', async () => {
    const { site, store, contentDir } = await scratch((body) =>
      body.includes('@someone@example.social')
        ? Promise.reject(new Error('WebFinger is down'))
        : Promise.resolve(),
    );
    const saved = await created(site, { title: 'Hello world', body: 'Words.' });

    await assert.rejects(
      writeDocument(site, {
        kind: POST_KIND,
        document: saved,
        form: edited(saved, { slug: 'moved', permalink: '', body: 'Hi @someone@example.social' }),
        draft: true,
      }),
      /WebFinger is down/,
    );

    assert.deepEqual(await postFiles(contentDir), ['2026-09-02-hello-world.md']);
    assert.equal(store.getByPath(saved.path)?.hash, saved.hash);
  });

  it('hands back the file as it is now when it changed after the form loaded', async () => {
    const { site, store, contentDir, announced } = await scratch();
    const saved = await created(site, { title: 'Hello world', body: 'Words.' });
    const file = path.join(contentDir, ...saved.path.split('/'));
    const changed = (await readFile(file, 'utf8')).replace('Words.', 'Edited behind its back.');
    await writeFile(file, changed, 'utf8');

    const written = await writeDocument(site, {
      kind: POST_KIND,
      document: saved,
      form: edited(saved, { slug: 'moved', permalink: '', body: 'New words.' }),
      draft: true,
    });

    assert.equal(written.outcome, 'conflict');
    assert.equal(written.conflict.current, changed);
    assert.deepEqual(await postFiles(contentDir), ['2026-09-02-hello-world.md']);
    assert.equal(await readFile(file, 'utf8'), changed);
    assert.equal(store.getByPath(saved.path)?.hash, saved.hash);
    assert.equal(announced.length, 1);
  });

  it('refuses to rename onto a file another document holds', async () => {
    const { site, store, contentDir } = await scratch();
    const first = await created(site, { title: 'First', body: 'One.' });
    const second = await created(site, { title: 'Second', body: 'Two.' });

    const written = await writeDocument(site, {
      kind: POST_KIND,
      document: second,
      form: edited(second, { slug: 'first', permalink: '' }),
      draft: true,
    });

    assert.equal(written.outcome, 'refused');
    assert.equal(written.field, 'editor-slug');
    assert.match(written.message, /Another post already lives in posts\/2026-09-02-first\.md/);
    assert.deepEqual(await postFiles(contentDir), ['2026-09-02-first.md', '2026-09-02-second.md']);
    assert.equal(store.getByPath(first.path)?.hash, first.hash);
    assert.equal(store.getByPath(second.path)?.hash, second.hash);
  });

  it('writes nothing while the server is handing over', async () => {
    const { site, store, contentDir } = await scratch();
    const saved = await created(site, { title: 'Hello world', body: 'Words.' });
    const release = refuseWritesUnder([contentDir]);

    try {
      await assert.rejects(
        writeDocument(site, {
          kind: POST_KIND,
          document: saved,
          form: edited(saved, { body: 'New words.' }),
          draft: true,
        }),
        WritesRefusedError,
      );
    } finally {
      release();
    }

    assert.equal(store.getByPath(saved.path)?.hash, saved.hash);
    assert.deepEqual(await postFiles(contentDir), ['2026-09-02-hello-world.md']);
  });
});

describe('releasePermalink', () => {
  it('frees the permalink for another path, and the returned step puts the row back', async () => {
    const { site, store } = await scratch();
    const saved = await created(site, { title: 'Hello world', body: 'Words.' });
    const moved = { ...saved, path: 'posts/2026-09-02-moved.md' };

    assert.throws(() => {
      store.upsert(moved);
    }, DuplicatePermalinkError);

    const restoreRow = releasePermalink(store, saved);
    assert.equal(store.getByPath(saved.path), undefined);
    store.upsert(moved);
    store.remove(moved.path);

    restoreRow();
    assert.equal(store.getByPermalink(saved.permalink)?.path, saved.path);
  });
});

describe('what a write reads about the site', () => {
  async function writeData(contentDir: string, name: string, value: unknown): Promise<void> {
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(path.join(contentDir, '_data', name), JSON.stringify(value));
  }

  async function renamed(site: DocumentSite, document: Document): Promise<Document> {
    const slug = `${document.slug}-renamed`;
    const written = await writeDocument(site, {
      kind: POST_KIND,
      document,
      form: edited(document, { slug, permalink: '' }),
      draft: true,
    });
    assert.equal(written.outcome, 'saved');
    return written.saved;
  }

  it('keeps the URL of a draft somebody has commented on, and not of one nobody has', async () => {
    const { site, contentDir } = await scratch();
    const answered = await created(site, { title: 'Answered', body: 'Words.' });
    const quiet = await created(site, { title: 'Quiet', body: 'Words.' });
    await mkdir(path.dirname(commentsFile(contentDir, answered.slug)), { recursive: true });
    await writeFile(commentsFile(contentDir, answered.slug), '[]');

    assert.deepEqual((await renamed(site, answered)).redirectFrom, [answered.permalink]);
    assert.equal((await renamed(site, quiet)).redirectFrom, undefined);
  });

  it('reads an offset-less date on the site’s timezone', async () => {
    const { site, contentDir } = await scratch();
    await writeData(contentDir, 'site.json', { timezone: 'America/Chicago' });

    const saved = await created(site, { title: 'Dated', body: 'Words.', date: '2026-09-02T09:00' });

    assert.equal(saved.date, '2026-09-02T14:00:00Z');
  });

  it('drops an unchecked target the site declares and keeps one it does not', async () => {
    const { site, contentDir } = await scratch();
    await writeData(contentDir, 'syndicationTargets.json', [
      { id: 'news', name: 'News', url: 'https://news.example/' },
    ]);
    const saved = await created(site, { title: 'Shared', body: 'Words.', syndicateTo: ['news'] });
    assert.deepEqual(saved.extra['syndicate-to'], ['news']);
    const listed = { ...saved, extra: { ...saved.extra, 'syndicate-to': ['news', 'gone'] } };

    const written = await writeDocument(site, {
      kind: POST_KIND,
      document: listed,
      form: edited(listed, { syndicateTo: [] }),
      draft: true,
    });

    assert.equal(written.outcome, 'saved');
    assert.deepEqual(written.saved.extra['syndicate-to'], ['gone']);
  });

  it('writes the username of the user a display name names, and counts their pins by both', async () => {
    const { site, store, config } = await scratch();
    const ada = await createUser({ dataDir: config.dataDir, username: 'ada', password: 'x' });
    await setUserProfile({
      dataDir: config.dataDir,
      userId: ada.id,
      profile: { displayName: 'Ada Lovelace' },
    });

    const byName = await created(site, { title: 'Byline', body: 'Words.', author: 'Ada Lovelace' });
    assert.equal(byName.author, 'ada');

    for (let index = 0; index < 5; index += 1) {
      const pinned = await created(site, {
        title: `Pinned ${String(index)}`,
        body: 'Words.',
        author: 'ada',
        pinned: true,
      });
      store.upsert({ ...pinned, author: index % 2 === 0 ? 'ada' : 'Ada Lovelace', draft: false });
    }
    const sixth = await writeDocument(site, {
      kind: POST_KIND,
      document: undefined,
      form: form({ title: 'Sixth', body: 'Words.', author: 'Ada Lovelace', pinned: true }),
      draft: true,
    });

    assert.equal(sixth.outcome, 'refused');
    assert.equal(sixth.field, 'editor-pinned');
  });
});

describe('the site records a write is given', () => {
  it('are what it reads, not the files behind them', async () => {
    const { site } = await scratch();
    const given: DocumentSite = {
      ...site,
      users: () => [{ id: 1, username: 'ada', profile: { displayName: 'Ada Lovelace' } }],
      timezone: () => 'Asia/Tokyo',
      syndicationTargets: () => [{ id: 'news', name: 'News', url: 'https://news.example/' }],
      hasComments: (slug) => slug === 'answered',
    };

    const saved = await created(given, {
      title: 'Answered',
      body: 'Words.',
      author: 'Ada Lovelace',
      date: '2026-09-02T09:00',
    });
    assert.equal(saved.author, 'ada');
    assert.equal(saved.date, '2026-09-02T00:00:00Z');

    const listed = { ...saved, extra: { ...saved.extra, 'syndicate-to': ['news'] } };
    const written = await writeDocument(given, {
      kind: POST_KIND,
      document: listed,
      form: edited(listed, { slug: 'moved', permalink: '', syndicateTo: [] }),
      draft: true,
    });

    assert.equal(written.outcome, 'saved');
    assert.deepEqual(written.saved.redirectFrom, [saved.permalink]);
    assert.equal(written.saved.extra['syndicate-to'], undefined);
  });
});
