import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { mf2 } from 'microformats-parser';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';
const POST = '/2026/09/hello/';

function id(which: string): string {
  return `00000000-0000-4000-8000-${which.padStart(12, '0')}`;
}

const TOP = id('a1');
const MIDDLE = id('a2');
const LEAF = id('a3');
const UNDER_LEAF = id('a4');
const HELD_UNDER_LEAF = id('a5');
const DEEP_UNDER_LEAF = id('a6');
const WEBMENTION_UNDER_LEAF = id('a7');
const HELD = id('b1');
const UNDER_HELD = id('b2');
const HELD_REPLY = id('b3');
const UNDER_HELD_REPLY = id('b4');
const SPAM = id('c1');
const UNDER_SPAM = id('c2');
const UNDER_TRASHED = id('d2');
const TRASHED = id('d1');
const WEBMENTION = id('e1');
const ON_DRAFT = id('f1');
const ON_GONE = id('f2');
const IMPORTED = 'https://old.example/?p=7#comment-5';
const NOTE = 'https://remote.example/notes/1';
const NOTE_URL = 'https://remote.example/@ada/1';
const SENDER = 'https://grace.example/2026/09/about-that/';

function post(name: string, frontMatter: string[] = []): string {
  return [
    '---',
    `title: ${name}`,
    "date: '2026-09-02T09:00:00Z'",
    'author: Owner',
    ...frontMatter,
    '---',
    '',
    `${name} has words of its own, and they run on for a while.`,
    '',
  ].join('\n');
}

function entry(values: Record<string, unknown>): Record<string, unknown> {
  return {
    source: 'comment',
    kind: 'reply',
    status: 'approved',
    author: { name: 'Somebody', url: null, email: null, avatar: null },
    content: { markdown: '', html: '' },
    submitted: '2026-09-03T10:00:00.000Z',
    addressHash: null,
    inReplyTo: null,
    url: null,
    notify: false,
    ...values,
  };
}

