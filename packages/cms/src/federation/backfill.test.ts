/**
 * The fediverse replies nobody delivered (TASK-321).
 *
 * Ada answers a post from mastodon.social and her reply is delivered. Bob
 * answers Ada from hachyderm.io, which tells Ada's server and not this site,
 * so the only way the site learns of him is the `replies` collection Ada's
 * server publishes for her note. The network is a table in memory that
 * records every GET, and mastodon.social answers an unsigned GET with a 401,
 * as a server in authorized fetch mode does.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { discardDatabase } from '../cache.ts';
import type { Cms } from '../index.ts';
import { createConversation } from '../web/conversation.ts';
import type { ThreadReply } from '../web/conversation.ts';
import type { HostLookup } from '../webmention/public-address.ts';
import {
  BACKFILL_DEPTH,
  BACKFILL_INTERVAL_MS,
  BACKFILL_MAX_AGE_MS,
  BACKFILL_PAGES,
  createReplyBackfill,
} from './backfill.ts';
import { appendInboxActivity } from './records.ts';

const box = sandbox();

const BASE_URL = 'https://blog.example';
const LOCAL_USER = 'blog';
const PERMALINK = '/2026/09/hello/';
const POST = `${BASE_URL}${PERMALINK}`;
const POST_DATE = '2026-09-20T09:00:00Z';

const AS = 'https://www.w3.org/ns/activitystreams';
const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

const ADA = 'https://mastodon.social/users/ada';
const BOB = 'https://hachyderm.io/users/bob';
const CAROL = 'https://mastodon.social/users/carol';

const A = `${ADA}/statuses/1`;
const B = `${BOB}/statuses/2`;
const C = `${CAROL}/statuses/3`;

const ADDRESSES: Record<string, string[]> = {
  'mastodon.social': ['203.0.113.20'],
  'hachyderm.io': ['203.0.113.30'],
};

const lookup: HostLookup = (hostname) => {
  const found = ADDRESSES[hostname];
  return found === undefined
    ? Promise.reject(new Error(`getaddrinfo ENOTFOUND ${hostname}`))
    : Promise.resolve(found);
};

/** Every GET the stubbed web was asked, by URL. */
const requested: string[] = [];
/** What each URL answers; anything missing is a 404. */
let web: Record<string, () => Response> = {};
/** What answers a URL the table does not name, for the generated ones. */
let fallback: (url: string) => Response | undefined = () => undefined;

const original = globalThis.fetch;
before(() => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = request.url.replace(/#.*$/, '');
    if (request.method !== 'GET') return Promise.resolve(new Response('no', { status: 405 }));
    requested.push(url);
    const signed = request.headers.has('signature') || request.headers.has('signature-input');
    if (new URL(url).host === 'mastodon.social' && !signed) {
      return Promise.resolve(new Response('{"error":"Request not signed"}', { status: 401 }));
    }
    return Promise.resolve(
      web[url]?.() ?? fallback(url) ?? new Response('missing', { status: 404 }),
    );
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = original;
  await box.cleanup();
});

afterEach(() => {
  requested.length = 0;
  web = {};
  fallback = () => undefined;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/activity+json' },
  });
}

/** A public note as a Mastodon serves it, its page at `/@user/n` rather than its id. */
function note(
  id: string,
  inReplyTo: string,
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const actor = id.replace(/\/statuses\/.*$/, '');
  return {
    '@context': AS,
    id,
    type: 'Note',
    attributedTo: actor,
    inReplyTo,
    content: `<p>${text}</p>`,
    published: '2026-09-21T10:00:00Z',
    url: pageOf(id),
    to: [PUBLIC],
    cc: [`${actor}/followers`],
    replies: `${id}/replies`,
    ...extra,
  };
}

function pageOf(id: string): string {
  const url = new URL(id);
  const [, , user, , n] = url.pathname.split('/');
  return `${url.origin}/@${user ?? ''}/${n ?? ''}`;
}

/**
 * Serve a note and its replies collection the way Mastodon pages one: an
 * embedded first page of the author's own replies, empty here, and the
 * others' replies on the next page.
 */
