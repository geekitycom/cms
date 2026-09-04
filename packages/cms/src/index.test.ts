import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  createCms,
  defaultPermalink,
  parseDocument,
  renderMarkdown,
  serializeDocument,
  slugify,
} from './index.ts';
import type { Cms, GeekityConfig } from './index.ts';

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A CMS with a data directory of its own, closed when the file finishes.
 * Every instance opens a SQLite index, so none of them may share a directory.
 */
async function cms(config: GeekityConfig = {}): Promise<Cms> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-cms-'));
  temporaryDirs.push(dataDir);
  const instance = createCms({ dataDir, ...config });
  started.push(instance);
  return instance;
}

describe('createCms', () => {
  it('answers GET / with 200', async () => {
    const instance = await cms({ baseUrl: 'https://geekity.example' });

    const response = await instance.app.request('/');

    assert.equal(response.status, 200);
  });

  it('serves HTML at the root', async () => {
    const instance = await cms({ baseUrl: 'https://geekity.example' });

    const response = await instance.app.request('/');

    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /Geekity/);
  });

  it('answers 404 for a path that is not a document yet', async () => {
    const instance = await cms({ baseUrl: 'https://geekity.example' });

    const response = await instance.app.request('/nothing-here/');

    assert.equal(response.status, 404);
  });

  it('exposes the resolved config, not the raw one', async () => {
    const instance = await cms({ port: 8080, contentDir: '/var/content' });

    assert.equal(instance.config.port, 8080);
    assert.equal(instance.config.contentDir, '/var/content');
    assert.equal(instance.config.baseUrl, 'http://localhost:8080');
  });

  it('can be created with no config beyond a data directory', async () => {
    const instance = await cms();

    assert.equal(instance.config.port, 3000);
    assert.equal((await instance.app.request('/')).status, 200);
  });

  it('reports its health, so a deploy can probe it', async () => {
    const instance = await cms();

    const response = await instance.app.request('/_geekity/health');

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  it('listens on the resolved port and answers a real HTTP request', async () => {
    const instance = await cms({ port: 0 });
    const { port } = await instance.serve();

    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Geekity/);
    } finally {
      await instance.close();
    }
  });

  it('is safe to close twice', async () => {
    const instance = await cms({ port: 0 });
    await instance.serve();
    await instance.close();
    await instance.close();
  });
});

describe('the content index', () => {
  it('opens on boot inside the data directory, creating it', async () => {
    const dataDir = path.join(await mkdtemp(path.join(tmpdir(), 'geekity-boot-')), 'data');
    temporaryDirs.push(path.dirname(dataDir));

    const instance = createCms({ dataDir });
    started.push(instance);

    assert.equal(instance.store.file, path.join(dataDir, 'geekity.db'));
    assert.ok(existsSync(instance.store.file));
    assert.deepEqual(instance.store.counts(), {
      total: 0,
      posts: 0,
      pages: 0,
      drafts: 0,
      scheduled: 0,
      trashed: 0,
    });
  });

  it('is reachable from a route the site adds', async () => {
    const instance = await cms();
    const source = await readFile(
      new URL('../test/fixtures/content/posts/2026-09-02-hello-world.md', import.meta.url),
      'utf8',
    );
    instance.store.upsert(parseDocument(source, { path: 'posts/2026-09-02-hello-world.md' }));

    instance.app.get('/titles', (c) =>
      c.json(c.var.store.listPosts().map((document) => document.title)),
    );

    const response = await instance.app.request('/titles');

    assert.deepEqual(await response.json(), ['Hello, World!']);
  });

  it('closes with the CMS, so a second boot on the same directory works', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-reboot-'));
    temporaryDirs.push(dataDir);

    const first = createCms({ dataDir });
    first.store.upsert(
      parseDocument('---\ntitle: A page\npermalink: /a-page/\n---\n\nBody.\n', {
        path: 'pages/a-page.md',
      }),
    );
    await first.close();

    const second = createCms({ dataDir });
    started.push(second);

    assert.equal(second.store.getByPermalink('/a-page/')?.title, 'A page');
  });
});

