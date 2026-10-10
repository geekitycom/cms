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
 * The comments feeds speak the source namespace (TASK-324): every item names
 * what it answers, every item with replies points at a feed of exactly those,
 * and a reader can walk a whole thread one level at a time from the post.
 */

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';
const POST = '/2026/09/hello/';
const POST_GUID = `${BASE_URL}${POST}`;
const PAGE = '/about/';
const CLOSED_PAGE = '/colophon/';
const ANSWER = '/2026/09/answer/';
const ANSWER_GUID = `${BASE_URL}${ANSWER}`;

function id(which: string): string {
  return `0000${which.padStart(12, '0')}`;
}

const TOP = id('a1');
const MIDDLE = id('a2');
const WEBMENTION_UNDER_MIDDLE = id('a3');
const HELD = id('b1');
const UNDER_HELD = id('b2');
const WEBMENTION_UNDER_NOTE = id('c1');
const MENTION = id('d1');
const ON_PAGE = id('e1');
const ON_CLOSED_PAGE = id('e2');
const NOTE = 'https://remote.example/notes/1';
const NOTE_UNDER_NOTE = 'https://remote.example/notes/2';
const GUS = 'https://gus.example/reply';
const KIT = 'https://kit.example/reply';
const MAX = 'https://max.example/linked';

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
    author: { name, url: `https://${name.toLowerCase()}.example/`, email: null, avatar: null },
    content: { markdown: `${name} says so.`, html: `<p>${name} says so.</p>` },
    submitted: `2026-09-03T10:${String(minute).padStart(2, '0')}:00.000Z`,
    addressHash: null,
    inReplyTo: null,
    url: null,
    notify: false,
    ...values,
  };
}

function document(lines: string[]): string {
  return ['---', ...lines, '---', '', 'Words of its own.', ''].join('\n');
}

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/2026-09-02-hello.md': document([
    'title: Hello',
    "date: '2026-09-02T09:00:00Z'",
    'author: ada',
    `permalink: ${POST}`,
  ]),
  'posts/2026-09-03-answer.md': document([
    "date: '2026-09-03T10:06:00Z'",
    'author: ada',
    `permalink: ${ANSWER}`,
    `in-reply-to: ${commentPage(TOP)}`,
  ]),
  'pages/about.md': document(['title: About', `permalink: ${PAGE}`, 'comments: true']),
  'pages/colophon.md': document(['title: Colophon', `permalink: ${CLOSED_PAGE}`]),
  '_data/comments/hello.json': JSON.stringify({
    post: POST,
    comments: [
      said(TOP, 'Ann', 1),
      said(MIDDLE, 'Bob', 2, { inReplyTo: TOP }),
      said(WEBMENTION_UNDER_MIDDLE, 'Gus', 3, {
        inReplyTo: MIDDLE,
        source: 'webmention',
        url: GUS,
      }),
      said(HELD, 'Hal', 4, { status: 'pending' }),
      said(UNDER_HELD, 'Ivy', 5, { inReplyTo: HELD }),
      said(WEBMENTION_UNDER_NOTE, 'Kit', 9, {
        inReplyTo: NOTE_UNDER_NOTE,
        source: 'webmention',
        url: KIT,
      }),
      said(MENTION, 'Max', 10, {
        kind: 'mention',
        source: 'webmention',
        url: MAX,
      }),
    ],
  }),
  '_data/comments/about.json': JSON.stringify({
    post: PAGE,
    comments: [said(ON_PAGE, 'Pat', 1)],
  }),
  '_data/comments/colophon.json': JSON.stringify({
    post: CLOSED_PAGE,
    comments: [said(ON_CLOSED_PAGE, 'Quin', 1)],
  }),
};

let cms: Cms;

