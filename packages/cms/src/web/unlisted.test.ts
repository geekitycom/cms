import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser } from '../admin/accounts.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const BASE_URL = 'https://blog.example';

const box = sandbox();
after(() => box.cleanup());

function post(slug: string, date: string, extra = ''): string {
  return [
    '---',
    `title: ${slug}`,
    `date: '${date}'`,
    `permalink: /${slug}/`,
    'author: ada',
    'tags:',
    '  - quiet-things',
    'categories:',
    '  - notes',
    extra,
    '---',
    '',
    `The ${slug} post, about lanterns.`,
    '',
  ].join('\n');
}

function comments(slug: string): string {
  return JSON.stringify({
    post: `/${slug}/`,
    comments: [
      {
        id: `01994c7a-0000-7000-8000-0000000${slug.length}ada0`,
        source: 'comment',
        kind: 'reply',
        status: 'approved',
        author: { name: 'Grace', url: 'https://grace.example/', email: 'grace@example.com' },
        content: { markdown: `On ${slug}.`, html: `<p>On ${slug}.</p>\n` },
        submitted: '2026-09-05T10:00:00.000Z',
        addressHash: '0123456789abcdef0123456789abcdef',
        inReplyTo: null,
      },
    ],
  });
}

async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-unlisted-content-');
  const dataDir = await box.dir('geekity-unlisted-data-');
  const files: Record<string, string> = {
    'posts/2026-09-01-older.md': post('older', '2026-09-01T09:00:00Z'),
    'posts/2026-09-02-hushed.md': post('hushed', '2026-09-02T09:00:00Z', 'visibility: unlisted'),
    'posts/2026-09-03-newer.md': post('newer', '2026-09-03T09:00:00Z'),
    'posts/2026-09-02-secret.md': post(
      'secret',
      '2026-09-02T12:00:00Z',
      'visibility: private\nredirect_from:\n  - /old-secret/',
    ),
    'pages/hidden-page.md':
      '---\ntitle: Hidden page\npermalink: /hidden-page/\nvisibility: unlisted\n---\n\nLanterns.\n',
    '_data/comments/hushed.json': comments('hushed'),
    '_data/comments/newer.json': comments('newer'),
    'pages/archive.md': '---\ntitle: Archive\npermalink: /archive/\narchive: true\n---\n\nAll.\n',
  };
  for (const [relative, source] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source, 'utf8');
  }
  await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  return await box.open({ contentDir, dataDir, baseUrl: BASE_URL });
}

async function body(cms: Cms, url: string): Promise<string> {
  const response = await cms.app.request(url);
  assert.equal(response.status, 200, `${url} answers 200`);
  return await response.text();
}

describe('an unlisted post (AC #2)', () => {
  it('is served at its URL with a noindex robots meta and header', async () => {
    const cms = await site();
    const response = await cms.app.request('/hushed/');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex', 'the header says noindex');
    assert.match(await response.text(), /<meta name="robots" content="noindex">/);
    assert.equal((await cms.app.request('/hidden-page/')).status, 200, 'an unlisted page too');
  });

  it('leaves a listed post indexable', async () => {
    const cms = await site();
    const response = await cms.app.request('/newer/');

    assert.equal(response.headers.get('x-robots-tag'), null);
    assert.doesNotMatch(await response.text(), /name="robots"/);
  });

  it('is absent from every listing, feed, index and neighbour link', async () => {
    const cms = await site();
    const surfaces = [
      '/',
      '/tag/quiet-things/',
      '/category/notes/',
      '/author/ada/',
      '/archive/',
      '/feed/',
      '/feed/atom/',
      '/feed/json/',
      '/tag/quiet-things/feed/',
      '/category/notes/feed/',
      '/author/ada/feed/',
      '/sitemap.xml',
      '/search/?q=lanterns',
      '/search/index.json?q=lanterns',
      '/index.json',
      '/llms.txt',
      '/comments/feed/',
      '/older/',
      '/newer/',
    ];
    for (const url of surfaces) {
      const text = await body(cms, url);
      assert.ok(!/hushed|hidden-page/.test(text), `${url} leaves the unlisted documents out`);
      assert.ok(!/secret/.test(text), `${url} leaves the unrecognized-visibility post out`);
    }
    assert.match(await body(cms, '/'), /\/newer\//, 'the home page still lists a listed post');
    assert.match(await body(cms, '/sitemap.xml'), /\/older\//, 'the sitemap still lists one');
    assert.match(
      await body(cms, '/comments/feed/'),
      /On newer\./,
      'the comments feed still has one',
    );
  });
});

describe('a post whose visibility the site does not recognize', () => {
  it('is not served at its URL, in any representation, or at a URL it used to live at', async () => {
    const cms = await site();
    for (const url of ['/secret/', '/secret/index.md', '/secret/index.json', '/old-secret/']) {
      assert.equal((await cms.app.request(url)).status, 404, `${url} answers 404`);
    }
    const activity = await cms.app.request('/secret/', {
      headers: { accept: 'application/activity+json' },
    });
    assert.equal(activity.status, 404, 'and no ActivityStreams object is served for it');
  });
});
