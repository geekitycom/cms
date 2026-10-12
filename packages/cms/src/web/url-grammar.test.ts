import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { createUser } from '../site/users.ts';

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

function post(slug: string, day: string, front = ''): string {
  return (
    `---\ntitle: Post ${slug}\ndate: '2026-09-${day}T09:00:00Z'\n` +
    `permalink: /2026/09/${slug}/\ntags:\n  - shared\n${front}---\n\nBody of ${slug}.\n`
  );
}

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site', postsPerPage: 2 }),
  'posts/one.md': post('one', '01'),
  'posts/two.md': post('two', '02'),
  'posts/three.md': post('three', '03', 'redirect_from:\n  - /old-three/\n'),
  'pages/carried.md': '---\ntitle: Carried\npermalink: /tag/shared/\n---\n\nShadowed page.\n',
  'pages/uncarried.md': '---\ntitle: Uncarried\npermalink: /tag/lonely/\n---\n\nA page.\n',
  'pages/nobody.md': '---\ntitle: Nobody\npermalink: /author/nobody/\n---\n\nNot a person.\n',
};

async function site(files: Record<string, string> = CONTENT): Promise<Cms> {
  const contentDir = await temporaryDir('geekity-grammar-content-');
  const dataDir = await temporaryDir('geekity-grammar-data-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  const instance = createCms({ contentDir, dataDir, watch: false });
  started.push(instance);
  await instance.sync();
  return instance;
}

async function answer(cms: Cms, url: string): Promise<[number, string | null]> {
  const response = await cms.app.request(url);
  return [response.status, response.headers.get('location')];
}

describe('a path more than one thing could answer', () => {
  it('is the archive while a post carries the term, and the page otherwise', async () => {
    const cms = await site();

    const archive = await (await cms.app.request('/tag/shared/')).text();
    assert.ok(archive.includes('/2026/09/three/'));
    assert.equal(archive.includes('Shadowed page.'), false);

    const lonely = await cms.app.request('/tag/lonely/');
    assert.equal(lonely.status, 200);
    assert.ok((await lonely.text()).includes('A page.'));
  });

  it('is a page under the author base when the username is nobody’s', async () => {
    const cms = await site();
    const response = await cms.app.request('/author/nobody/');
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('Not a person.'));
  });
});

describe('a listing page past the end', () => {
  it('404s with or without its slash, and in any representation', async () => {
    const cms = await site();
    assert.deepEqual(await answer(cms, '/tag/shared/page/2/'), [200, null]);
    assert.deepEqual(await answer(cms, '/tag/shared/page/3/'), [404, null]);
    assert.deepEqual(await answer(cms, '/tag/shared/page/3'), [404, null]);
    assert.deepEqual(await answer(cms, '/tag/shared/page/3/index.json'), [404, null]);
    assert.deepEqual(await answer(cms, '/author/ada/page/9/'), [404, null]);
  });

  it('redirects a page in range that arrived without its slash', async () => {
    const cms = await site();
    assert.deepEqual(await answer(cms, '/tag/shared/page/2'), [301, '/tag/shared/page/2/']);
    assert.deepEqual(await answer(cms, '/tag/shared/page/1/'), [301, '/tag/shared/']);
    assert.deepEqual(await answer(cms, '/author/ada/page/1/'), [301, '/author/ada/']);
  });
});

describe('an extension on a listing', () => {
  it('serves the listing’s Markdown and JSON, and sends the short spelling to index', async () => {
    const cms = await site();

    const markdown = await cms.app.request('/tag/shared/index.md');
    assert.equal(markdown.status, 200);
    assert.match(markdown.headers.get('content-type') ?? '', /text\/markdown/);

    const json = await cms.app.request('/tag/shared/page/2/index.json');
    assert.equal(json.status, 200);
    assert.match(json.headers.get('content-type') ?? '', /application\/json/);

    assert.deepEqual(await answer(cms, '/tag/shared.md'), [301, '/tag/shared/index.md']);
    assert.deepEqual(await answer(cms, '/author/ada.json'), [301, '/author/ada/index.json']);
    assert.deepEqual(await answer(cms, '/tag/nothing/index.md'), [404, null]);
  });

  it('serves a page’s Markdown at a term nothing carries', async () => {
    const cms = await site();
    const response = await cms.app.request('/tag/lonely/index.md');
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('A page.'));
  });
});

