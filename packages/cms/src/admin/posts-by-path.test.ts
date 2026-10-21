import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PostAtPath } from '../plugin.ts';
import { TEN_AM_20_OCTOBER_IN_CHICAGO } from './__testing__/chicago-clock.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

const POSTS = {
  'alpha.md':
    "---\ntitle: Alpha\ndate: '2026-10-01T09:00:00Z'\npermalink: /2026/10/alpha/\n---\n\nWords.\n",
  'bravo.md':
    "---\ntitle: Bravo\ndate: '2026-10-02T09:00:00Z'\npermalink: /2026/10/bravo/\n---\n\nWords.\n",
  'note.md': "---\ndate: '2026-10-03T09:00:00Z'\npermalink: /2026/10/note/\n---\n\nA short note.\n",
  'draft.md':
    "---\ntitle: Draft\ndate: '2026-10-04T09:00:00Z'\npermalink: /2026/10/draft/\ndraft: true\n---\n\nWords.\n",
  'later.md':
    "---\ntitle: Later\ndate: '2026-12-01T09:00:00Z'\npermalink: /2026/12/later/\n---\n\nWords.\n",
};

function asking(paths: readonly string[], reached: (readonly PostAtPath[])[]): Plugin {
  return definePlugin({
    name: '@acme/plugin-paths',
    version: '1.0.0',
    label: 'Paths',
    description: 'Names the posts at some paths.',
    hostApi: HOST_API_VERSION,
    register(host) {
      host.widget({
        id: 'paths',
        title: 'Paths',
        width: 'half',
        refreshSeconds: 0,
        async load() {
          reached.push(await host.use('@geekity/cms/posts').byPath(paths));
          return [];
        },
      });
    },
  });
}

async function postsAt(paths: readonly string[], baseUrl = 'https://blog.example') {
  const reached: (readonly PostAtPath[])[] = [];
  const plugin = asking(paths, reached);
  const contentDir = await box.dir('geekity-posts-by-path-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await mkdir(path.join(contentDir, 'pages'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', plugins: { [plugin.name]: { enabled: true } } }),
  );
  for (const [file, body] of Object.entries(POSTS)) {
    await writeFile(path.join(contentDir, 'posts', file), body);
  }
  await writeFile(
    path.join(contentDir, 'pages', 'about.md'),
    '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
  );
  const cms = await box.site({
    contentDir,
    baseUrl,
    now: () => TEN_AM_20_OCTOBER_IN_CHICAGO,
    plugins: [plugin],
  });
  const response = await (await signedIn(cms)).get('/admin');
  assert.equal(response.status, 200);
  const [posts] = reached;
  assert.ok(posts !== undefined, 'the widget asked for the posts');
  return posts;
}

describe('the posts core service', () => {
  it('names the post at each path, with its permalink and editor, in the order asked', async () => {
    const posts = await postsAt(['/2026/10/bravo/', '/', '/2026/10/alpha/', '/nowhere/']);
    assert.deepEqual(posts, [
      {
        path: '/2026/10/bravo/',
        permalink: '/2026/10/bravo/',
        title: 'Bravo',
        editUrl: '/admin/posts/bravo',
      },
      {
        path: '/2026/10/alpha/',
        permalink: '/2026/10/alpha/',
        title: 'Alpha',
        editUrl: '/admin/posts/alpha',
      },
    ]);
  });

  it('matches a path without its trailing slash or with a query string or fragment', async () => {
    const posts = await postsAt([
      '/2026/10/alpha',
      '/2026/10/bravo/?utm_source=mastodon',
      '/2026/10/alpha/#comments',
    ]);
    assert.deepEqual(
      posts.map(({ path: asked, permalink }) => [asked, permalink]),
      [
        ['/2026/10/alpha', '/2026/10/alpha/'],
        ['/2026/10/bravo/?utm_source=mastodon', '/2026/10/bravo/'],
        ['/2026/10/alpha/#comments', '/2026/10/alpha/'],
      ],
    );
  });

  it('gives an untitled post the label the admin gives it', async () => {
    const [note] = await postsAt(['/2026/10/note/']);
    assert.equal(note?.title, 'A short note.');
  });

  it('leaves out pages, drafts and posts not yet published', async () => {
    assert.deepEqual(await postsAt(['/about/', '/2026/10/draft/', '/2026/12/later/']), []);
  });

  it('takes the base URL directory off a path, as a page view on the site records it', async () => {
    const posts = await postsAt(
      ['/blog/2026/10/alpha/', '/2026/10/bravo/'],
      'https://example.com/blog/',
    );
    assert.deepEqual(
      posts.map(({ path: asked, permalink }) => [asked, permalink]),
      [['/blog/2026/10/alpha/', '/2026/10/alpha/']],
    );
  });
});
