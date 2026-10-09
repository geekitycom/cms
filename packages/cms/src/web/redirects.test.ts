import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

/**
 * The site's own redirect list, `content/_data/redirects.json` (TASK-128), and
 * the `X-Redirect-By` header on every redirect the CMS sends. Everything goes
 * through HTTP, because a redirect is only what a client is told.
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

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

function post(slug: string, extra = ''): string {
  return `---\ntitle: ${slug}\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/${slug}/\n${extra}---\n\nBody of ${slug}.\n`;
}

function page(slug: string): string {
  return `---\ntitle: ${slug}\npermalink: /${slug}/\n---\n\nThe ${slug} page.\n`;
}

function redirects(entries: unknown): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

async function site(files: Record<string, string>): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await temporaryDir('geekity-redirects-content-');
  const dataDir = await temporaryDir('geekity-redirects-data-');
  await writeTree(contentDir, files);
  const cms = createCms({ contentDir, dataDir, watch: false });
  started.push(cms);
  await cms.sync();
  return { cms, contentDir };
}

async function redirectOf(
  cms: Cms,
  url: string,
): Promise<{ status: number; location: string | null }> {
  const response = await cms.app.request(url);
  return { status: response.status, location: response.headers.get('location') };
}

const CONTENT: Record<string, string> = {
  'posts/2026-09-02-hello.md': post('hello'),
  'pages/about.md': page('about'),
};

describe('a declared redirect', () => {
  it('is served with the status the file declares, to a path or a URL', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects.json': redirects([
        { from: '/old-hello/', to: '/2026/09/hello/' },
        { from: '/soon/', to: '/about/', status: 302 },
        { from: '/kept/', to: '/about/', status: 308 },
        { from: '/elsewhere/', to: 'https://elsewhere.example/new/', status: 307 },
      ]),
    });

    assert.deepEqual(await redirectOf(cms, '/old-hello/'), {
      status: 301,
      location: '/2026/09/hello/',
    });
    assert.deepEqual(await redirectOf(cms, '/soon/'), { status: 302, location: '/about/' });
    assert.deepEqual(await redirectOf(cms, '/kept/'), { status: 308, location: '/about/' });
    assert.deepEqual(await redirectOf(cms, '/elsewhere/'), {
      status: 307,
      location: 'https://elsewhere.example/new/',
    });
  });

  it('carries the request query on to a target that has none of its own', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects.json': redirects([
        { from: '/old-hello/', to: '/2026/09/hello/' },
        { from: '/tracked/', to: '/about/?from=tracked' },
      ]),
    });

    assert.equal((await redirectOf(cms, '/old-hello/?utm=x')).location, '/2026/09/hello/?utm=x');
    assert.equal((await redirectOf(cms, '/tracked/?utm=x')).location, '/about/?from=tracked');
  });

  it('matches a ?p= link on the query it names, and only that query', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects.json': redirects([
        { from: '/?p=123', to: '/2026/09/hello/' },
        { from: '/archives/?cat=4&paged=2', to: '/about/', status: 302 },
      ]),
    });

    assert.deepEqual(await redirectOf(cms, '/?p=123'), {
      status: 301,
      location: '/2026/09/hello/',
    });
    // The parameters in either order are the same query.
    assert.deepEqual(await redirectOf(cms, '/archives/?paged=2&cat=4'), {
      status: 302,
      location: '/about/',
    });
    // Another post id is not this redirect, and `/` is still the home page.
    assert.equal((await cms.app.request('/?p=124')).status, 200);
    assert.equal((await cms.app.request('/')).status, 200);
    assert.equal((await cms.app.request('/archives/?cat=4')).status, 404);
  });

  it('reaches its target in one hop from the URL without its trailing slash', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects.json': redirects([{ from: '/soon/', to: '/about/', status: 302 }]),
    });

    assert.deepEqual(await redirectOf(cms, '/soon'), { status: 302, location: '/about/' });
  });

  it('is read from the file on each request, so an edit needs no restart', async () => {
    const { cms, contentDir } = await site({
      ...CONTENT,
      '_data/redirects.json': redirects([{ from: '/a/', to: '/about/' }]),
    });
    assert.equal((await redirectOf(cms, '/a/')).status, 301);

    await writeTree(contentDir, {
      '_data/redirects.json': redirects([{ from: '/b/', to: '/about/' }]),
    });
    assert.equal((await cms.app.request('/a/')).status, 404);
    assert.equal((await redirectOf(cms, '/b/')).status, 301);
  });
});

describe('redirects split across files', () => {
  it('serves every file under _data/redirects/ beside redirects.json, as a list or a map', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects.json': redirects([{ from: '/old-hello/', to: '/2026/09/hello/' }]),
      '_data/redirects/imported.json': redirects({
        '/?p=12': '/2026/09/hello/',
        '/?page_id=7': '/about/',
        '/photo-png/': '/uploads/2024/03/photo.png',
      }),
      '_data/redirects/legacy.json': redirects([
        { from: '/essays/hello/', to: '/2026/09/hello/', status: 308 },
      ]),
    });

    assert.deepEqual(await redirectOf(cms, '/old-hello/'), {
      status: 301,
      location: '/2026/09/hello/',
    });
    assert.deepEqual(await redirectOf(cms, '/?p=12'), {
      status: 301,
      location: '/2026/09/hello/',
    });
    assert.deepEqual(await redirectOf(cms, '/?page_id=7'), { status: 301, location: '/about/' });
    assert.deepEqual(await redirectOf(cms, '/photo-png/'), {
      status: 301,
      location: '/uploads/2024/03/photo.png',
    });
    assert.deepEqual(await redirectOf(cms, '/essays/hello/'), {
      status: 308,
      location: '/2026/09/hello/',
    });
  });

  it('lets redirects.json win a source another file also declares, and says so', async (t) => {
    const warn = t.mock.method(console, 'warn', () => undefined);
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects.json': redirects([{ from: '/?p=12', to: '/about/' }]),
      '_data/redirects/imported.json': redirects({ '/?p=12': '/2026/09/hello/' }),
    });

    assert.deepEqual(await redirectOf(cms, '/?p=12'), { status: 301, location: '/about/' });
    const reported = warn.mock.calls.map((call) => String(call.arguments[0])).join('\n');
    assert.match(reported, /imported\.json: "\/\?p=12" is declared more than once/);
  });

  it('reads a file added under _data/redirects/ on the next request', async () => {
    const { cms, contentDir } = await site(CONTENT);
    assert.equal((await cms.app.request('/?p=12')).status, 200);

    await writeTree(contentDir, {
      '_data/redirects/imported.json': redirects({ '/?p=12': '/2026/09/hello/' }),
    });
    assert.deepEqual(await redirectOf(cms, '/?p=12'), {
      status: 301,
      location: '/2026/09/hello/',
    });
  });

  it('reports a map entry whose target is not a string', async (t) => {
    const warn = t.mock.method(console, 'warn', () => undefined);
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects/imported.json': redirects({ '/a/': 7, '/b/': '/about/' }),
    });

    const reported = warn.mock.calls.map((call) => String(call.arguments[0])).join('\n');
    assert.match(reported, /imported\.json: entry 1 \("\/a\/"\) has a "to" of 7/);
    assert.equal((await cms.app.request('/a/')).status, 404);
    assert.equal((await redirectOf(cms, '/b/')).status, 301);
  });
});

describe('a declared redirect and what lives on the site', () => {
  it('never shadows a live document, a representation of one, or a route', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects.json': redirects([
        { from: '/about/', to: 'https://elsewhere.example/' },
        { from: '/2026/09/hello/', to: '/elsewhere/' },
        { from: '/about/index.md', to: '/elsewhere/' },
        { from: '/feed/', to: '/elsewhere/' },
        { from: '/about', to: '/elsewhere/' },
      ]),
    });

    assert.equal((await cms.app.request('/about/')).status, 200);
    assert.equal((await cms.app.request('/2026/09/hello/')).status, 200);
    assert.equal((await cms.app.request('/about/index.md')).status, 200);
    assert.equal((await cms.app.request('/feed/')).status, 200);
    // The URL without its slash is the live page's, and leads to it rather
    // than to what the file says.
    assert.deepEqual(await redirectOf(cms, '/about'), { status: 301, location: '/about/' });
  });

  it('is answered before the 404, and a URL nothing declares still 404s', async () => {
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects.json': redirects([{ from: '/gone/', to: '/about/' }]),
    });

    assert.equal((await cms.app.request('/gone/')).status, 301);
    assert.equal((await cms.app.request('/never-was/')).status, 404);
  });
});

describe('a redirect file with problems', () => {
  it('reports invalid entries and loops at boot and serves none of them', async (t) => {
    const warn = t.mock.method(console, 'warn', () => undefined);
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects.json': redirects([
        { from: '/fine/', to: '/about/' },
        { from: 'no-slash/', to: '/about/' },
        { from: '/no-target/' },
        { from: '/bad-status/', to: '/about/', status: 404 },
        { from: '/bad-scheme/', to: 'javascript:alert(1)' },
        { from: '/fine/', to: '/2026/09/hello/' },
        { from: '/ping/', to: '/pong/' },
        { from: '/pong/', to: '/ping/' },
        { from: '/self/', to: '/self/' },
        { from: '/into-loop/', to: '/ping/' },
      ]),
    });

    const reported = warn.mock.calls.map((call) => String(call.arguments[0])).join('\n');
    for (const source of [
      'no-slash/',
      '/no-target/',
      '/bad-status/',
      '/bad-scheme/',
      '/ping/',
      '/pong/',
      '/self/',
      '/into-loop/',
    ]) {
      assert.match(reported, new RegExp(source.replace(/[/]/g, '\\/')), `reports ${source}`);
      assert.equal(
        (await cms.app.request(source.startsWith('/') ? source : `/${source}`)).status,
        404,
      );
    }
    assert.match(reported, /\/fine\/.*more than once/);

    // The first declaration of a source is the one served.
    assert.deepEqual(await redirectOf(cms, '/fine/'), { status: 301, location: '/about/' });
  });

  it('reports a file that is not a list and serves nothing from it', async (t) => {
    const warn = t.mock.method(console, 'warn', () => undefined);
    const { cms } = await site({
      ...CONTENT,
      '_data/redirects.json': '{ "from": "/a/" ',
    });

    assert.equal(warn.mock.callCount() > 0, true);
    assert.match(String(warn.mock.calls[0]?.arguments[0]), /redirects\.json/);
    assert.equal((await cms.app.request('/a/')).status, 404);
  });

  it('says nothing about a site with no redirect file', async (t) => {
    const warn = t.mock.method(console, 'warn', () => undefined);
    const { cms } = await site(CONTENT);

    assert.equal((await cms.app.request('/gone/')).status, 404);
    assert.equal(
      warn.mock.calls.some((call) => String(call.arguments[0]).includes('redirects')),
      false,
    );
  });
});

describe('X-Redirect-By', () => {
  it('names the CMS on every kind of redirect it sends', async () => {
    const { cms } = await site({
      ...CONTENT,
      'posts/2026-09-01-moved.md': post('moved', 'redirect_from:\n  - /2026/09/was-here/\n'),
      '_data/redirects.json': redirects([
        { from: '/declared/', to: '/about/' },
        { from: '/?p=1', to: '/about/' },
      ]),
    });

    for (const url of [
      '/declared/',
      '/?p=1',
      '/2026/09/was-here/',
      '/about',
      '/page/1/',
      '/feed',
      '/search',
      '/admin/',
      '/admin',
    ]) {
      const response = await cms.app.request(url);
      assert.equal(Math.floor(response.status / 100), 3, `${url} redirects`);
      assert.equal(response.headers.get('x-redirect-by'), 'Geekity CMS', url);
    }

    const plain = await cms.app.request('/about/');
    assert.equal(plain.status, 200);
    assert.equal(plain.headers.get('x-redirect-by'), null);
  });
});