describe('a moved permalink', () => {
  it('leads to where the document lives now, in the representation asked for', async () => {
    const cms = await site();
    assert.deepEqual(await answer(cms, '/old-three/'), [301, '/2026/09/three/']);
    assert.deepEqual(await answer(cms, '/old-three'), [301, '/2026/09/three/']);
    assert.deepEqual(await answer(cms, '/old-three/index.md'), [301, '/2026/09/three/index.md']);
    assert.deepEqual(await answer(cms, '/old-three.json'), [301, '/2026/09/three/index.json']);
  });
});

describe('a feed spelled another way', () => {
  it('lands on the canonical feed in one hop', async () => {
    const cms = await site();
    assert.deepEqual(await answer(cms, '/tag/shared/feed'), [301, '/tag/shared/feed/']);
    assert.deepEqual(await answer(cms, '/tag/shared/feed/rss/'), [301, '/tag/shared/feed/']);
    assert.deepEqual(await answer(cms, '/tag/SHARED/feed/atom/'), [301, '/tag/shared/feed/atom/']);
    assert.deepEqual(await answer(cms, '/tag/shared/page/2/feed/'), [404, null]);
    assert.deepEqual(await answer(cms, '/author/ada/feed/rss/'), [301, '/author/ada/feed/']);
  });
});

describe('one grammar for every representation', () => {
  it('answers the archive’s Markdown where a page is shadowed by the archive', async () => {
    const cms = await site();
    const response = await cms.app.request('/tag/shared/index.md');
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes('/2026/09/three/index.md'), 'the archive lists its posts');
    assert.equal(body.includes('Shadowed page.'), false, 'the page does not leak through');
  });

  it('embeds no page that an archive shadows', async () => {
    const cms = await site();
    const url = encodeURIComponent('http://localhost:3000/tag/shared/');
    assert.equal((await cms.app.request(`/_geekity/oembed?url=${url}`)).status, 404);
  });

  it('sends a listing’s representation to the canonical spelling of the listing', async () => {
    const cms = await site();
    assert.deepEqual(await answer(cms, '/tag/SHARED/index.md'), [301, '/tag/shared/index.md']);
    assert.deepEqual(await answer(cms, '/tag/shared/page/1/index.json'), [
      301,
      '/tag/shared/index.json',
    ]);
  });

  it('keeps the query on every canonical redirect of a listing', async () => {
    const cms = await site();
    assert.deepEqual(await answer(cms, '/author/ada/page/1/?full=1'), [301, '/author/ada/?full=1']);
    assert.deepEqual(await answer(cms, '/tag/SHARED/?full=1'), [301, '/tag/shared/?full=1']);
  });
});

describe('the home listing’s pages on a site with a posts page', () => {
  const files = {
    ...CONTENT,
    '_data/site.json': JSON.stringify({
      title: 'A Site',
      postsPerPage: 2,
      homepage: 'welcome',
      postsPage: 'news',
    }),
    'pages/welcome.md': '---\ntitle: Welcome\npermalink: /welcome/\n---\n\nHello.\n',
    'pages/news.md': '---\ntitle: News\npermalink: /news/\n---\n\nNews.\n',
  };

  it('lands on the posts page’s pages in one hop, in every spelling', async () => {
    const cms = await site(files);
    assert.deepEqual(await answer(cms, '/page/2/'), [301, '/news/page/2/']);
    assert.deepEqual(await answer(cms, '/page/2'), [301, '/news/page/2/']);
    assert.deepEqual(await answer(cms, '/page/1/'), [301, '/news/']);
    assert.deepEqual(await answer(cms, '/page/2/index.json'), [301, '/news/page/2/index.json']);
    assert.deepEqual(await answer(cms, '/news/page/1/index.md'), [301, '/news/index.md']);
  });
});