function serveNote(body: Record<string, unknown>, items: readonly unknown[]): void {
  const id = String(body['id']);
  const others = `${id}/replies?only_other_accounts=true&page=true`;
  web[id] = () => json(body);
  web[`${id}/replies`] = () =>
    json({
      '@context': AS,
      id: `${id}/replies`,
      type: 'Collection',
      first: {
        id: `${id}/replies?page=true`,
        type: 'CollectionPage',
        partOf: `${id}/replies`,
        next: others,
        items: [],
      },
    });
  web[others] = () =>
    json({ '@context': AS, id: others, type: 'CollectionPage', partOf: `${id}/replies`, items });
}

/** Ada's delivered reply to the post, as the inbox log holds it. */
function deliveredLine(id: string, actor: string, inReplyTo: string): string {
  return `${JSON.stringify({
    receivedAt: '2026-09-21T10:05:00.000Z',
    recipient: LOCAL_USER,
    '@context': AS,
    id: `${id}/activity`,
    type: 'Create',
    actor,
    object: {
      id,
      type: 'Note',
      attributedTo: actor,
      inReplyTo,
      content: '<p>Ada says hello.</p>',
      published: '2026-09-21T10:00:00Z',
      url: pageOf(id),
      to: [PUBLIC],
    },
  })}\n`;
}

interface Site {
  cms: Cms;
  contentDir: string;
  dataDir: string;
  clock: { at: Date };
}