function logNote(note: { id: string; inReplyTo: string; minute: number }): void {
  const actor = 'https://remote.example/users/carol';
  cms.admin.logInboxActivity({
    activityId: `${note.id}/activity`,
    activityType: 'Create',
    actorId: actor,
    objectId: note.id,
    json: JSON.stringify({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${note.id}/activity`,
      type: 'Create',
      actor,
      object: {
        id: note.id,
        type: 'Note',
        attributedTo: actor,
        content: '<p>Carol has thoughts.</p>',
        inReplyTo: note.inReplyTo,
        published: `2026-09-03T10:${String(note.minute).padStart(2, '0')}:00Z`,
        url: note.id,
      },
    }),
  });
}

before(async () => {
  const contentDir = await box.dir('geekity-replies-feeds-content-');
  const dataDir = await box.dir('geekity-replies-feeds-data-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  writeUsers(dataDir, [
    { username: 'ada', password: 'correct horse battery', profile: { displayName: 'Ada' } },
  ]);
  cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    now: () => new Date('2026-09-05T12:00:00Z'),
  });
  logNote({ id: NOTE, inReplyTo: POST_GUID, minute: 7 });
  logNote({ id: NOTE_UNDER_NOTE, inReplyTo: NOTE, minute: 8 });
});

async function items(pathname: string): Promise<XmlElement[]> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  const channel = child(parseXml(await response.text()), 'channel');
  return childrenNamed(channel, 'item');
}

function guidOf(item: XmlElement): string {
  return child(item, 'guid').text;
}

function optional(item: XmlElement, name: string): XmlElement | undefined {
  return item.children.find((element) => element.name === name);
}

function byGuid(found: readonly XmlElement[]): Map<string, XmlElement> {
  return new Map(found.map((item) => [guidOf(item), item]));
}

function local(url: string): string {
  return new URL(url).pathname;
}

/** What each item of the thread answers, by guid, as the feeds should say. */
const PARENTS: Record<string, string> = {
  [commentPage(TOP)]: POST_GUID,
  [commentPage(MIDDLE)]: commentPage(TOP),
  [GUS]: commentPage(MIDDLE),
  [ANSWER_GUID]: commentPage(TOP),
  // Its parent is waiting for a moderator, so it sits under the post.
  [commentPage(UNDER_HELD)]: POST_GUID,
  [NOTE]: POST_GUID,
  [NOTE_UNDER_NOTE]: NOTE,
  [KIT]: NOTE_UNDER_NOTE,
};

describe('the comments feeds name what each item answers', () => {
  for (const feed of [`${POST}feed/`, '/comments/feed/']) {
    it(`every item of ${feed} carries source:inReplyTo with its parent's guid`, async () => {
      const found = byGuid(await items(feed));
      for (const [guid, parent] of Object.entries(PARENTS)) {
        const item = found.get(guid);
        assert.ok(item !== undefined, `${guid} is an item of ${feed}`);
        assert.equal(child(item, 'source:inReplyTo').text, parent, `what ${guid} answers`);
      }
      assert.equal(child(found.get(MAX) as XmlElement, 'source:inReplyTo').text, POST_GUID);
      for (const item of found.values()) {
        assert.ok(optional(item, 'source:inReplyTo') !== undefined, `${guidOf(item)} names one`);
      }
    });
  }

  it('gives a native comment its page as a permalink guid, and a webmention its source', async () => {
    const found = byGuid(await items(`${POST}feed/`));
    const top = found.get(commentPage(TOP));
    assert.ok(top !== undefined);
    assert.equal(child(top, 'guid').attributes['isPermaLink'], 'true');
    assert.equal(child(top, 'link').text, commentPage(TOP));

    const webmention = found.get(GUS);
    assert.ok(webmention !== undefined);
    assert.equal(child(webmention, 'guid').attributes['isPermaLink'], 'true');
    assert.equal(child(webmention, 'link').text, GUS);
  });
});