describe('keeping the index in step with the content directory', () => {
  /** A content directory with these files, plus the CMS that reads it. */
  async function site(
    files: Record<string, string>,
    config: GeekityConfig = {},
  ): Promise<{ cms: Cms; contentDir: string }> {
    const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-site-'));
    temporaryDirs.push(contentDir);
    for (const [relative, text] of Object.entries(files)) {
      const file = path.join(contentDir, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text, 'utf8');
    }
    return { cms: await cms({ contentDir, watch: false, ...config }), contentDir };
  }

  const page = (title: string, permalink: string, body = 'Body.'): string =>
    `---\ntitle: ${title}\npermalink: ${permalink}\n---\n\n${body}\n`;

  it('indexes every post and page when sync() is called', async () => {
    const { cms: instance } = await site({
      'posts/2026-09-02-hello.md': `---\ntitle: Hello\ndate: 2026-09-02T09:00:00Z\npermalink: /2026/09/hello/\n---\n\nHi.\n`,
      'posts/2026-08-15-notes.md': `---\ntitle: Notes\ndate: 2026-08-15T09:00:00Z\npermalink: /2026/08/notes/\n---\n\nNotes.\n`,
      'pages/about.md': page('About', '/about/'),
    });

    const result = await instance.sync();

    assert.equal(result.created, 3);
    assert.equal(instance.store.counts().total, 3);
    assert.equal(instance.store.listPosts().length, 2);
  });

  it('runs the scan on boot, so serving a site indexes it', async () => {
    const { cms: instance } = await site(
      { 'pages/about.md': page('About', '/about/') },
      { port: 0 },
    );

    await instance.serve();

    assert.equal(instance.store.getByPermalink('/about/')?.title, 'About');
  });

  it('picks up an edit while it is serving, and stops when it closes', async () => {
    const { cms: instance, contentDir } = await site(
      { 'pages/about.md': page('About', '/about/', 'First.') },
      { port: 0, watch: true },
    );
    await instance.serve();

    await writeFile(
      path.join(contentDir, 'pages/about.md'),
      page('About', '/about/', 'Second.'),
      'utf8',
    );

    const deadline = Date.now() + 4000;
    while (
      instance.store.getByPath('pages/about.md')?.html.includes('Second.') !== true &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.match(instance.store.getByPath('pages/about.md')?.html ?? '', /Second\./);

    await instance.close();
    await writeFile(
      path.join(contentDir, 'pages/about.md'),
      page('About', '/about/', 'Third.'),
      'utf8',
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

  it('tells subscribers about a document it indexed', async () => {
    const { cms: instance } = await site({ 'pages/about.md': page('About', '/about/') });
    const seen: string[] = [];
    instance.events.on('created', (change) => seen.push(`created ${change.path}`));
    instance.events.on('published', (change) =>
      seen.push(`published ${change.next?.title ?? '?'}`),
    );

    await instance.sync();

    assert.deepEqual(seen, ['created pages/about.md', 'published About']);
  });

  it('does not watch when the config turns watching off', async () => {
    const { cms: instance, contentDir } = await site(
      { 'pages/about.md': page('About', '/about/', 'First.') },
      { port: 0, watch: false },
    );
    await instance.serve();

    await writeFile(
      path.join(contentDir, 'pages/about.md'),
      page('About', '/about/', 'Second.'),
      'utf8',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    assert.match(instance.store.getByPath('pages/about.md')?.html ?? '', /First\./);
    await instance.close();
  });
});

describe('a site that brings only content', () => {
  /** A content directory with these files, plus the CMS that reads it. */
  async function site(
    files: Record<string, string>,
    config: GeekityConfig = {},
  ): Promise<{ cms: Cms; contentDir: string }> {
    const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-bare-'));
    temporaryDirs.push(contentDir);
    for (const [relative, text] of Object.entries(files)) {
      const file = path.join(contentDir, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text, 'utf8');
    }
    return { cms: await cms({ contentDir, watch: false, ...config }), contentDir };
  }

  const post = (title: string, permalink: string): string =>
    `---\ntitle: ${title}\ndate: '2026-01-01T09:00:00Z'\npermalink: ${permalink}\n---\n\nBody.\n`;

  it('serves the home page, a document and the stylesheet with no theme directory', async () => {
    const { cms: instance } = await site(
      { 'posts/2026-01-01-hello.md': post('Hello', '/2026/01/hello/') },
      { themeDir: path.join(tmpdir(), 'geekity-theme-that-is-not-there') },
    );
    await instance.sync();

    assert.equal(existsSync(instance.config.themeDir), false);
    assert.equal((await instance.app.request('/')).status, 200);
    assert.equal((await instance.app.request('/2026/01/hello/')).status, 200);
    assert.equal((await instance.app.request('/theme/style.css')).status, 200);
    assert.match(await (await instance.app.request('/2026/01/hello/')).text(), /Hello/);
  });

  it('lets a route the site added win over a permalink that would collide with it', async () => {
    const { cms: instance } = await site({
      'posts/2026-01-01-hello.md': post('Hello', '/hello/'),
    });
    await instance.sync();
    assert.equal(instance.store.getByPermalink('/hello/')?.title, 'Hello');

    // Registered after createCms mounted the public site, exactly as a site's
    // entry file does it.
    instance.app.get('/hello/', (c) => c.text('a route of my own'));

    const response = await instance.app.request('/hello/');

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'a route of my own');
  });

  it('still resolves every other document once a site route is registered', async () => {
    const { cms: instance } = await site({
      'posts/2026-01-01-hello.md': post('Hello', '/hello/'),
      'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
    });
    await instance.sync();
    instance.app.get('/hello/', (c) => c.text('a route of my own'));

    assert.equal((await instance.app.request('/about/')).status, 200);
    assert.equal((await instance.app.request('/nowhere/')).status, 404);
  });
});

describe('hooks', () => {
  /** A content directory with these files, plus the CMS that reads it. */
  async function site(
    files: Record<string, string>,
    config: GeekityConfig = {},
  ): Promise<{ cms: Cms; contentDir: string }> {
    const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-hooks-'));
    temporaryDirs.push(contentDir);
    for (const [relative, text] of Object.entries(files)) {
      const file = path.join(contentDir, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text, 'utf8');
    }
    return { cms: await cms({ contentDir, watch: false, ...config }), contentDir };
  }

  const page = (title: string, permalink: string, extra = ''): string =>
    `---\ntitle: ${title}\npermalink: ${permalink}\n${extra}---\n\nBody.\n`;

  it('calls the onDocumentChange the config named, for every change', async () => {
    const seen: string[] = [];
    const { cms: instance } = await site(
      {
        'pages/about.md': page('About', '/about/'),
        'posts/2026-01-01-one.md': page('One', '/one/'),
      },
      { onDocumentChange: (change) => seen.push(`${change.type} ${change.path}`) },
    );

    await instance.sync();

    assert.deepEqual(seen.sort(), ['created pages/about.md', 'created posts/2026-01-01-one.md']);
  });

  it('calls the onPublish the config named only for a document that became visible', async () => {
    const published: string[] = [];
    const { cms: instance } = await site(
      {
        'pages/about.md': page('About', '/about/'),
        'pages/secret.md': page('Secret', '/secret/', 'draft: true\n'),
      },
      { onPublish: (change) => published.push(change.next?.title ?? '?') },
    );

    await instance.sync();

    assert.deepEqual(published, ['About']);
  });

  it('tells a hook where the change came from, so a rebuild can be told from an edit', async () => {
    const origins: string[] = [];
    const { cms: instance } = await site(
      { 'pages/about.md': page('About', '/about/') },
      { onDocumentChange: (change) => origins.push(change.origin) },
    );

    await instance.sync();

    assert.deepEqual(origins, ['scan']);
  });

  it('takes a hook after the fact and hands back the unsubscribe', async () => {
    const seen: string[] = [];
    const { cms: instance } = await site({ 'pages/about.md': page('About', '/about/') });

    const stop = instance.onDocumentChange((change) => seen.push(change.path));
    await instance.sync();
    stop();
    await writeFile(
      path.join(instance.config.contentDir, 'pages/second.md'),
      page('Second', '/second/'),
      'utf8',
    );
    await instance.sync();

    assert.deepEqual(seen, ['pages/about.md']);
  });

  it('keeps going when a hook throws', async () => {
    const seen: string[] = [];
    const { cms: instance } = await site(
      { 'pages/about.md': page('About', '/about/') },
      {
        onDocumentChange: () => {
          throw new Error('the subscriber is broken');
        },
      },
    );
    instance.onDocumentChange((change) => seen.push(change.path));

    const result = await instance.sync();

    assert.equal(result.created, 1);
    assert.deepEqual(seen, ['pages/about.md']);
  });

  it('keeps going when an async hook rejects', async () => {
    const { cms: instance } = await site(
      { 'pages/about.md': page('About', '/about/') },
      { onPublish: () => Promise.reject(new Error('delivery failed')) },
    );

    const result = await instance.sync();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(result.created, 1);
  });
});

describe('the package entry point', () => {
  it('exposes the content conversions', async () => {
    const filePath = 'posts/2026-09-02-hello-world.md';
    const source = await readFile(
      new URL(`../test/fixtures/content/${filePath}`, import.meta.url),
      'utf8',
    );

    const document = parseDocument(source, { path: filePath });

    assert.equal(document.title, 'Hello, World!');
    assert.equal(serializeDocument(document), source);
  });

  it('exposes the slug and permalink helpers', () => {
    assert.equal(slugify('Héllo There'), 'hello-there');
    assert.equal(defaultPermalink({ type: 'page', slug: 'about' }), '/about/');
  });

  it('exposes the Markdown renderer', () => {
    assert.match(renderMarkdown('# Title\n'), /<h1 id="title">/);
  });
});