function said(
  which: string,
  name: string,
  minute: number,
  values: Record<string, unknown> = {},
): Record<string, unknown> {
  return entry({
    id: which,
    author: { name, url: `https://${name.toLowerCase()}.example/`, email: null, avatar: null },
    content: { markdown: `${name} says so.`, html: `<p>${name} says so.</p>` },
    submitted: `2026-09-03T10:${String(minute).padStart(2, '0')}:00.000Z`,
    ...values,
  });
}

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/2026-09-02-hello.md': post('Hello', [`permalink: ${POST}`]),
  'posts/2026-09-02-draft.md': post('Draft', ['permalink: /2026/09/draft/', 'draft: true']),
  '_trash/posts/2026-09-02-gone.md': post('Gone', ['permalink: /2026/09/gone/']),
  '_data/comments/hello.json': JSON.stringify({
    post: POST,
    comments: [
      said(TOP, 'Ada', 1),
      said(MIDDLE, 'Bob', 2, { inReplyTo: TOP }),
      said(LEAF, 'Cal', 3, { inReplyTo: MIDDLE }),
      said(UNDER_LEAF, 'Dee', 4, { inReplyTo: LEAF }),
      said(HELD_UNDER_LEAF, 'Eve', 5, { inReplyTo: LEAF, status: 'pending' }),
      said(DEEP_UNDER_LEAF, 'Fay', 6, { inReplyTo: UNDER_LEAF }),
      said(WEBMENTION_UNDER_LEAF, 'Gus', 7, {
        inReplyTo: LEAF,
        source: 'webmention',
        url: 'https://gus.example/reply',
      }),
      said(HELD, 'Hal', 10, { status: 'pending' }),
      said(UNDER_HELD, 'Ivy', 11, { inReplyTo: HELD }),
      said(SPAM, 'Jay', 12, { status: 'spam' }),
      said(UNDER_SPAM, 'Kim', 13, { inReplyTo: SPAM }),
      said(UNDER_TRASHED, 'Lou', 14, { inReplyTo: TRASHED }),
      said(WEBMENTION, 'Grace', 15, { source: 'webmention', url: SENDER }),
      said(IMPORTED, 'Old', 16),
      said(HELD_REPLY, 'Quinn', 20, { inReplyTo: TOP, status: 'pending' }),
      said(UNDER_HELD_REPLY, 'Rae', 21, { inReplyTo: HELD_REPLY }),
    ],
  }),
  '_data/comments/draft.json': JSON.stringify({
    post: '/2026/09/draft/',
    comments: [said(ON_DRAFT, 'Max', 1)],
  }),
  '_data/comments/gone.json': JSON.stringify({
    post: '/2026/09/gone/',
    comments: [said(ON_GONE, 'Ned', 1)],
  }),
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-comment-page-content-');
  const dataDir = await box.dir('geekity-comment-page-data-');
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
  cms.admin.logInboxActivity({
    activityId: `${NOTE}/activity`,
    activityType: 'Create',
    actorId: 'https://remote.example/users/ada',
    objectId: NOTE,
    json: JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${NOTE}/activity`,
      type: 'Create',
      actor: 'https://remote.example/users/ada',
      object: {
        id: NOTE,
        type: 'Note',
        attributedTo: 'https://remote.example/users/ada',
        content: '<p>Federated words.</p>',
        inReplyTo: `${BASE_URL}${POST}`,
        published: '2026-09-03T09:00:00Z',
        url: NOTE_URL,
      },
    }),
  });
});

function pageOf(which: string): string {
  return `/comment/${encodeURIComponent(which)}/`;
}

async function get(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

interface Item {
  type: string[];
  properties: Record<string, unknown[]>;
  children?: Item[];
}

function topEntries(html: string, url: string): Item[] {
  const items = mf2(html, { baseUrl: url }).items as Item[];
  return items.filter((item) => item.type.includes('h-entry'));
}

function only(html: string, url: string): Item {
  const found = topEntries(html, url);
  assert.equal(found.length, 1, 'the page has exactly one h-entry');
  return found[0] as Item;
}

function first(item: Item, property: string): unknown {
  return item.properties[property]?.[0];
}

function cite(item: Item, property: string): Item {
  const value = first(item, property) as Item | undefined;
  assert.ok(value !== undefined && value.type.includes('h-cite'), `${property} is an h-cite`);
  return value;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  return String((value as { value?: string; properties?: { name?: string[] } }).value);
}

describe('a native comment’s own page (TASK-318)', () => {
  it('answers 200 with the comment as the page’s one h-entry', async () => {
    const url = `${BASE_URL}${pageOf(TOP)}`;
    const entry = only(await get(pageOf(TOP)), url);

    assert.equal(first(entry, 'url'), url, 'its u-url is the page');
    const author = first(entry, 'author') as Item;
    assert.ok(author.type.includes('h-card'), 'the author is an h-card');
    assert.equal(first(author, 'name'), 'Ada');
    assert.equal(first(author, 'url'), 'https://ada.example/');
    assert.match(text(first(entry, 'content')), /Ada says so\./);
    assert.equal(first(entry, 'published'), '2026-09-03T10:01:00.000Z');
    assert.equal(first(cite(entry, 'in-reply-to'), 'url'), `${BASE_URL}${POST}`);
  });

  it('answers a reply with the comment it answers as its in-reply-to', async () => {
    const url = `${BASE_URL}${pageOf(MIDDLE)}`;
    const entry = only(await get(pageOf(MIDDLE)), url);

    assert.equal(first(cite(entry, 'in-reply-to'), 'url'), `${BASE_URL}${pageOf(TOP)}`);
  });

  it('has a page for a comment imported with an id that is a URL', async () => {
    const url = `${BASE_URL}${pageOf(IMPORTED)}`;
    const entry = only(await get(pageOf(IMPORTED)), url);

    assert.equal(first(entry, 'url'), url);
    assert.ok((await get(POST)).includes(`href="${pageOf(IMPORTED)}"`), 'the thread links it');
  });

  it('is noindex in its head and its headers', async () => {
    const response = await cms.app.request(pageOf(TOP));

    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    assert.match(await response.text(), /<meta name="robots" content="noindex">/);
  });

  for (const [why, which] of [
    ['is waiting for a moderator', HELD],
    ['was filed as spam', SPAM],
    ['was deleted', TRASHED],
    ['is on a draft', ON_DRAFT],
    ['came by webmention', WEBMENTION],
  ] as const) {
    it(`404s for a comment that ${why}`, async () => {
      assert.equal((await cms.app.request(pageOf(which))).status, 404);
    });
  }

  it('answers 410 for a comment on a deleted post, as the post does', async () => {
    assert.equal((await cms.app.request('/2026/09/gone/')).status, 410, 'the post is gone');
    assert.equal((await cms.app.request(pageOf(ON_GONE))).status, 410);
  });

  it('has no page for a fediverse reply', async () => {
    assert.equal((await cms.app.request(pageOf(NOTE))).status, 404);
  });
});

describe('the thread on the post (TASK-318 AC #3, AC #4)', () => {
  it('links a native comment to its page and keeps its anchor', async () => {
    const html = await get(POST);

    assert.match(html, new RegExp(`<li id="comment-${TOP}"`));
    assert.match(
      html,
      new RegExp(`<a class="u-url" href="${pageOf(TOP)}"><time class="dt-published"`),
    );
  });

  it('links a webmention and a fediverse reply to where they came from', async () => {
    const html = await get(POST);

    assert.match(html, new RegExp(`<a class="u-url" href="${SENDER}" rel="nofollow`));
    assert.match(html, new RegExp(`<a class="u-url" href="${NOTE_URL}" rel="nofollow`));
  });
});

