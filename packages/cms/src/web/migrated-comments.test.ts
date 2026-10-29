import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import type { Cms } from '../index.ts';
import { child, childrenNamed, parseXml } from './__testing__/xml.ts';
import type { XmlElement } from './__testing__/xml.ts';

/**
 * A comment imported from another system (TASK-336) was published before the
 * site came here: it shows on its post and in its thread like any other, but
 * no feed carries it and no reply count advertises it, so a reader is never
 * told it is new. A native reply under it is news, and names it as what it
 * answers.
 */

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';
const POST = '/2026/09/hello/';
const POST_GUID = `${BASE_URL}${POST}`;

function id(which: string): string {
  return `0000${which.padStart(12, '0')}`;
}

const FORM = id('a1');
const FEDIVERSE = id('a2');
const FEDIVERSE_NO_ORIGIN = id('a3');
const WEBMENTION = id('a4');
const UNDER_FORM = id('a5');
const MENTION = id('a6');
const LIKE = id('a7');
const BY_ADA = id('a8');
const BY_NOBODY = id('a9');
const UNDER_ADA = id('aa');
const NATIVE = id('b0');
const NATIVE_UNDER_FORM = id('b1');
const NATIVE_UNDER_FEDIVERSE = id('b2');
const NATIVE_UNDER_NO_ORIGIN = id('b3');
const NATIVE_UNDER_WEBMENTION = id('b4');

const NOTE = 'https://remote.example/users/carol/statuses/1';
const NOTE_PAGE = 'https://remote.example/@carol/1';
const OLD_NOTE_PAGE = 'https://remote.example/@dan/2';
const SOURCE = 'https://gus.example/reply';

function commentPage(which: string): string {
  return `${BASE_URL}/comment/${which}/`;
}

function keyOf(guid: string): string {
  return createHash('sha256').update(guid).digest('hex').slice(0, 16);
}

function said(
  which: string,
  name: string,
  minute: number,
  values: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: which,
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
    ...values,
  };
}

const MIGRATED = { migrated: true };

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/2026-09-02-hello.md': [
    '---',
    'title: Hello',
    "date: '2026-09-02T09:00:00Z'",
    'author: ada',
    `permalink: ${POST}`,
    '---',
    '',
    'Words of its own.',
    '',
  ].join('\n'),
  '_data/comments/hello.json': JSON.stringify({
    post: POST,
    comments: [
      said(FORM, 'Ann', 1, MIGRATED),
      said(FEDIVERSE, 'Carol', 2, {
        ...MIGRATED,
        source: 'activitypub',
        url: NOTE_PAGE,
        origin: NOTE,
      }),
      said(FEDIVERSE_NO_ORIGIN, 'Dan', 3, {
        ...MIGRATED,
        source: 'activitypub',
        url: OLD_NOTE_PAGE,
      }),
      said(WEBMENTION, 'Gus', 4, {
        ...MIGRATED,
        source: 'webmention',
        url: SOURCE,
        origin: SOURCE,
      }),
      said(UNDER_FORM, 'Hal', 5, { ...MIGRATED, inReplyTo: FORM }),
      said(MENTION, 'Max', 6, {
        ...MIGRATED,
        source: 'webmention',
        kind: 'mention',
        url: 'https://max.example/linked',
      }),
      said(LIKE, 'Lou', 7, {
        ...MIGRATED,
        source: 'activitypub',
        kind: 'like',
        url: 'https://remote.example/@lou',
      }),
      said(BY_ADA, 'ada (signed in)', 8, {
        ...MIGRATED,
        user: 'ada',
        author: { name: 'ada (signed in)', url: 'https://ada.example/', email: null, avatar: null },
        content: { markdown: 'Thanks.', html: '<p>Thanks.</p>' },
      }),
      said(BY_NOBODY, 'Gone', 9, {
        ...MIGRATED,
        user: 'gone',
        author: { name: 'Gone', url: 'https://gone.example/', email: null, avatar: null },
      }),
      said(UNDER_ADA, 'Ivy', 9, { ...MIGRATED, inReplyTo: BY_ADA }),
      said(NATIVE, 'Nia', 10),
      said(NATIVE_UNDER_FORM, 'Ola', 11, { inReplyTo: FORM }),
      said(NATIVE_UNDER_FEDIVERSE, 'Pip', 12, { inReplyTo: FEDIVERSE }),
      said(NATIVE_UNDER_NO_ORIGIN, 'Quin', 13, { inReplyTo: FEDIVERSE_NO_ORIGIN }),
      said(NATIVE_UNDER_WEBMENTION, 'Rae', 14, { inReplyTo: WEBMENTION }),
    ],
  }),
};

/** What each native reply answers, by guid, as the feeds should say. */
const PARENTS: Record<string, string> = {
  [commentPage(NATIVE)]: POST_GUID,
  [commentPage(NATIVE_UNDER_FORM)]: commentPage(FORM),
  [commentPage(NATIVE_UNDER_FEDIVERSE)]: NOTE,
  [commentPage(NATIVE_UNDER_NO_ORIGIN)]: OLD_NOTE_PAGE,
  [commentPage(NATIVE_UNDER_WEBMENTION)]: SOURCE,
};

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-migrated-comments-content-');
  const dataDir = await box.dir('geekity-migrated-comments-data-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  writeUsers(dataDir, [{ username: 'ada', profile: { displayName: 'Ada' } }]);
  cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    now: () => new Date('2026-09-05T12:00:00Z'),
  });
});