describe('the /replies/ feeds', () => {
  it('answer a post’s direct replies, newest first, at the key of its guid', async () => {
    const found = await items(`/replies/${keyOf(POST_GUID)}/`);
    assert.deepEqual(found.map(guidOf), [NOTE, commentPage(UNDER_HELD), commentPage(TOP)]);
  });

  it('answer a native comment’s direct replies at its key, which is its id', async () => {
    const found = await items(`/replies/${TOP}/`);
    assert.deepEqual(found.map(guidOf), [ANSWER_GUID, commentPage(MIDDLE)]);
    assert.equal(child(found[1] as XmlElement, 'source:inReplyTo').text, commentPage(TOP));
  });

  it('answer a fediverse reply’s at the key of its guid, and a webmention’s at its key', async () => {
    assert.deepEqual((await items(`/replies/${keyOf(NOTE)}/`)).map(guidOf), [NOTE_UNDER_NOTE]);
    assert.deepEqual((await items(`/replies/${keyOf(NOTE_UNDER_NOTE)}/`)).map(guidOf), [KIT]);
    assert.deepEqual(await items(`/replies/${WEBMENTION_UNDER_MIDDLE}/`), []);
    assert.deepEqual(await items(`/replies/${keyOf(ANSWER_GUID)}/`), []);
  });

  it('answer a page’s direct replies at the key of its guid', async () => {
    const found = await items(`/replies/${keyOf(`${BASE_URL}${PAGE}`)}/`);
    assert.deepEqual(found.map(guidOf), [commentPage(ON_PAGE)]);
    assert.equal(child(found[0] as XmlElement, 'source:inReplyTo').text, `${BASE_URL}${PAGE}`);
  });

  it('404 for a page not showing its conversation, as its {permalink}feed/ does', async () => {
    const segments = [keyOf(`${BASE_URL}${CLOSED_PAGE}`), ON_CLOSED_PAGE];
    for (const segment of segments) {
      const response = await cms.app.request(`/replies/${segment}/`);
      assert.equal(response.status, 404, `/replies/${segment}/`);
    }
    assert.equal((await cms.app.request(`${CLOSED_PAGE}feed/`)).status, 404);
  });

  it('404 for an unknown key, anything that is not a key, and a comment a reader may not see', async () => {
    const notKeys = [
      keyOf(commentPage(TOP)),
      encodeURIComponent(NOTE),
      '00000000-0000-4000-8000-0000000000a1',
      TOP.toUpperCase(),
    ];
    for (const segment of ['0123456789abcdef', id('ff'), HELD, ...notKeys]) {
      const response = await cms.app.request(`/replies/${segment}/`);
      assert.equal(response.status, 404, `/replies/${segment}/`);
    }
  });
});

describe('source:comments', () => {
  it('counts direct replies and points at their feed, and is absent with none', async () => {
    const found = byGuid(await items(`${POST}feed/`));
    const expected: Record<string, { count: number; feed: string } | undefined> = {
      [commentPage(TOP)]: { count: 2, feed: `/replies/${TOP}/` },
      [commentPage(MIDDLE)]: { count: 1, feed: `/replies/${MIDDLE}/` },
      [NOTE]: { count: 1, feed: `/replies/${keyOf(NOTE)}/` },
      [NOTE_UNDER_NOTE]: { count: 1, feed: `/replies/${keyOf(NOTE_UNDER_NOTE)}/` },
      [GUS]: undefined,
      [commentPage(UNDER_HELD)]: undefined,
      [ANSWER_GUID]: undefined,
      [MAX]: undefined,
    };
    for (const [guid, pointer] of Object.entries(expected)) {
      const element = optional(found.get(guid) as XmlElement, 'source:comments');
      if (pointer === undefined) {
        assert.equal(element, undefined, `${guid} has no replies`);
        continue;
      }
      assert.ok(element !== undefined, `${guid} has replies`);
      assert.equal(element.attributes['count'], String(pointer.count), `${guid}'s count`);
      assert.equal(local(element.attributes['feedUrl'] ?? ''), pointer.feed, `${guid}'s feed`);
    }
  });

  it('on a post item points at its /replies/ feed, leaving the other two alone', async () => {
    const found = byGuid(await items('/feed/'));
    const hello = found.get(POST_GUID);
    assert.ok(hello !== undefined);
    assert.equal(child(hello, 'comments').text, `${POST_GUID}#comments`);
    assert.equal(child(hello, 'wfw:commentRss').text, `${POST_GUID}feed/`);
    const pointer = child(hello, 'source:comments');
    assert.equal(pointer.attributes['count'], '3');
    assert.equal(pointer.attributes['feedUrl'], `${BASE_URL}/replies/${keyOf(POST_GUID)}/`);

    const answer = found.get(ANSWER_GUID);
    assert.ok(answer !== undefined);
    assert.equal(optional(answer, 'source:comments'), undefined);
    assert.equal(child(answer, 'wfw:commentRss').text, `${ANSWER_GUID}feed/`);
  });
});