describe('the thread above a comment (TASK-318 AC #8, AC #9)', () => {
  it('nests the chain from the post down as h-cite in-reply-to', async () => {
    const url = `${BASE_URL}${pageOf(LEAF)}`;
    const entry = only(await get(pageOf(LEAF)), url);

    const parent = cite(entry, 'in-reply-to');
    assert.equal(first(parent, 'url'), `${BASE_URL}${pageOf(MIDDLE)}`);
    assert.equal(first(first(parent, 'author') as Item, 'name'), 'Bob');
    assert.match(text(first(parent, 'content')), /Bob says so\./);
    assert.equal(first(parent, 'published'), '2026-09-03T10:02:00.000Z');

    const grandparent = cite(parent, 'in-reply-to');
    assert.equal(first(grandparent, 'url'), `${BASE_URL}${pageOf(TOP)}`);
    assert.equal(first(first(grandparent, 'author') as Item, 'name'), 'Ada');

    const top = cite(grandparent, 'in-reply-to');
    assert.equal(first(top, 'url'), `${BASE_URL}${POST}`);
    assert.equal(first(top, 'name'), 'Hello');
    assert.equal(first(first(top, 'author') as Item, 'name'), 'Owner');
    assert.equal(first(top, 'published'), '2026-09-02T09:00:00.000Z');
    assert.match(text(first(top, 'summary')), /Hello has words of its own/);
  });

  it('reads top down, the post first and the comment last', async () => {
    const html = await get(pageOf(LEAF));
    const at = (needle: string): number => html.indexOf(needle);

    assert.ok(at('Hello has words of its own') < at('Ada says so.'));
    assert.ok(at('Ada says so.') < at('Bob says so.'));
    assert.ok(at('Bob says so.') < at('Cal says so.'));
  });

  for (const [why, which, hidden] of [
    ['waiting for a moderator', UNDER_HELD, 'Hal'],
    ['filed as spam', UNDER_SPAM, 'Jay'],
    ['deleted', UNDER_TRASHED, undefined],
  ] as const) {
    it(`shows a placeholder for an ancestor ${why}, and goes on to the post`, async () => {
      const html = await get(pageOf(which));
      const entry = only(html, `${BASE_URL}${pageOf(which)}`);

      assert.match(html, /This comment is no longer shown\./);
      if (hidden !== undefined) assert.doesNotMatch(html, new RegExp(`${hidden} says so`));
      const placeholder = cite(entry, 'in-reply-to');
      assert.equal(first(placeholder, 'author'), undefined, 'the placeholder names nobody');
      assert.equal(first(cite(placeholder, 'in-reply-to'), 'url'), `${BASE_URL}${POST}`);
    });
  }
});

describe('the replies below a comment (TASK-318 AC #11)', () => {
  it('shows the approved replies at every depth, each linking to its own URL', async () => {
    const html = await get(pageOf(LEAF));
    const entry = only(html, `${BASE_URL}${pageOf(LEAF)}`);

    const replies = (entry.properties['comment'] ?? []) as Item[];
    assert.deepEqual(
      replies.map((reply) => first(reply, 'url')),
      [`${BASE_URL}${pageOf(UNDER_LEAF)}`, 'https://gus.example/reply'],
    );
    const nested = ((replies[0] as Item).properties['comment'] ?? []) as Item[];
    assert.deepEqual(
      nested.map((reply) => first(reply, 'url')),
      [`${BASE_URL}${pageOf(DEEP_UNDER_LEAF)}`],
    );
    assert.doesNotMatch(html, /Eve says so/, 'a reply waiting for a moderator is absent');
  });

  it('shows none under a comment nobody answered, and links back to the thread', async () => {
    const html = await get(pageOf(DEEP_UNDER_LEAF));
    const entry = only(html, `${BASE_URL}${pageOf(DEEP_UNDER_LEAF)}`);

    assert.equal(entry.properties['comment'], undefined);
    assert.match(html, new RegExp(`href="${POST}#comment-${DEEP_UNDER_LEAF}"`));
  });
});

