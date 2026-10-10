import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { child, childrenNamed, parseXml } from './__testing__/xml.ts';
import type { XmlElement } from './__testing__/xml.ts';

/**
 * A page that takes comments has a comments feed as a post does (TASK-323),
 * and a page that does not shows no conversation, so it has no feed and its
 * comments are not in the site's either.
 */

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';

function said(id: string, name: string, minute: number): Record<string, unknown> {
  return {
    id: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
    source: 'comment',
    kind: 'reply',
    status: 'approved',
    author: { name, url: null, email: null, avatar: null },
    content: { markdown: `${name} says so.`, html: `<p>${name} says so.</p>` },
    submitted: `2026-09-03T10:${String(minute).padStart(2, '0')}:00.000Z`,
    addressHash: null,
    inReplyTo: null,
    url: null,
    notify: false,
  };
}

function page(title: string, permalink: string, comments?: boolean): string {
  const own = comments === undefined ? [] : [`comments: ${String(comments)}`];
  return [
    '---',
    `title: ${title}`,
    `permalink: ${permalink}`,
    ...own,
    '---',
    '',
    'Words.',
    '',
  ].join('\n');
}

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/2026-09-02-hello.md': [
    '---',
    'title: Hello',
    "date: '2026-09-02T09:00:00Z'",
    'permalink: /2026/09/hello/',
    '---',
    '',
    'Words.',
    '',
  ].join('\n'),
  'pages/guestbook.md': page('Guestbook', '/guestbook/', true),
  'pages/quiet.md': page('Quiet', '/quiet/', true),
  'pages/about.md': page('About', '/about/'),
  'pages/shut.md': page('Shut', '/shut/', false),
  '_data/comments/hello.json': JSON.stringify({
    post: '/2026/09/hello/',
    comments: [said('a1', 'Ann', 1)],
  }),
  '_data/comments/guestbook.json': JSON.stringify({
    post: '/guestbook/',
    comments: [said('b1', 'Pat', 2)],
  }),
  '_data/comments/about.json': JSON.stringify({
    post: '/about/',
    comments: [said('c1', 'Quinn', 3)],
  }),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-page-feed-content-');
  const dataDir = await box.dir('geekity-page-feed-data-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    now: () => new Date('2026-09-05T12:00:00Z'),
  });
});

async function channel(pathname: string): Promise<XmlElement> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  assert.match(response.headers.get('content-type') ?? '', /application\/rss\+xml/);
  return child(parseXml(await response.text()), 'channel');
}

async function head(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, pathname);
  return (await response.text()).split('</head>')[0] ?? '';
}

describe('a page’s comments feed', () => {
  it('carries the conversation of a page that takes comments, named as the page', async () => {
    const found = await channel('/guestbook/feed/');
    assert.equal(child(found, 'title').text, 'Comments on: Guestbook');
    const items = childrenNamed(found, 'item');
    assert.deepEqual(
      items.map((item) => child(item, 'title').text),
      ['Pat'],
    );
    assert.equal(child(items[0] as XmlElement, 'source:inReplyTo').text, `${BASE_URL}/guestbook/`);
  });

  it('is an empty feed for a page that takes comments and has none', async () => {
    assert.deepEqual(childrenNamed(await channel('/quiet/feed/'), 'item'), []);
  });

  it('is a 404 for a page that takes no comments, whatever is stored for it', async () => {
    for (const url of ['/about/feed/', '/shut/feed/']) {
      assert.equal((await cms.app.request(url)).status, 404, url);
    }
  });

  it('is where ?feed=rss2 on the page’s permalink leads', async () => {
    const response = await cms.app.request('/guestbook/?feed=rss2');
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/guestbook/feed/');
    assert.equal((await cms.app.request('/about/?feed=rss2')).status, 200);
  });
});

describe('the site’s comments feed', () => {
  it('names a page a comment is on as it names a post, and leaves out a closed page’s', async () => {
    const titles = childrenNamed(await channel('/comments/feed/'), 'item').map(
      (item) => child(item, 'title').text,
    );
    assert.deepEqual(titles, ['Pat on Guestbook', 'Ann on Hello']);
  });
});

describe('a page advertises its comments feed', () => {
  it('as a post does, when it takes comments', async () => {
    assert.ok(
      (await head('/guestbook/')).includes(
        '<link rel="alternate" type="application/rss+xml" title="Comments on: Guestbook" href="/guestbook/feed/">',
      ),
    );
    assert.ok((await head('/quiet/')).includes('href="/quiet/feed/"'));
  });

  it('not at all, when it takes none', async () => {
    for (const url of ['/about/', '/shut/']) {
      assert.ok(!(await head(url)).includes(`href="${url}feed/"`), url);
    }
  });
});
