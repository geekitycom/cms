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
 * A feed of comments or replies carries what was said (TASK-335): replies and
 * mentions. A like, a boost or a repost says nothing, so no feed carries one
 * and no count advertises one, and it stays on the page as before. An RSVP
 * to an event is shown with the people answering rather than in the thread,
 * so it is no feed's either; one sent to a post that is no event is a reply.
 */

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';
const HELLO = '/2026/09/hello/';
const LIKED = '/2026/09/liked/';
const CAMP = '/2026/09/camp/';

function id(which: string): string {
  return `0000${which.padStart(12, '0')}`;
}

const REPLY = id('a1');
const WEBMENTION_REPLY = id('a2');
const RSVP_REPLY = id('a3');
const MENTION = id('a4');
const LIKE = id('b1');
const REPOST = id('b2');
const BOOST = id('b3');
const ONLY_LIKE = id('c1');
const ONLY_REPOST = id('c2');
const GOING = id('d1');

const GUS = 'https://gus.example/reply';
const IVY = 'https://ivy.example/rsvp';
const MAX = 'https://max.example/linked';
const CAMP_RSVP = 'https://kim.example/rsvp';

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

function reaction(
  which: string,
  name: string,
  minute: number,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return said(which, name, minute, {
    source: 'webmention',
    content: { markdown: '', html: '' },
    author: { name, url: `https://${name.toLowerCase()}.example/`, email: null, avatar: null },
    ...values,
  });
}

function post(slug: string, permalink: string, extra: string[] = []): string {
  return [
    '---',
    `title: ${slug}`,
    "date: '2026-09-02T09:00:00Z'",
    'author: ada',
    `permalink: ${permalink}`,
    ...extra,
    '---',
    '',
    'Words of its own.',
    '',
  ].join('\n');
}

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/2026-09-02-hello.md': post('hello', HELLO),
  'posts/2026-09-02-liked.md': post('liked', LIKED),
  'posts/2026-09-02-camp.md': post('camp', CAMP, ["start: '2026-10-10T14:00:00Z'"]),
  '_data/comments/hello.json': JSON.stringify({
    post: HELLO,
    comments: [
      said(REPLY, 'Nia', 1),
      said(WEBMENTION_REPLY, 'Gus', 2, { source: 'webmention', url: GUS }),
      said(RSVP_REPLY, 'Ivy', 3, { source: 'webmention', url: IVY, rsvp: 'yes' }),
      said(MENTION, 'Max', 4, { source: 'webmention', kind: 'mention', url: MAX }),
      reaction(LIKE, 'Lou', 5, { kind: 'like', url: 'https://lou.example/like' }),
      reaction(REPOST, 'Ray', 6, { kind: 'repost', url: 'https://ray.example/repost' }),
      reaction(BOOST, 'Bo', 7, {
        source: 'activitypub',
        kind: 'boost',
        url: 'https://remote.example/@bo',
      }),
    ],
  }),
  '_data/comments/liked.json': JSON.stringify({
    post: LIKED,
    comments: [
      reaction(ONLY_LIKE, 'Lou', 8, { kind: 'like', url: 'https://lou.example/like2' }),
      reaction(ONLY_REPOST, 'Ray', 9, { kind: 'repost', url: 'https://ray.example/repost2' }),
    ],
  }),
  '_data/comments/camp.json': JSON.stringify({
    post: CAMP,
    comments: [
      said(GOING, 'Kim', 10, {
        source: 'webmention',
        url: CAMP_RSVP,
        rsvp: 'yes',
        content: { markdown: 'See you there.', html: '<p>See you there.</p>' },
      }),
    ],
  }),
};

/** The guids each feed of HELLO carries: its replies and its mention. */
const SPOKEN = [`${BASE_URL}/comment/${REPLY}/`, GUS, IVY, MAX];

let cms: Cms;

before(async () => {
  const contentDir = await box.dir('geekity-conversational-content-');
  const dataDir = await box.dir('geekity-conversational-data-');
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

async function guids(pathname: string): Promise<string[]> {
  return (await items(pathname)).map(guidOf).sort();
}

function pointerOf(item: XmlElement): XmlElement | undefined {
  return item.children.find((element) => element.name === 'source:comments');
}

async function postItem(permalink: string): Promise<XmlElement> {
  const found = (await items('/feed/')).find((item) => guidOf(item) === `${BASE_URL}${permalink}`);
  assert.ok(found !== undefined, `${permalink} is in /feed/`);
  return found;
}

describe('the comments feeds', () => {
  it('/comments/feed/ carries replies and mentions, and no like, boost, repost or event RSVP', async () => {
    assert.deepEqual(await guids('/comments/feed/'), [...SPOKEN].sort());
  });

  it('{permalink}feed/ carries the post’s replies and mention only', async () => {
    assert.deepEqual(await guids(`${HELLO}feed/`), [...SPOKEN].sort());
  });

  it('{permalink}feed/ of a post with only reactions, or only event RSVPs, is empty', async () => {
    assert.deepEqual(await guids(`${LIKED}feed/`), []);
    assert.deepEqual(await guids(`${CAMP}feed/`), []);
  });
});

describe('the replies feeds and the counts', () => {
  it('/replies/{key}/ of a post lists its replies and no reaction', async () => {
    assert.deepEqual(
      await guids(`/replies/${keyOf(`${BASE_URL}${HELLO}`)}/`),
      [`${BASE_URL}/comment/${REPLY}/`, GUS, IVY].sort(),
    );
    assert.deepEqual(await guids(`/replies/${keyOf(`${BASE_URL}${LIKED}`)}/`), []);
  });

  it('source:comments counts the replies only', async () => {
    const pointer = pointerOf(await postItem(HELLO));
    assert.ok(pointer !== undefined, 'the post with replies advertises them');
    assert.equal(pointer.attributes['count'], '3');
  });

  it('a post answered only with reactions or event RSVPs advertises no replies feed', async () => {
    assert.equal(pointerOf(await postItem(LIKED)), undefined);
    assert.equal(pointerOf(await postItem(CAMP)), undefined);
  });
});

describe('the page', () => {
  it('still shows the reactions with their counts', async () => {
    const page = await body(HELLO);
    for (const [kind, count] of [
      ['p-like', '1'],
      ['p-repost', '2'],
      ['p-mention', '1'],
    ] as const) {
      assert.match(
        page,
        new RegExp(
          `reaction-group ${kind}">\\s*<h2 class="reaction-title">[^<]*<span class="reaction-count">${count}</span>`,
        ),
        `${kind} shows ${count}`,
      );
    }
    for (const name of ['Lou', 'Ray', 'Bo', 'Max']) assert.ok(page.includes(name), name);
    const liked = await body(LIKED);
    assert.match(
      liked,
      /reaction-group p-like">\s*<h2 class="reaction-title">[^<]*<span class="reaction-count">1</,
    );
    assert.match(
      liked,
      /reaction-group p-repost">\s*<h2 class="reaction-title">[^<]*<span class="reaction-count">1</,
    );
  });

  it('shows the event RSVP with the people going', async () => {
    assert.match(
      await body(CAMP),
      /reaction-group rsvp-yes">\s*<h2 class="reaction-title">[^<]*<span class="reaction-count">1</,
    );
  });
});
