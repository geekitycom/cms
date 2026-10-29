import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { TestContext } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { RECHECK_MS } from '../maintenance.ts';
import { setUserProfile } from '../site/users.ts';
import { createUser } from './__testing__/users.ts';

const box = sandbox();
after(() => box.cleanup());

const GEMINI = 'text/gemini; charset=utf-8';
const NOW = Date.parse('2026-09-28T12:00:00Z');
const COMMENT = '00000000000000a1';

function post(slug: string, day: string, body: string, extra: string[] = []): string {
  return [
    '---',
    `title: Post ${slug}`,
    `date: '2026-09-${day}T09:00:00Z'`,
    `permalink: /2026/09/${slug}/`,
    'author: ada',
    'tags: [notes]',
    'categories: [Field]',
    ...extra,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

const MIDDLE_BODY = [
  'See [one](/2026/09/one/#part), *really* [three](https://example.com/2026/09/three/) and',
  '[the old two](/old-two/), [about](/about/) and **[elsewhere](https://elsewhere.example/one/)**.',
  '',
  '![a photo](/uploads/photo.jpg)',
  '',
  'Some `code` and <b>raw HTML</b>.',
].join('\n');

const FILES: Record<string, string> = {
  'posts/2026-09-01-one.md': post('one', '01', 'The first.'),
  'posts/2026-09-02-two.md': post('two', '02', MIDDLE_BODY, ['redirect_from:', '  - /old-two/']),
  'posts/2026-09-03-three.md': post('three', '03', 'The third.'),
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nWho writes this.\n',
  'pages/archive.md':
    '---\ntitle: Archive\npermalink: /archive/\narchive: true\n---\n\nAll of it.\n',
  '_trash/posts/2026-09-04-gone.md': post('gone', '04', 'Deleted.'),
  '_data/comments/one.json': JSON.stringify({
    post: '/2026/09/one/',
    comments: [
      {
        id: COMMENT,
        source: 'comment',
        kind: 'reply',
        status: 'approved',
        author: { name: 'Grace', url: null, email: null, avatar: null },
        content: { markdown: 'Well *said*.', html: '<p>Well <em>said</em>.</p>' },
        submitted: '2026-09-03T10:00:00.000Z',
        addressHash: null,
        inReplyTo: null,
        url: null,
        notify: false,
      },
    ],
  }),
};

const SITE = {
  title: 'Field *Notes*',
  tagline: 'Notes from the field.',
  author: 'ada',
  postsPerPage: 2,
  menus: {
    primary: [
      { label: 'About', url: '/about/' },
      { label: 'Search', url: '/search/' },
    ],
    footer: [{ label: 'Mastodon', url: 'https://mastodon.example/@ada' }],
  },
};

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

async function site(settings: Record<string, unknown> = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-gmi-content-');
  const dataDir = await box.dir('geekity-gmi-data-');
  await writeTree(contentDir, {
    ...FILES,
    '_data/site.json': JSON.stringify({ ...SITE, ...settings }),
  });
  const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  await setUserProfile({ dataDir, userId: ada.id, profile: { displayName: 'Ada Lovelace' } });
  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://example.com',
    now: () => new Date(clock),
  });
  cms.app.get('/broken/*', () => {
    throw new Error('the store fell over');
  });
  return cms;
}

let clock = NOW;
let cms: Cms;

before(async () => {
  cms = await site();
});

async function gemtext(url: string, init?: RequestInit): Promise<string> {
  const response = await cms.app.request(url, init);
  assert.equal(response.status, 200, `GET ${url} answered ${String(response.status)}`);
  assert.equal(response.headers.get('content-type'), GEMINI, url);
  return response.text();
}

function linesOf(text: string): string[] {
  return text.split('\n');
}