describe('a comment page among the site’s lists (TASK-318 AC #5)', () => {
  it('is absent from the sitemap, the post feeds and search', async () => {
    for (const pathname of ['/sitemap.xml', '/feed/', '/feed/atom/', '/feed/json/']) {
      assert.doesNotMatch(await get(pathname), /\/comment\//, pathname);
    }
    const found = await get('/search/index.json?q=says');
    assert.doesNotMatch(found, /\/comment\//, 'search');
  });
});

describe('the comments feeds (TASK-318 AC #7, AC #10)', () => {
  it('link a native comment to its own page', async () => {
    for (const pathname of [`${POST}feed/`, '/comments/feed/']) {
      const feed = await get(pathname);
      assert.ok(feed.includes(`<link>${BASE_URL}${pageOf(TOP)}</link>`), pathname);
      assert.doesNotMatch(feed, /<link>[^<]*#comment-/, pathname);
    }
  });

  it('name the comment an answer replies to in the site’s feed', async () => {
    const feed = await get('/comments/feed/');

    assert.ok(feed.includes('<title>Bob replying to Ada on Hello</title>'), 'a reply');
    assert.ok(feed.includes('<title>Ada on Hello</title>'), 'a top-level comment');
  });
});

describe('a reply under a comment a reader may not see (TASK-325)', () => {
  const HIDDEN = [
    ['waiting for a moderator', HELD, UNDER_HELD, 'Hal', 'Ivy'],
    ['filed as spam', SPAM, UNDER_SPAM, 'Jay', 'Kim'],
    ['deleted', TRASHED, UNDER_TRASHED, undefined, 'Lou'],
  ] as const;

  for (const [why, parent, reply, hidden, shown] of HIDDEN) {
    it(`is in the thread under a placeholder for a parent ${why}`, async () => {
      const html = await get(POST);
      const placeholder = new RegExp(
        `<li id="comment-${parent}" class="comment comment-placeholder">\\s*` +
          `<p class="comment-withheld">This comment is no longer shown\\.</p>\\s*` +
          `<ol class="children">\\s*<li id="comment-${reply}"`,
      );

      assert.match(html, placeholder);
      assert.match(html, new RegExp(`${shown} says so\\.`));
      if (hidden !== undefined) assert.doesNotMatch(html, new RegExp(`${hidden} says so`));
    });

    it(`links its page to an anchor the thread prints, under a parent ${why}`, async () => {
      const page = await get(pageOf(reply));
      const thread = await get(POST);

      assert.ok(page.includes(`href="${POST}#comment-${reply}"`), 'the page links the thread');
      assert.ok(thread.includes(`id="comment-${reply}"`), 'the thread has the anchor');
      assert.ok(thread.includes(`id="comment-${parent}"`), 'and the placeholder’s');
    });

    it(`is in both comments feeds under a parent ${why}, and the placeholder is not`, async () => {
      for (const pathname of [`${POST}feed/`, '/comments/feed/']) {
        const feed = await get(pathname);
        assert.ok(feed.includes(`<link>${BASE_URL}${pageOf(reply)}</link>`), pathname);
        assert.ok(!feed.includes(`${pageOf(parent)}</link>`), `${pathname} has no placeholder`);
        assert.ok(!feed.includes('no longer shown'), `${pathname} says nothing of it`);
      }
      assert.ok(
        (await get('/comments/feed/')).includes(`<title>${shown} on Hello</title>`),
        'the site feed names no hidden author',
      );
    });
  }

  it('is under the same placeholder on the page of the comment the hidden one answers', async () => {
    const page = await get(pageOf(TOP));
    const thread = await get(POST);
    const placeholder = new RegExp(
      `<li id="comment-${HELD_REPLY}" class="comment comment-placeholder">\\s*` +
        `<p class="comment-withheld">This comment is no longer shown\\.</p>\\s*` +
        `<ol class="children">\\s*<li id="comment-${UNDER_HELD_REPLY}"`,
    );

    assert.match(page, placeholder);
    assert.match(thread, placeholder);
    assert.doesNotMatch(page, /Quinn says so/);
    const entry = only(page, `${BASE_URL}${pageOf(TOP)}`);
    const replies = (entry.properties['comment'] ?? []) as Item[];
    assert.ok(
      replies.some((reply) => first(reply, 'url') === `${BASE_URL}${pageOf(UNDER_HELD_REPLY)}`),
      'the visible reply is one of the comment’s',
    );
  });

  it('prints nothing for a hidden comment nobody visible answered', async () => {
    const html = await get(POST);

    assert.ok(!html.includes(`id="comment-${HELD_UNDER_LEAF}"`));
    assert.doesNotMatch(html, /Eve says so/);
  });

  it('counts the visible replies on the page, and the direct ones in the feed', async () => {
    const html = await get(POST);
    assert.match(html, /<h2 class="comments-title">13 replies<\/h2>/);

    // TOP, the three lifted from under hidden comments, the webmention, the
    // imported comment and the note: a reply under a hidden one counts as the
    // post's own (TASK-324).
    const feed = await get('/feed/');
    assert.match(feed, /<source:comments count="7" /);
  });
});