async function site(
  log = deliveredLine(A, ADA, POST),
  clock = { at: new Date('2026-09-29T12:00:00Z') },
): Promise<Site> {
  const contentDir = await box.dir('geekity-backfill-content-');
  const dataDir = await box.dir('geekity-backfill-data-');
  const files: Record<string, string> = {
    'posts/hello.md': [
      '---',
      'title: Hello',
      `date: '${POST_DATE}'`,
      `permalink: ${PERMALINK}`,
      '---',
      '',
      'Words.',
      '',
    ].join('\n'),
    '_data/site.json': JSON.stringify({ title: 'A Site', baseUrl: BASE_URL, author: LOCAL_USER }),
    '_data/federation/inbox/2026-09.jsonl': log,
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  writeUsers(dataDir, [{ username: LOCAL_USER, profile: { displayName: 'Blog' } }]);
  return { cms: await boot(contentDir, dataDir, clock), contentDir, dataDir, clock };
}

async function boot(contentDir: string, dataDir: string, clock: { at: Date }): Promise<Cms> {
  return await box.open(
    {
      contentDir,
      dataDir,
      baseUrl: BASE_URL,
      hostLookup: lookup,
      now: () => clock.at,
      federation: { queue: null, allowPrivateAddress: true },
    },
    { actorKeys: [LOCAL_USER] },
  );
}

/** The thread under the post, as ids nested the way a reader sees them. */
function tree(cms: Cms, contentDir: string): unknown[] {
  const post = cms.store.getByPermalink(PERMALINK);
  assert.ok(post);
  const reader = createConversation({
    admin: cms.admin,
    store: cms.store,
    contentDir,
    baseUrl: BASE_URL,
    users: () => [],
  });
  const shape = (replies: readonly ThreadReply[]): unknown[] =>
    replies.map((reply) =>
      reply.replies.length === 0 ? reply.id : { [reply.id]: shape(reply.replies) },
    );
  return shape(reader.thread(post).replies);
}

function creates(cms: Cms, noteId: string) {
  return cms.admin
    .listActivitiesAbout([noteId])
    .filter((activity) => activity.activityType === 'Create' && activity.objectId === noteId);
}

describe('a reply answering a fediverse reply (AC #1)', () => {
  it('is read off the replies collection and threaded under it, with its own URL', async () => {
    serveNote(note(A, POST, 'Ada says hello.'), [B]);
    serveNote(note(B, A, 'Bob answers Ada.'), [C]);
    serveNote(note(C, B, 'Carol answers Bob.'), []);
    const { cms, contentDir } = await site();

    await cms.replyBackfill.sweep();

    assert.deepEqual(tree(cms, contentDir), [{ [A]: [{ [B]: [C] }] }]);
    const page = await (await cms.app.request(PERMALINK)).text();
    assert.match(page, /Bob answers Ada\./);
    assert.match(page, /Carol answers Bob\./);
    assert.ok(page.includes(`href="${pageOf(B)}"`), 'links Bob’s reply where it lives');
    assert.ok(requested.includes(A), 'read Ada’s note');
    assert.equal(creates(cms, B)[0]?.fetched, true);
    assert.equal(creates(cms, B)[0]?.actorId, BOB);
  });

  it('is logged as a fetched line that a rebuilt index reads back', async () => {
    serveNote(note(A, POST, 'Ada says hello.'), [B]);
    serveNote(note(B, A, 'Bob answers Ada.'), []);
    const { cms, contentDir, dataDir, clock } = await site();
    await cms.replyBackfill.sweep();

    const log = await readFile(
      path.join(contentDir, '_data', 'federation', 'inbox', '2026-09.jsonl'),
      'utf8',
    );
    const line = log
      .trim()
      .split('\n')
      .map((row) => JSON.parse(row) as Record<string, unknown>)
      .find((row) => row['type'] === 'Create' && JSON.stringify(row['object']).includes(B));
    assert.equal(line?.['fetched'], true);
    assert.equal(line?.['actor'], BOB);

    await cms.close();
    discardDatabase(dataDir);
    const rebuilt = await boot(contentDir, dataDir, clock);
    assert.deepEqual(tree(rebuilt, contentDir), [{ [A]: [B] }]);
    assert.equal(creates(rebuilt, B)[0]?.fetched, true);
    assert.equal(creates(rebuilt, A)[0]?.fetched, false);
  });

  it('keeps only public replies to the note, by somebody on their own server, from elsewhere', async () => {
    const own = `${BASE_URL}/2026/09/answer/`;
    const elsewhere = `${BOB}/statuses/20`;
    const private_ = `${BOB}/statuses/21`;
    const forged = `${BOB}/statuses/22`;
    serveNote(note(A, POST, 'Ada says hello.'), [own, elsewhere, private_, forged, B]);
    serveNote(note(elsewhere, 'https://hachyderm.io/users/bob/statuses/1', 'Not to Ada.'), []);
    serveNote(note(private_, A, 'Just for Ada.', { to: [ADA], cc: [] }), []);
    serveNote(note(forged, A, 'Carol never said this.', { attributedTo: CAROL }), []);
    serveNote(note(B, A, 'Bob answers Ada.'), []);
    const { cms, contentDir } = await site();

    await cms.replyBackfill.sweep();

    assert.deepEqual(tree(cms, contentDir), [{ [A]: [B] }]);
    assert.ok(!requested.some((url) => url.startsWith(BASE_URL)), 'never reads this site');
  });
});

describe('the bounds (AC #2)', () => {
  it('reads a thread once per interval', async () => {
    serveNote(note(A, POST, 'Ada says hello.'), []);
    const { cms, clock } = await site();

    await cms.replyBackfill.sweep();
    assert.ok(requested.includes(A));

    requested.length = 0;
    clock.at = new Date(clock.at.getTime() + BACKFILL_INTERVAL_MS - 60_000);
    await cms.replyBackfill.sweep();
    assert.equal(requested.length, 0);

    clock.at = new Date(clock.at.getTime() + 120_000);
    await cms.replyBackfill.sweep();
    assert.ok(requested.includes(A));
  });

  it('does not read a thread whose post is older than the age limit', async () => {
    serveNote(note(A, POST, 'Ada says hello.'), []);
    const { cms } = await site(undefined, {
      at: new Date(Date.parse(POST_DATE) + BACKFILL_MAX_AGE_MS + 60_000),
    });

    await cms.replyBackfill.sweep();

    assert.deepEqual(requested, []);
  });

  it('reads collections no deeper than the depth limit', async () => {
    const chain = (n: number): string => `${ADA}/statuses/chain-${String(n)}`;
    fallback = (url) => {
      const match = /\/statuses\/chain-(\d+)(\/replies)?$/.exec(url);
      if (match === null) return undefined;
      const n = Number(match[1]);
      const id = chain(n);
      return match[2] === undefined
        ? json(note(id, n === 1 ? POST : chain(n - 1), `Reply ${String(n)}.`))
        : json({ '@context': AS, id: `${id}/replies`, type: 'Collection', items: [chain(n + 1)] });
    };
    const { cms } = await site(deliveredLine(chain(1), ADA, POST));

    await cms.replyBackfill.sweep();

    const held = Array.from({ length: BACKFILL_DEPTH + 3 }, (_, n) => n + 1).filter(
      (n) => creates(cms, chain(n)).length > 0,
    );
    assert.deepEqual(
      held,
      Array.from({ length: BACKFILL_DEPTH + 1 }, (_, n) => n + 1),
    );
    assert.ok(requested.includes(`${chain(BACKFILL_DEPTH)}/replies`));
    assert.ok(!requested.includes(`${chain(BACKFILL_DEPTH + 1)}/replies`));
  });

  it('reads no more pages of one collection than the page limit', async () => {
    const pageUrl = (n: number): string => `${A}/replies?page=${String(n)}`;
    const reply = (n: number): string => `${BOB}/statuses/page-${String(n)}`;
    web[A] = () => json(note(A, POST, 'Ada says hello.', { replies: pageUrl(1) }));
    fallback = (url) => {
      const pageMatch = /replies\?page=(\d+)$/.exec(url);
      if (pageMatch !== null) {
        const n = Number(pageMatch[1]);
        return json({
          '@context': AS,
          id: pageUrl(n),
          type: 'CollectionPage',
          next: pageUrl(n + 1),
          items: [reply(n)],
        });
      }
      const replyMatch = /\/statuses\/page-(\d+)(\/replies)?$/.exec(url);
      if (replyMatch === null || replyMatch[2] !== undefined) return undefined;
      return json(note(reply(Number(replyMatch[1])), A, 'Another.', { replies: undefined }));
    };
    const { cms } = await site();

    await cms.replyBackfill.sweep();

    const pages = requested.filter((url) => url.startsWith(`${A}/replies`));
    assert.deepEqual(
      pages,
      Array.from({ length: BACKFILL_PAGES }, (_, n) => pageUrl(n + 1)),
    );
    assert.equal(creates(cms, reply(BACKFILL_PAGES)).length, 1);
  });
});

describe('a reply held once and dropped when the remote drops it (AC #3)', () => {
  it('is not logged again when the inbox already holds it', async () => {
    serveNote(note(A, POST, 'Ada says hello.'), [B]);
    serveNote(note(B, A, 'Bob answers Ada.'), []);
    const { cms, contentDir } = await site(deliveredLine(A, ADA, POST) + deliveredLine(B, BOB, A));

    await cms.replyBackfill.sweep();

    assert.equal(creates(cms, B).length, 1);
    assert.equal(creates(cms, B)[0]?.fetched, false);
    assert.deepEqual(tree(cms, contentDir), [{ [A]: [B] }]);
  });

  it('gives way to the delivery when the reply is delivered later', async () => {
    serveNote(note(A, POST, 'Ada says hello.'), [B]);
    serveNote(note(B, A, 'Bob answers Ada.'), []);
    const { cms, contentDir } = await site();
    await cms.replyBackfill.sweep();
    assert.equal(creates(cms, B)[0]?.fetched, true);

    const delivered = JSON.parse(deliveredLine(B, BOB, A)) as Record<string, unknown>;
    delete delivered['receivedAt'];
    delete delivered['recipient'];
    await appendInboxActivity({ admin: cms.admin, contentDir }, JSON.stringify(delivered), {
      receivedAt: '2026-09-29T13:00:00.000Z',
    });

    assert.equal(creates(cms, B).length, 1);
    assert.equal(creates(cms, B)[0]?.fetched, false);
    assert.deepEqual(tree(cms, contentDir), [{ [A]: [B] }]);
    const log = await readFile(
      path.join(contentDir, '_data', 'federation', 'inbox', '2026-09.jsonl'),
      'utf8',
    );
    assert.ok(!log.includes('"fetched":true'), 'the fetched line is gone from the log');
  });

  it('is removed, with the fetched replies under it, when its server says it is gone', async () => {
    serveNote(note(A, POST, 'Ada says hello.'), [B]);
    serveNote(note(B, A, 'Bob answers Ada.'), [C]);
    serveNote(note(C, B, 'Carol answers Bob.'), []);
    const { cms, contentDir, clock } = await site();
    await cms.replyBackfill.sweep();
    assert.deepEqual(tree(cms, contentDir), [{ [A]: [{ [B]: [C] }] }]);

    web[B] = () => new Response('gone', { status: 410 });
    clock.at = new Date(clock.at.getTime() + BACKFILL_INTERVAL_MS);
    await cms.replyBackfill.sweep();

    assert.deepEqual(tree(cms, contentDir), [A]);
    assert.equal(creates(cms, B).length, 0);
    assert.equal(creates(cms, C).length, 0);
    const page = await (await cms.app.request(PERMALINK)).text();
    assert.doesNotMatch(page, /Bob answers Ada\./);
  });

  it('is removed when the collection no longer lists it', async () => {
    serveNote(note(A, POST, 'Ada says hello.'), [B]);
    serveNote(note(B, A, 'Bob answers Ada.'), []);
    const { cms, contentDir, clock } = await site();
    await cms.replyBackfill.sweep();
    assert.deepEqual(tree(cms, contentDir), [{ [A]: [B] }]);

    serveNote(note(A, POST, 'Ada says hello.'), []);
    clock.at = new Date(clock.at.getTime() + BACKFILL_INTERVAL_MS);
    await cms.replyBackfill.sweep();

    assert.deepEqual(tree(cms, contentDir), [A]);
  });

  it('leaves a delivered reply alone whatever its server says', async () => {
    web[A] = () => new Response('gone', { status: 410 });
    serveNote(note(B, A, 'Bob answers Ada.'), []);
    web[B] = () => new Response('gone', { status: 404 });
    const { cms, contentDir } = await site(deliveredLine(A, ADA, POST) + deliveredLine(B, BOB, A));

    await cms.replyBackfill.sweep();

    assert.deepEqual(tree(cms, contentDir), [{ [A]: [B] }]);
  });

  it('keeps an unlisted reply when the collection was not read to its end', async () => {
    serveNote(note(A, POST, 'Ada says hello.'), [B]);
    serveNote(note(B, A, 'Bob answers Ada.'), []);
    const { cms, contentDir, clock } = await site();
    await cms.replyBackfill.sweep();

    const pageUrl = (n: number): string => `${A}/replies?page=${String(n)}`;
    web[A] = () => json(note(A, POST, 'Ada says hello.', { replies: pageUrl(1) }));
    fallback = (url) => {
      const match = /replies\?page=(\d+)$/.exec(url);
      if (match === null) return undefined;
      const n = Number(match[1]);
      return json({
        '@context': AS,
        id: pageUrl(n),
        type: 'CollectionPage',
        next: pageUrl(n + 1),
        items: [],
      });
    };
    clock.at = new Date(clock.at.getTime() + BACKFILL_INTERVAL_MS);
    await cms.replyBackfill.sweep();

    assert.deepEqual(tree(cms, contentDir), [{ [A]: [B] }]);
  });
});

describe('a server that publishes nothing or fails (AC #4)', () => {
  it('leaves the thread as it was when the note has no replies collection', async () => {
    web[A] = () => json(note(A, POST, 'Ada says hello.', { replies: undefined }));
    const { cms, contentDir } = await site();

    await cms.replyBackfill.sweep();

    assert.deepEqual(tree(cms, contentDir), [A]);
    assert.ok(requested.includes(A));
  });

  it('keeps what it holds when a server errors', async () => {
    serveNote(note(A, POST, 'Ada says hello.'), [B]);
    serveNote(note(B, A, 'Bob answers Ada.'), [C]);
    serveNote(note(C, B, 'Carol answers Bob.'), []);
    const { cms, contentDir, clock } = await site();
    await cms.replyBackfill.sweep();

    web[A] = () => new Response('boom', { status: 500 });
    web[`${B}/replies`] = () => new Response('boom', { status: 503 });
    requested.length = 0;
    clock.at = new Date(clock.at.getTime() + BACKFILL_INTERVAL_MS);
    await cms.replyBackfill.sweep();

    assert.deepEqual(tree(cms, contentDir), [{ [A]: [{ [B]: [C] }] }]);
    assert.ok(requested.includes(`${C}/replies`), 'went on to the next reply');
    const response = await cms.app.request(PERMALINK);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Carol answers Bob\./);
  });

  it('reports a loader that throws and goes on to the next reply', async () => {
    const { cms, contentDir } = await site(deliveredLine(A, ADA, POST) + deliveredLine(B, BOB, A));
    const warnings: string[] = [];
    const asked: string[] = [];
    const backfill = createReplyBackfill({
      admin: cms.admin,
      store: cms.store,
      conversation: createConversation({
        admin: cms.admin,
        store: cms.store,
        contentDir,
        baseUrl: BASE_URL,
        users: () => [],
      }),
      config: cms.config,
      load: (noteId) => {
        asked.push(noteId);
        return noteId === A
          ? Promise.reject(new Error('the server fell over'))
          : Promise.resolve({ kind: 'read', listed: new Set(), notes: [], complete: true });
      },
      logger: { warn: (message) => warnings.push(message) },
    });

    await backfill.sweep();

    assert.deepEqual(asked, [A, B]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /the server fell over/);
    assert.deepEqual(tree(cms, contentDir), [{ [A]: [B] }]);
  });
});