function assertClean(text: string, url: string): void {
  assert.doesNotMatch(text, /^---\n/, `${url} opens with front matter`);
  assert.doesNotMatch(text, /\]\(|\]\[|<https?:/, `${url} has an inline link`);
  assert.doesNotMatch(text, /\*\*|__|`[^`\n]+`|<\/?[a-z]+>/, `${url} has inline markup`);
  for (const line of linesOf(text).filter((line) => line.startsWith('=>'))) {
    assert.match(line, /^=> \S+( .+)?$/, `${url}: ${line}`);
  }
}

describe('a page at its .gmi URL (AC #1)', () => {
  it('answers a post, a page and the homepage with text/gemini', async () => {
    for (const url of ['/2026/09/two/index.gmi', '/about/index.gmi', '/index.gmi']) {
      assertClean(await gemtext(url), url);
    }
  });

  it('answers the short spelling with a 301 to the index.gmi URL, query kept', async () => {
    const response = await cms.app.request('/2026/09/two.gmi?ref=feed');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/2026/09/two/index.gmi?ref=feed');
  });

  it('sends a former URL’s .gmi on to the document’s', async () => {
    const response = await cms.app.request('/old-two/index.gmi');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/2026/09/two/index.gmi');
  });

  it('serves a static homepage at /index.gmi', async () => {
    const homepage = await site({ homepage: 'about' });
    const response = await homepage.app.request('/index.gmi');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /^Who writes this\.$/m);
  });

  it('writes the title as a heading and the date as a line, with no front matter', async () => {
    const text = await gemtext('/2026/09/two/index.gmi');
    assert.match(text, /^# Post two\n/);
    assert.match(text, /^Published 2026-09-02$/m);
  });
});

describe('links that stay in the Gemini web (AC #2)', () => {
  it('points the body’s links to the site’s pages at their .gmi, and leaves others alone', async () => {
    const lines = linesOf(await gemtext('/2026/09/two/index.gmi'));
    for (const line of [
      '=> /2026/09/one/index.gmi#part 1: /2026/09/one/index.gmi#part',
      '=> /2026/09/three/index.gmi 2: /2026/09/three/index.gmi',
      '=> /2026/09/two/index.gmi 3: /2026/09/two/index.gmi',
      '=> /about/index.gmi 4: /about/index.gmi',
      '=> https://elsewhere.example/one/ 5: https://elsewhere.example/one/',
      '=> /uploads/photo.jpg a photo [IMG]',
    ]) {
      assert.ok(lines.includes(line), `missing ${line}`);
    }
  });

  it('points the chrome’s links at .gmi: byline, terms, neighbours, menus and home', async () => {
    const lines = linesOf(await gemtext('/2026/09/two/index.gmi'));
    for (const line of [
      '=> /author/ada/index.gmi Written by Ada Lovelace',
      '=> /category/Field/index.gmi Category: Field',
      '=> /tag/notes/index.gmi Tag: notes',
      '=> /2026/09/one/index.gmi Previous: Post one',
      '=> /2026/09/three/index.gmi Next: Post three',
      '=> /about/index.gmi About',
      '=> /search/index.gmi Search',
      '=> https://mastodon.example/@ada Mastodon',
      '=> /index.gmi Home',
    ]) {
      assert.ok(lines.includes(line), `missing ${line}`);
    }
  });
});

describe('listings as gemfeeds (AC #3)', () => {
  it('lists the latest posts as => url YYYY-MM-DD title, with the pager', async () => {
    const text = await gemtext('/index.gmi');
    assert.match(text, /^# Field \*Notes\*\n/);
    assert.match(
      text,
      /^=> \/2026\/09\/three\/index\.gmi 2026-09-03 Post three\n=> \/2026\/09\/two\/index\.gmi 2026-09-02 Post two$/m,
    );
    assert.match(text, /^=> \/page\/2\/index\.gmi Older posts$/m);

    const older = await gemtext('/page/2/index.gmi');
    assert.match(older, /^=> \/2026\/09\/one\/index\.gmi 2026-09-01 Post one$/m);
    assert.match(older, /^=> \/index\.gmi Newer posts$/m);
  });

  it('lists a tag, a category and an author archive the same way', async () => {
    for (const url of [
      '/tag/notes/index.gmi',
      '/category/Field/index.gmi',
      '/author/ada/index.gmi',
    ]) {
      const text = await gemtext(url);
      assertClean(text, url);
      assert.match(text, /^=> \/2026\/09\/three\/index\.gmi 2026-09-03 Post three$/m, url);
    }
  });

  it('lists the posts page as a gemfeed', async () => {
    const paged = await site({ homepage: 'about', postsPage: 'archive' });
    const response = await paged.app.request('/archive/index.gmi');
    assert.equal(response.status, 200);
    assert.match(
      await response.text(),
      /^=> \/2026\/09\/three\/index\.gmi 2026-09-03 Post three$/m,
    );
  });

  it('lists the archive page’s months as gemfeed lines', async () => {
    const text = await gemtext('/archive/index.gmi');
    assert.match(
      text,
      /^## September 2026\n\n=> \/2026\/09\/three\/index\.gmi 2026-09-03 Post three\n=> \/2026\/09\/two\/index\.gmi 2026-09-02 Post two\n=> \/2026\/09\/one\/index\.gmi 2026-09-01 Post one$/m,
    );
  });
});

describe('search and comment pages (AC #4)', () => {
  it('answers the search at /search/index.gmi with the query kept', async () => {
    const text = await gemtext('/search/index.gmi?q=third');
    assertClean(text, '/search/index.gmi');
    assert.match(text, /^=> \/2026\/09\/three\/index\.gmi 2026-09-03 Post three$/m);
  });

  it('answers a comment’s page at its index.gmi', async () => {
    const text = await gemtext(`/comment/${COMMENT}/index.gmi`);
    assertClean(text, 'comment');
    assert.match(text, /^Well said\.$/m);
    assert.match(text, /^=> \/2026\/09\/one\/index\.gmi 1: \/2026\/09\/one\/index\.gmi$/m);
  });
});

describe('status pages in gemtext (AC #5)', () => {
  function quiet(t: TestContext): void {
    t.mock.method(console, 'error', () => undefined);
  }

  async function failed(url: string, status: number, init?: RequestInit): Promise<string> {
    const response = await cms.app.request(url, init);
    assert.equal(response.status, status, url);
    assert.equal(response.headers.get('content-type'), GEMINI, url);
    const text = await response.text();
    assertClean(text, url);
    return text;
  }

  it('answers a 404 by .gmi and by Accept', async () => {
    assert.match(await failed('/nothing/index.gmi', 404), /^# Not found$/m);
    await failed('/nothing/', 404, { headers: { accept: 'text/gemini' } });
  });

  it('answers a deleted post’s .gmi with a 410', async () => {
    assert.match(await failed('/2026/09/gone/index.gmi', 410), /^# Deleted$/m);
  });

  it('answers a 500 in gemtext', async (t) => {
    quiet(t);
    assert.match(await failed('/broken/index.gmi', 500), /^# Something went wrong$/m);
  });

  it('answers the 503 in gemtext', async () => {
    const away = await site();
    await away.settings.set(
      'maintenance',
      new Map<string, unknown>([
        ['on', true],
        ['until', ''],
      ]),
      'cli',
    );
    clock += RECHECK_MS + 1;
    const response = await away.app.request('/2026/09/two/index.gmi');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('content-type'), GEMINI);
    assert.match(await response.text(), /^# Down for maintenance$/m);
  });
});

describe('negotiation (AC #6)', () => {
  it('selects gemtext by Accept: text/gemini at the canonical URL', async () => {
    const text = await gemtext('/2026/09/two/', { headers: { accept: 'text/gemini' } });
    assert.match(text, /^# Post two\n/);
    assert.equal(
      (await cms.app.request('/', { headers: { accept: 'text/gemini' } })).headers.get(
        'content-type',
      ),
      GEMINI,
    );
  });

  it('advertises the .gmi alternate in the Link header', async () => {
    const response = await cms.app.request('/2026/09/two/');
    assert.match(
      response.headers.get('link') ?? '',
      /<\/2026\/09\/two\/index\.gmi>; rel="alternate"; type="text\/gemini"/,
    );
    const search = await cms.app.request('/search/?q=third');
    assert.match(
      search.headers.get('link') ?? '',
      /<\/search\/index\.gmi\?q=third>; rel="alternate"; type="text\/gemini"/,
    );
  });

  it('lists the .gmi in a 406 body', async () => {
    const response = await cms.app.request('/2026/09/two/', { headers: { accept: 'image/png' } });
    assert.equal(response.status, 406);
    const body = (await response.json()) as { alternates: { type: string; url: string }[] };
    assert.ok(
      body.alternates.some(
        (alternate) =>
          alternate.type === 'text/gemini' && alternate.url === '/2026/09/two/index.gmi',
      ),
    );
  });
});