describe('<source url>', () => {
  it('names the feed of an author the site knows one for, and nobody else’s', async () => {
    const found = byGuid(await items(`${POST}feed/`));
    const webmention = child(found.get(GUS) as XmlElement, 'source');
    assert.equal(webmention.attributes['url'], 'https://gus.example/');
    assert.equal(webmention.text, 'Gus');

    const answer = child(found.get(ANSWER_GUID) as XmlElement, 'source');
    assert.equal(answer.attributes['url'], `${BASE_URL}/author/ada/feed/`);
    assert.equal(answer.text, 'Ada');

    for (const guid of [commentPage(TOP), NOTE]) {
      assert.equal(optional(found.get(guid) as XmlElement, 'source'), undefined, guid);
    }
  });
});

describe('walking a thread from the post', () => {
  it('reaches every reply exactly once', async () => {
    const hello = byGuid(await items('/feed/')).get(POST_GUID) as XmlElement;
    const queue = [child(hello, 'source:comments').attributes['feedUrl'] ?? ''];
    const reached: string[] = [];
    while (queue.length > 0) {
      for (const item of await items(local(queue.shift() ?? ''))) {
        reached.push(guidOf(item));
        const pointer = optional(item, 'source:comments');
        if (pointer !== undefined) queue.push(pointer.attributes['feedUrl'] ?? '');
      }
    }
    assert.deepEqual(reached.sort(), Object.keys(PARENTS).sort());
  });
});

describe('every URL the conversation prints (decision-51)', () => {
  it('names each comment and reply by a key, and percent-encodes no URL', async () => {
    const pages = [
      POST,
      `${POST}feed/`,
      '/comments/feed/',
      commentPage(TOP).slice(BASE_URL.length),
    ];
    const hello = byGuid(await items('/feed/')).get(POST_GUID) as XmlElement;
    const queue = [local(child(hello, 'source:comments').attributes['feedUrl'] ?? '')];
    while (queue.length > 0) {
      const feed = queue.shift() ?? '';
      pages.push(feed);
      for (const item of await items(feed)) {
        const pointer = optional(item, 'source:comments');
        if (pointer !== undefined) queue.push(local(pointer.attributes['feedUrl'] ?? ''));
      }
    }

    for (const pathname of pages) {
      const body = await (await cms.app.request(pathname)).text();
      const named =
        /(?:<li id="comment-|#comment-|\/comment\/|\/replies\/|reply_to=)([^"/<\s#&]+)/g;
      for (const [, name] of body.matchAll(named)) {
        assert.match(name ?? '', /^[0-9a-f]{16}$/, `${pathname} names ${name ?? ''} by a key`);
      }
    }
    const thread = await (await cms.app.request(POST)).text();
    assert.ok(
      thread.includes(`id="comment-${keyOf(NOTE)}"`),
      'a fediverse reply is anchored by key',
    );
    assert.ok(thread.includes(`id="comment-${TOP}"`), 'a comment by its key');
  });
});