async function body(pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return await response.text();
}

async function items(pathname: string): Promise<XmlElement[]> {
  return childrenNamed(child(parseXml(await body(pathname)), 'channel'), 'item');
}

function guidOf(item: XmlElement): string {
  return child(item, 'guid').text;
}

function optional(item: XmlElement, name: string): XmlElement | undefined {
  return item.children.find((element) => element.name === name);
}

describe('a migrated comment on its post', () => {
  it('shows in the thread like any other, a like and a mention included', async () => {
    const page = await body(POST);
    for (const which of [FORM, FEDIVERSE, FEDIVERSE_NO_ORIGIN, WEBMENTION, UNDER_FORM]) {
      assert.ok(page.includes(`id="comment-${which}"`), `${which} is anchored on the post`);
    }
    for (const name of ['Lou', 'Max']) assert.ok(page.includes(name), `${name} is shown`);
  });

  it('keeps its replies, migrated and native, threaded under it', async () => {
    const page = await body(commentPage(FORM).slice(BASE_URL.length));
    assert.ok(page.includes(`id="comment-${UNDER_FORM}"`));
    assert.ok(page.includes(`id="comment-${NATIVE_UNDER_FORM}"`));
  });

  it('has a page of its own only when it was a form comment', async () => {
    for (const which of [FEDIVERSE, WEBMENTION]) {
      assert.equal((await cms.app.request(`/comment/${which}/`)).status, 404, which);
    }
  });
});

/** The `<li>` the thread anchors a comment by, up to the next one. */
function entryOf(page: string, which: string): string {
  const start = page.indexOf(`<li id="comment-${which}"`);
  assert.notEqual(start, -1, `${which} is in the thread`);
  const next = page.indexOf('<li id="comment-', start + 1);
  return page.slice(start, next === -1 ? undefined : next);
}

describe('a migrated comment a site user wrote', () => {
  it('shows as theirs: their name, their author archive and no nofollow ugc', async () => {
    const entry = entryOf(await body(POST), BY_ADA);
    assert.match(entry, /<a class="url u-url" href="\/author\/ada\/">Ada<\/a>/);
    assert.doesNotMatch(entry, /nofollow|ugc|ada\.example|signed in/);
  });

  it('shows as theirs on its own page too', async () => {
    const page = await body(`/comment/${BY_ADA}/`);
    assert.match(page, /<a class="u-url" href="\/author\/ada\/">Ada<\/a>/);
    assert.doesNotMatch(page, /nofollow ugc|ada\.example/);
  });

  it('is cited as theirs on the page of a reply to it', async () => {
    const page = await body(`/comment/${UNDER_ADA}/`);
    assert.match(
      page,
      new RegExp(
        `<a class="u-url p-name" href="/author/ada/">Ada</a></span>,\\s*<a class="u-url" href="/comment/${BY_ADA}/">`,
      ),
    );
    assert.doesNotMatch(page, /nofollow ugc|ada\.example/);
  });

  it('keeps the name it was given when the site no longer has that user', async () => {
    const entry = entryOf(await body(POST), BY_NOBODY);
    assert.match(
      entry,
      /<a class="url u-url" href="https:\/\/gone\.example\/" rel="nofollow ugc noopener noreferrer">Gone<\/a>/,
    );
  });
});

describe('the comments feeds', () => {
  for (const feed of [`${POST}feed/`, '/comments/feed/']) {
    it(`${feed} holds the native replies and no migrated comment`, async () => {
      assert.deepEqual((await items(feed)).map(guidOf).sort(), Object.keys(PARENTS).sort());
    });

    it(`${feed} names a migrated parent’s guid in source:inReplyTo`, async () => {
      for (const item of await items(feed)) {
        assert.equal(
          child(item, 'source:inReplyTo').text,
          PARENTS[guidOf(item)],
          `what ${guidOf(item)} answers`,
        );
      }
    });
  }

  it('advertise no reply count for a migrated reply', async () => {
    for (const item of await items(`${POST}feed/`)) {
      assert.equal(optional(item, 'source:comments'), undefined, guidOf(item));
    }
    const post = (await items('/feed/')).find((item) => guidOf(item) === POST_GUID);
    assert.ok(post !== undefined);
    const pointer = child(post, 'source:comments');
    assert.equal(pointer.attributes['count'], '1');
  });
});

describe('the /replies/ feeds', () => {
  it('leave a migrated comment out of its parent’s', async () => {
    assert.deepEqual((await items(`/replies/${keyOf(POST_GUID)}/`)).map(guidOf), [
      commentPage(NATIVE),
    ]);
    assert.deepEqual((await items(`/replies/${FORM}/`)).map(guidOf), [
      commentPage(NATIVE_UNDER_FORM),
    ]);
  });

  it('answer a migrated comment’s key with the native replies under it', async () => {
    assert.deepEqual((await items(`/replies/${FEDIVERSE}/`)).map(guidOf), [
      commentPage(NATIVE_UNDER_FEDIVERSE),
    ]);
    assert.deepEqual(await items(`/replies/${UNDER_FORM}/`), []);
  });
});
