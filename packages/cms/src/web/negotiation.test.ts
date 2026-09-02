import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';

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

/** A synced CMS over a content directory holding `files`, with the watcher off. */
async function site(
  files: Record<string, string>,
  config: GeekityConfig = {},
): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await temporaryDir('geekity-negotiate-content-');
  const dataDir = await temporaryDir('geekity-negotiate-data-');
  await writeTree(contentDir, files);

  const instance = createCms({
    contentDir,
    dataDir,
    watch: false,
    baseUrl: 'https://example.com',
    ...config,
  });
  started.push(instance);
  await instance.sync();
  return { cms: instance, contentDir };
}

/** The file text of the one post every test in here negotiates over. */
const HELLO_FILE = [
  '---',
  'title: Hello, World!',
  "date: '2026-09-02T09:00:00Z'",
  "updated: '2026-09-04T11:30:00Z'",
  'permalink: /2026/09/hello/',
  'tags:',
  '  - introductions',
  'description: The first post.',
  'series: notebook',
  '---',
  '',
  'A *file-first* CMS.',
  '',
].join('\n');

const HELLO = { 'posts/2026-09-02-hello.md': HELLO_FILE };

describe('the Markdown representation', () => {
  it('serves the stored file text, front matter included', async () => {
    const { cms } = await site(HELLO);

    const response = await cms.app.request('/2026/09/hello/', {
      headers: { accept: 'text/markdown' },
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/markdown;\s*charset=utf-8$/);
    assert.equal(body, HELLO_FILE);
  });
});

describe('the JSON representation', () => {
  it('serves schema, url, front matter, markdown and html', async () => {
    const { cms } = await site(HELLO);

    const response = await cms.app.request('/2026/09/hello/', {
      headers: { accept: 'application/json' },
    });
    const body: unknown = await response.json();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.deepEqual(body, {
      schema: 1,
      url: 'https://example.com/2026/09/hello/',
      frontMatter: {
        title: 'Hello, World!',
        date: '2026-09-02T09:00:00Z',
        updated: '2026-09-04T11:30:00Z',
        permalink: '/2026/09/hello/',
        tags: ['introductions'],
        description: 'The first post.',
        series: 'notebook',
      },
      markdown: 'A *file-first* CMS.',
      html: '<p>A <em>file-first</em> CMS.</p>\n',
    });
  });
});

describe('the extension escape hatch', () => {
  it('beats Accept, on both the index.ext and the bare .ext spelling', async () => {
    const { cms } = await site(HELLO);

    for (const url of ['/2026/09/hello/index.md', '/2026/09/hello.md']) {
      const response = await cms.app.request(url, { headers: { accept: 'text/html' } });
      assert.equal(response.status, 200, `${url} resolves`);
      assert.match(
        response.headers.get('content-type') ?? '',
        /^text\/markdown/,
        `${url} is Markdown despite Accept: text/html`,
      );
      assert.equal(await response.text(), HELLO_FILE);
    }

    for (const url of ['/2026/09/hello/index.json', '/2026/09/hello.json']) {
      const response = await cms.app.request(url, { headers: { accept: 'text/markdown' } });
      assert.equal(response.status, 200, `${url} resolves`);
      assert.match(
        response.headers.get('content-type') ?? '',
        /^application\/json/,
        `${url} is JSON despite Accept: text/markdown`,
      );
      const body = (await response.json()) as { url: string };
      assert.equal(body.url, 'https://example.com/2026/09/hello/');
    }
  });

  it('leaves a path that merely contains a dot alone', async () => {
    const { cms } = await site({
      'pages/notes.md': [
        '---',
        'title: Notes',
        'permalink: /notes.txt/',
        '---',
        '',
        'Still a page.',
        '',
      ].join('\n'),
    });

    const response = await cms.app.request('/notes.txt/');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  });

  it('404s an extension on a path no document claims', async () => {
    const { cms } = await site(HELLO);

    for (const url of ['/nothing-here.md', '/nothing-here/index.json']) {
      assert.equal((await cms.app.request(url)).status, 404, `${url} is not found`);
    }
  });
});

describe('choosing from Accept', () => {
  it('gives HTML to a request that expresses no preference', async () => {
    const { cms } = await site(HELLO);

    for (const headers of [
      {},
      { accept: '*/*' },
      { accept: '' },
      { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    ]) {
      const response = await cms.app.request('/2026/09/hello/', { headers });
      assert.equal(response.status, 200, 'the document is served');
      assert.match(
        response.headers.get('content-type') ?? '',
        /^text\/html/,
        `${JSON.stringify(headers)} gets HTML`,
      );
    }
  });

  it('honours q-values rather than header order', async () => {
    const { cms } = await site(HELLO);

    for (const [accept, expected] of [
      ['text/html;q=0.5, text/markdown;q=0.9', /^text\/markdown/],
      ['application/json;q=0.2, text/html;q=0.3', /^text\/html/],
      ['text/*', /^text\/html/],
      ['application/*', /^application\/json/],
      ['text/html;q=0, application/json', /^application\/json/],
    ] as const) {
      const response = await cms.app.request('/2026/09/hello/', { headers: { accept } });
      assert.match(response.headers.get('content-type') ?? '', expected, accept);
    }
  });

  it('406s a request that accepts nothing on offer, and lists the alternates', async () => {
    const { cms } = await site(HELLO);

    const response = await cms.app.request('/2026/09/hello/', {
      headers: { accept: 'image/png, application/pdf' },
    });
    const body: unknown = await response.json();

    assert.equal(response.status, 406);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(response.headers.get('vary'), 'Accept');
    assert.deepEqual((body as { alternates: unknown }).alternates, [
      { type: 'text/html', url: '/2026/09/hello/' },
      { type: 'text/markdown', url: '/2026/09/hello/index.md' },
      { type: 'application/json', url: '/2026/09/hello/index.json' },
    ]);
  });

  it('406s when every acceptable type is refused with q=0', async () => {
    const { cms } = await site(HELLO);

    const response = await cms.app.request('/2026/09/hello/', {
      headers: { accept: '*/*;q=0' },
    });

    assert.equal(response.status, 406);
  });
});

describe('validators and alternates', () => {
  it('advertises Vary and the other representations on every representation', async () => {
    const { cms } = await site(HELLO);

    for (const [accept, expected] of [
      [
        'text/html',
        '</2026/09/hello/index.md>; rel="alternate"; type="text/markdown", </2026/09/hello/index.json>; rel="alternate"; type="application/json"',
      ],
      [
        'text/markdown',
        '</2026/09/hello/>; rel="alternate"; type="text/html", </2026/09/hello/index.json>; rel="alternate"; type="application/json"',
      ],
      [
        'application/json',
        '</2026/09/hello/>; rel="alternate"; type="text/html", </2026/09/hello/index.md>; rel="alternate"; type="text/markdown"',
      ],
    ] as const) {
      const response = await cms.app.request('/2026/09/hello/', { headers: { accept } });
      assert.equal(response.headers.get('vary'), 'Accept', `${accept} varies on Accept`);
      assert.equal(response.headers.get('link'), expected, `${accept} links its alternates`);
    }
  });

  it('gives each representation its own ETag and a Last-Modified from updated', async () => {
    const { cms } = await site(HELLO);
    const etags = new Set<string>();

    for (const accept of ['text/html', 'text/markdown', 'application/json']) {
      const response = await cms.app.request('/2026/09/hello/', { headers: { accept } });
      const etag = response.headers.get('etag');

      assert.ok(etag !== null, `${accept} carries an ETag`);
      assert.match(etag, /^"[0-9a-f]{32}"$/, `${accept} has a quoted hex ETag`);
      etags.add(etag);
      assert.equal(
        response.headers.get('last-modified'),
        new Date('2026-09-04T11:30:00Z').toUTCString(),
        `${accept} reports the updated date`,
      );
    }

    assert.equal(etags.size, 3, 'the three representations do not share a validator');
  });

  it('answers 304 with an empty body when If-None-Match still matches', async () => {
    const { cms } = await site(HELLO);

    for (const accept of ['text/html', 'text/markdown', 'application/json']) {
      const first = await cms.app.request('/2026/09/hello/', { headers: { accept } });
      const etag = first.headers.get('etag') ?? '';

      const second = await cms.app.request('/2026/09/hello/', {
        headers: { accept, 'if-none-match': etag },
      });

      assert.equal(second.status, 304, `${accept} revalidates to 304`);
      assert.equal(await second.text(), '', `${accept} sends no body`);
      assert.equal(second.headers.get('etag'), etag, `${accept} repeats the validator`);
      assert.equal(second.headers.get('vary'), 'Accept');
    }
  });

  it('does not honour one representation ETag for another', async () => {
    const { cms } = await site(HELLO);
    const markdown = await cms.app.request('/2026/09/hello/', {
      headers: { accept: 'text/markdown' },
    });

    const response = await cms.app.request('/2026/09/hello/', {
      headers: { accept: 'application/json', 'if-none-match': markdown.headers.get('etag') ?? '' },
    });

    assert.equal(response.status, 200);
  });

  it('answers 304 to a fresh If-Modified-Since and 200 to a stale one', async () => {
    const { cms } = await site(HELLO);

    const fresh = await cms.app.request('/2026/09/hello/', {
      headers: {
        accept: 'text/markdown',
        'if-modified-since': new Date('2026-09-05T00:00:00Z').toUTCString(),
      },
    });
    assert.equal(fresh.status, 304);

    const stale = await cms.app.request('/2026/09/hello/', {
      headers: {
        accept: 'text/markdown',
        'if-modified-since': new Date('2026-09-03T00:00:00Z').toUTCString(),
      },
    });
    assert.equal(stale.status, 200);
  });

  it('withholds the HTML validator while the watcher is on, because the theme can change', async () => {
    const { cms } = await site(HELLO, { watch: true });

    const html = await cms.app.request('/2026/09/hello/', { headers: { accept: 'text/html' } });
    const markdown = await cms.app.request('/2026/09/hello/', {
      headers: { accept: 'text/markdown' },
    });

    assert.equal(html.headers.get('etag'), null, 'no HTML validator in a watching server');
    assert.ok(markdown.headers.get('etag') !== null, 'the file representation still has one');
  });
});

/** A post file, for the listing tests. */
function post(title: string, date: string, permalink: string, tags: string[] = []): string {
  const tagLines = tags.length === 0 ? '' : `tags:\n${tags.map((t) => `  - ${t}`).join('\n')}\n`;
  return `---\ntitle: ${title}\ndate: '${date}'\npermalink: ${permalink}\n${tagLines}---\n\nBody of ${title}.\n`;
}

const ARCHIVE = {
  '_data/site.json': JSON.stringify({ title: 'Archive', postsPerPage: 2 }),
  'posts/one.md': post('One', '2026-09-03T09:00:00Z', '/one/', ['notes']),
  'posts/two.md': post('Two', '2026-09-02T09:00:00Z', '/two/', ['notes']),
  'posts/three.md': post('Three', '2026-09-01T09:00:00Z', '/three/'),
  'posts/hidden.md': `---\ntitle: Hidden\ndate: '2026-09-04T09:00:00Z'\npermalink: /hidden/\ndraft: true\n---\n\nNo.\n`,
};

describe('listings', () => {
  it('serves an array of summaries with no markdown or html', async () => {
    const { cms } = await site(ARCHIVE);

    const response = await cms.app.request('/', { headers: { accept: 'application/json' } });
    const body: unknown = await response.json();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.deepEqual(body, [
      {
        schema: 1,
        url: 'https://example.com/one/',
        frontMatter: {
          title: 'One',
          date: '2026-09-03T09:00:00Z',
          permalink: '/one/',
          tags: ['notes'],
        },
      },
      {
        schema: 1,
        url: 'https://example.com/two/',
        frontMatter: {
          title: 'Two',
          date: '2026-09-02T09:00:00Z',
          permalink: '/two/',
          tags: ['notes'],
        },
      },
    ]);
  });

  it('includes markdown and html when ?full=1 asks for them', async () => {
    const { cms } = await site(ARCHIVE);

    const response = await cms.app.request('/?full=1', {
      headers: { accept: 'application/json' },
    });
    const body = (await response.json()) as { markdown?: string; html?: string }[];

    assert.equal(body.length, 2);
    assert.equal(body[0]?.markdown, 'Body of One.');
    assert.equal(body[0]?.html, '<p>Body of One.</p>\n');
  });

  it('negotiates later pages and tag archives too', async () => {
    const { cms } = await site(ARCHIVE);

    const second = (await (
      await cms.app.request('/page/2/', { headers: { accept: 'application/json' } })
    ).json()) as { url: string }[];
    assert.deepEqual(
      second.map((item) => item.url),
      ['https://example.com/three/'],
    );

    const tagged = (await (
      await cms.app.request('/tags/notes/', { headers: { accept: 'application/json' } })
    ).json()) as { url: string }[];
    assert.deepEqual(
      tagged.map((item) => item.url),
      ['https://example.com/one/', 'https://example.com/two/'],
    );
  });

  it('answers the .json extension on a listing URL', async () => {
    const { cms } = await site(ARCHIVE);

    for (const url of ['/index.json', '/page/2/index.json', '/tags/notes/index.json']) {
      const response = await cms.app.request(url, { headers: { accept: 'text/html' } });
      assert.equal(response.status, 200, `${url} resolves`);
      assert.match(response.headers.get('content-type') ?? '', /^application\/json/, url);
      assert.ok(Array.isArray(await response.json()), `${url} is an array`);
    }
  });

  it('offers HTML and JSON only, so Markdown alone is a 406', async () => {
    const { cms } = await site(ARCHIVE);

    const response = await cms.app.request('/', { headers: { accept: 'text/markdown' } });
    const body = (await response.json()) as { alternates: unknown };

    assert.equal(response.status, 406);
    assert.deepEqual(body.alternates, [
      { type: 'text/html', url: '/' },
      { type: 'application/json', url: '/index.json' },
    ]);
  });

  it('links only the JSON alternate from a listing, and revalidates', async () => {
    const { cms } = await site(ARCHIVE);

    const response = await cms.app.request('/tags/notes/', {
      headers: { accept: 'application/json' },
    });
    const etag = response.headers.get('etag') ?? '';

    assert.equal(response.headers.get('vary'), 'Accept');
    assert.equal(response.headers.get('link'), '</tags/notes/>; rel="alternate"; type="text/html"');
    assert.match(etag, /^"[0-9a-f]{32}"$/);

    const again = await cms.app.request('/tags/notes/', {
      headers: { accept: 'application/json', 'if-none-match': etag },
    });
    assert.equal(again.status, 304);

    const full = await cms.app.request('/tags/notes/?full=1', {
      headers: { accept: 'application/json', 'if-none-match': etag },
    });
    assert.equal(full.status, 200, 'a fuller body is a different entity');
  });

  it('still renders HTML for a listing when nothing else is asked for', async () => {
    const { cms } = await site(ARCHIVE);

    const response = await cms.app.request('/');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    assert.ok((await response.text()).includes('href="/one/"'));
  });
});
