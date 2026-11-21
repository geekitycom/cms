import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportJwk, importJwk, signRequest } from '@fedify/fedify';
import {
  Create,
  CryptographicKey,
  Delete,
  Endpoints,
  Follow,
  Note,
  Person,
  Tombstone,
  Update,
} from '@fedify/vocab';

import { writeUsers } from '../admin/__testing__/users.ts';
import { readComments } from '../comments/records.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import type { OutgoingMail } from '../mail/provider.ts';
import type { FediverseReplyRule } from '../site/fediverse-replies.ts';
import { DEFAULT_SITE_SETTINGS } from '../site/settings.ts';
import { listUsers, setUserNotificationMode } from '../site/users.ts';
import { writeSiteSettings } from '../__testing__/site-settings.ts';
import { seedActorKeys, testKeyPair } from './__testing__/keys.ts';
import { repliesKey } from '../content/guids.ts';
import { appendInboxActivity, readInboxLog } from './records.ts';

/**
 * Which fediverse replies show on a page at once and which wait for review,
 * driven through the inbox with signed deliveries, the mail a held reply
 * sends, its moderation links, and the page a reader is served.
 */

const BASE_URL = 'https://blog.example';
const NOW = new Date('2026-09-20T12:00:00.000Z');
const LOCAL_USER = 'blog';
const SITE_INBOX = `${BASE_URL}/author/${LOCAL_USER}/inbox/`;
const PERMALINK = '/2026/09/hello-world/';
const POST_ID = `${BASE_URL}${PERMALINK}`;

const REMOTE_ORIGIN = 'https://remote.example';

interface Peer {
  readonly id: string;
  readonly username: string;
  keys: CryptoKeyPair;
  document: unknown;
}

/** A follower once they have followed, and a stranger who never does. */
const ADA: Peer = peer('ada');
const BOB: Peer = peer('bob');

function peer(username: string): Peer {
  return {
    id: `${REMOTE_ORIGIN}/users/${username}`,
    username,
    keys: undefined as unknown as CryptoKeyPair,
    document: undefined,
  };
}

const POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: ${PERMALINK}
---

Words.
`;

const started: Cms[] = [];
const temporaryDirs: string[] = [];
let restoreFetch: () => void;

before(async () => {
  ADA.keys = await testKeyPair(1);
  BOB.keys = await testKeyPair(2);
  for (const one of [ADA, BOB]) one.document = await actorDocument(one);
  restoreFetch = routeRemoteHost();
});

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function actorDocument(one: Peer): Promise<unknown> {
  const person = new Person({
    id: new URL(one.id),
    preferredUsername: one.username,
    name: one.username === 'ada' ? 'Ada Lovelace' : 'Bob Stranger',
    inbox: new URL(`${one.id}/inbox`),
    endpoints: new Endpoints({ sharedInbox: new URL(`${REMOTE_ORIGIN}/inbox`) }),
    publicKey: new CryptographicKey({
      id: new URL(`${one.id}#main-key`),
      owner: new URL(one.id),
      publicKey: await importJwk(await exportJwk(one.keys.publicKey), 'public'),
    }),
  });
  return await person.toJsonLd();
}

function routeRemoteHost(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== REMOTE_ORIGIN) return await original(input, init);
    if (request.method === 'POST') return new Response('', { status: 202 });
    const found = [ADA, BOB].find((one) => new URL(one.id).pathname === url.pathname);
    if (found === undefined) return new Response('Not found.', { status: 404 });
    return new Response(JSON.stringify(found.document), {
      headers: { 'content-type': 'application/activity+json' },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

interface Site {
  cms: Cms;
  provider: MemoryMailProvider;
  contentDir: string;
  dataDir: string;
}

async function site(rule?: FediverseReplyRule): Promise<Site> {
  const contentDir = await temporaryDir('geekity-review-content-');
  const dataDir = await temporaryDir('geekity-review-data-');
  seedActorKeys(dataDir, LOCAL_USER);
  const file = path.join(contentDir, 'posts/2026-09-19-hello-world.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, POST, 'utf8');
  await writeSiteSettings({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'A Site',
      base_url: BASE_URL,
      author: LOCAL_USER,
      ...(rule === undefined ? {} : { fediverse_replies: rule }),
    },
  });
  writeUsers(dataDir, [{ username: LOCAL_USER, email: 'blog@example.com' }]);
  return boot({ contentDir, dataDir, provider: createMemoryMailProvider() });
}

async function boot(dirs: Omit<Site, 'cms'>): Promise<Site> {
  const cms = createCms({
    contentDir: dirs.contentDir,
    dataDir: dirs.dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    federation: { queue: null, allowPrivateAddress: true },
    mail: {
      provider: dirs.provider,
      backoffMs: () => 0,
      logger: { info: () => {}, warn: () => {} },
    },
  });
  started.push(cms);
  await cms.sync();
  return { ...dirs, cms };
}

async function deliver(
  box: Site,
  from: Peer,
  activity: { toJsonLd(): Promise<unknown> },
): Promise<void> {
  const request = new Request(SITE_INBOX, {
    method: 'POST',
    headers: { 'content-type': 'application/activity+json' },
    body: JSON.stringify(await activity.toJsonLd()),
  });
  const signed = await signRequest(request, from.keys.privateKey, new URL(`${from.id}#main-key`));
  const response = await box.cms.app.request(signed);
  assert.ok(response.status < 300, `the inbox took it: ${response.status}`);
  await box.cms.actorProfiles.settled();
  await box.cms.notifications.settled();
  await box.cms.mail.settled();
}

function noteId(from: Peer, n: number): string {
  return `${from.id}/statuses/${n}`;
}

function note(from: Peer, n: number, content: string, inReplyTo = POST_ID): Note {
  return new Note({
    id: new URL(noteId(from, n)),
    attribution: new URL(from.id),
    content,
    replyTarget: new URL(inReplyTo),
    published: Temporal.Instant.from('2026-09-20T11:00:00Z'),
  });
}

async function reply(
  box: Site,
  from: Peer,
  n: number,
  content: string,
  inReplyTo = POST_ID,
): Promise<void> {
  await deliver(
    box,
    from,
    new Create({
      id: new URL(`${noteId(from, n)}/activity`),
      actor: new URL(from.id),
      object: note(from, n, content, inReplyTo),
    }),
  );
}

async function follow(box: Site, from: Peer): Promise<void> {
  await deliver(
    box,
    from,
    new Follow({
      id: new URL(`${from.id}/follows/1`),
      actor: new URL(from.id),
      object: new URL(`${BASE_URL}/author/${LOCAL_USER}/`),
    }),
  );
}

async function page(box: Site): Promise<string> {
  const response = await box.cms.app.request(PERMALINK);
  assert.equal(response.status, 200);
  return await response.text();
}

function times(html: string, text: string): number {
  return html.split(text).length - 1;
}

function stored(box: Site) {
  return readComments(box.cms.config, 'hello-world');
}

function onlyMessage(provider: MemoryMailProvider): OutgoingMail {
  assert.equal(provider.sent.length, 1, `exactly one message went, not ${provider.sent.length}`);
  const [message] = provider.sent;
  assert.ok(message !== undefined);
  return message;
}

/** The one waiting-for-review notice, among whatever published notices went too. */
function waitingNotice(provider: MemoryMailProvider): OutgoingMail {
  const waiting = provider.sent.filter((message) => /\/_geekity\//.test(message.text));
  assert.equal(waiting.length, 1, `exactly one notice waits, not ${waiting.length}`);
  const [message] = waiting;
  assert.ok(message !== undefined);
  return message;
}

function linkFor(message: OutgoingMail, action: string): string {
  const found = (message.text.match(/https:\/\/blog\.example\/_geekity\/\S+/g) ?? []).find(
    (link) => new URL(link).searchParams.get('action') === action,
  );
  assert.ok(found !== undefined, `no ${action} link in:\n${message.text}`);
  return found;
}

async function confirm(box: Site, link: string): Promise<void> {
  const url = new URL(link);
  const response = await box.cms.app.request(url.pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: url.searchParams.toString(),
  });
  assert.equal(response.status, 200);
  await box.cms.notifications.settled();
  await box.cms.mail.settled();
}

describe('the default rule: followers and approved accounts show, the rest wait', () => {
  it('holds a stranger’s reply in the queue as a pending comment, off the page', async () => {
    const box = await site();

    await reply(box, BOB, 1, 'A stranger says hello.');

    const [held] = stored(box);
    assert.equal(held?.status, 'pending');
    assert.equal(held?.source, 'activitypub');
    assert.equal(held?.origin, noteId(BOB, 1));
    assert.equal(held?.actor, BOB.id);
    assert.equal(held?.inReplyTo, null);
    assert.equal(box.cms.admin.countCommentsByStatus().pending, 1);
    assert.equal(times(await page(box), 'A stranger says hello.'), 0);
  });

  it('shows a follower’s reply at once and queues nothing', async () => {
    const box = await site();
    await follow(box, ADA);

    await reply(box, ADA, 1, 'A follower says hello.');

    assert.deepEqual(stored(box), []);
    assert.equal(times(await page(box), 'A follower says hello.'), 1);
    assert.doesNotMatch(onlyMessage(box.provider).text, /\/_geekity\//, 'nothing to moderate');
  });

  it('sends the waiting-for-review notice, whose approve link puts it on the page once', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'A stranger says hello.');

    const message = onlyMessage(box.provider);
    assert.match(message.text, /A stranger says hello\./);
    await confirm(box, linkFor(message, 'approve'));

    assert.equal(stored(box)[0]?.status, 'approved');
    assert.equal(times(await page(box), 'A stranger says hello.'), 1);
  });

  it('names an approved held reply from its author’s profile, as a shown reply is', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'A stranger says hello.');
    await confirm(box, linkFor(onlyMessage(box.provider), 'approve'));

    assert.equal(times(await page(box), 'Bob Stranger'), 1);
  });

  it('lets an account with an approved reply through next time', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'First word.');
    await confirm(box, linkFor(onlyMessage(box.provider), 'approve'));

    await reply(box, BOB, 2, 'Second word.');

    assert.equal(stored(box).length, 1, 'the second reply was not stored');
    assert.equal(box.provider.sent.length, 2, 'and the second notice says it is published');
    assert.match(box.provider.sent[1]?.text ?? '', /Second word\./);
    assert.doesNotMatch(box.provider.sent[1]?.text ?? '', /\/_geekity\//);
    const html = await page(box);
    assert.equal(times(html, 'First word.'), 1);
    assert.equal(times(html, 'Second word.'), 1);
  });

  it('keeps a reply filed as spam off the page, and the account still waits', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'Buy things.');
    await confirm(box, linkFor(onlyMessage(box.provider), 'spam'));

    await reply(box, BOB, 2, 'Buy more things.');

    assert.equal(stored(box).find((one) => one.origin === noteId(BOB, 1))?.status, 'spam');
    assert.equal(stored(box).find((one) => one.origin === noteId(BOB, 2))?.status, 'pending');
    const html = await page(box);
    assert.equal(times(html, 'Buy things.'), 0);
    assert.equal(times(html, 'Buy more things.'), 0);
  });

  it('keeps a reply a moderator deleted off the page, and out of the inbox log', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'Something rude.');

    await confirm(box, linkFor(onlyMessage(box.provider), 'delete'));

    assert.deepEqual(stored(box), []);
    assert.equal(times(await page(box), 'Something rude.'), 0);
    assert.ok(
      !readInboxLog(box.contentDir).some((line) => line.json.includes(noteId(BOB, 1))),
      'the logged Create went with it',
    );
  });

  it('threads a reply to a held reply under it, and both once after approval', async () => {
    const box = await site();
    await follow(box, ADA);
    await reply(box, BOB, 1, 'The stranger’s point.');
    await reply(box, ADA, 1, 'The follower answers it.', noteId(BOB, 1));

    const waiting = await page(box);
    assert.equal(times(waiting, 'The stranger’s point.'), 0);
    assert.equal(times(waiting, 'The follower answers it.'), 1);

    await confirm(box, linkFor(waitingNotice(box.provider), 'approve'));

    const html = await page(box);
    assert.equal(times(html, 'The stranger’s point.'), 1);
    assert.equal(times(html, 'The follower answers it.'), 1);
    assert.ok(
      html.indexOf('The stranger’s point.') < html.indexOf('The follower answers it.'),
      'the answer sits under the reply it answers',
    );
  });

  it('holds a stranger’s reply to a shown reply, answering that reply', async () => {
    const box = await site();
    await follow(box, ADA);
    await reply(box, ADA, 1, 'The follower’s point.');

    await reply(box, BOB, 1, 'The stranger answers.', noteId(ADA, 1));

    const [held] = stored(box);
    assert.equal(held?.status, 'pending');
    assert.equal(held?.inReplyTo, noteId(ADA, 1));
    await confirm(box, linkFor(waitingNotice(box.provider), 'approve'));
    const html = await page(box);
    assert.equal(times(html, 'The stranger answers.'), 1);
    assert.ok(html.indexOf('The follower’s point.') < html.indexOf('The stranger answers.'));
  });
});

describe('the waiting-for-review notice for a held reply', () => {
  it('waits for the digest when the user chose one', async () => {
    const box = await site();
    const [user] = listUsers(box.dataDir);
    assert.ok(user !== undefined);
    await setUserNotificationMode({
      dataDir: box.dataDir,
      userId: user.id,
      event: 'comments',
      mode: 'hourly',
    });

    await reply(box, BOB, 1, 'For the digest.');

    assert.equal(box.provider.sent.length, 0, 'nothing went as it arrived');
    assert.equal(await box.cms.digests.run(), 1);
    await box.cms.mail.settled();
    assert.match(onlyMessage(box.provider).text, /For the digest\./);
  });
});

describe('a held reply its author changes', () => {
  it('leaves the queue when its author deletes it, and stays off the page', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'Second thoughts.');

    await deliver(
      box,
      BOB,
      new Delete({
        id: new URL(`${noteId(BOB, 1)}#delete`),
        actor: new URL(BOB.id),
        object: new Tombstone({ id: new URL(noteId(BOB, 1)) }),
      }),
    );

    assert.deepEqual(stored(box), []);
    assert.equal(times(await page(box), 'Second thoughts.'), 0);
  });

  it('is withdrawn from the page when its author deletes it after approval', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'Second thoughts.');
    await confirm(box, linkFor(onlyMessage(box.provider), 'approve'));

    await deliver(
      box,
      BOB,
      new Delete({
        id: new URL(`${noteId(BOB, 1)}#delete`),
        actor: new URL(BOB.id),
        object: new Tombstone({ id: new URL(noteId(BOB, 1)) }),
      }),
    );

    assert.deepEqual(stored(box), []);
    assert.equal(times(await page(box), 'Second thoughts.'), 0);
  });

  it('is not touched by somebody else’s Delete', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'Mine.');

    await deliver(
      box,
      ADA,
      new Delete({
        id: new URL(`${ADA.id}#delete-1`),
        actor: new URL(ADA.id),
        object: new URL(noteId(BOB, 1)),
      }),
    );

    assert.equal(stored(box).length, 1);
  });

  it('says the new words in the queue and on the page when its author edits it', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'First draft.');

    await deliver(
      box,
      BOB,
      new Update({
        id: new URL(`${noteId(BOB, 1)}#update-1`),
        actor: new URL(BOB.id),
        object: note(BOB, 1, 'Second draft.'),
      }),
    );

    const [held] = stored(box);
    assert.equal(held?.status, 'pending');
    assert.match(held?.content.html ?? '', /Second draft\./);
    await confirm(box, linkFor(onlyMessage(box.provider), 'approve'));
    const html = await page(box);
    assert.equal(times(html, 'Second draft.'), 1);
    assert.equal(times(html, 'First draft.'), 0);
  });
});

describe('the other two rules', () => {
  it('show: shows a stranger’s reply at once', async () => {
    const box = await site('show');

    await reply(box, BOB, 1, 'A stranger, shown.');

    assert.deepEqual(stored(box), []);
    assert.equal(times(await page(box), 'A stranger, shown.'), 1);
  });

  it('hold: holds even a follower’s reply', async () => {
    const box = await site('hold');
    await follow(box, ADA);

    await reply(box, ADA, 1, 'A follower, held.');

    assert.equal(stored(box)[0]?.status, 'pending');
    assert.equal(times(await page(box), 'A follower, held.'), 0);
  });
});

/** A reply logged as one that arrived before the rule did: straight into the inbox log. */
async function loggedEarlier(box: Site, n: number, content: string): Promise<void> {
  await appendInboxActivity(
    { admin: box.cms.admin, contentDir: box.contentDir, dataDir: box.dataDir },
    JSON.stringify(
      await new Create({
        id: new URL(`${noteId(BOB, n)}/activity`),
        actor: new URL(BOB.id),
        object: note(BOB, n, content),
      }).toJsonLd(),
    ),
  );
}

describe('replies that arrived before the rule', () => {
  it('make their author known: a stranger already on the page is not held next time', async () => {
    const box = await site();
    await loggedEarlier(box, 9, 'From before the rule.');

    await reply(box, BOB, 1, 'After the rule.');

    assert.deepEqual(stored(box), []);
    assert.doesNotMatch(onlyMessage(box.provider).text, /\/_geekity\//, 'nothing to moderate');
    assert.equal(times(await page(box), 'After the rule.'), 1);
  });

  it('do not, once their author withdrew them', async () => {
    const box = await site();
    await loggedEarlier(box, 9, 'From before the rule.');
    await deliver(
      box,
      BOB,
      new Delete({
        id: new URL(`${noteId(BOB, 9)}#delete`),
        actor: new URL(BOB.id),
        object: new Tombstone({ id: new URL(noteId(BOB, 9)) }),
      }),
    );

    await reply(box, BOB, 1, 'After the rule.');

    assert.equal(stored(box)[0]?.status, 'pending');
  });

  it('do not when the earlier reply was held rather than shown', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'Held first.');

    await reply(box, BOB, 2, 'Held again.');

    assert.equal(stored(box).filter((one) => one.status === 'pending').length, 2);
  });

  it('stay shown, and a held one stays held once the index is rebuilt', async () => {
    const box = await site();
    await loggedEarlier(box, 9, 'From before the rule.');
    await reply(box, ADA, 1, 'After the rule.');
    await box.cms.close();

    const again = await boot(box);

    const html = await page(again);
    assert.equal(times(html, 'From before the rule.'), 1);
    assert.equal(times(html, 'After the rule.'), 0);
    assert.equal(stored(again)[0]?.status, 'pending');
  });
});

describe('the published notice for a reply shown at once', () => {
  it('names the author, the post, the words and the reply on the page', async () => {
    const box = await site('show');

    await reply(box, BOB, 1, 'A stranger, shown.');

    const message = onlyMessage(box.provider);
    assert.deepEqual(
      message.to.map((to) => to.address),
      ['blog@example.com'],
    );
    assert.match(message.subject, /Hello world/);
    assert.match(message.text, /bob/i);
    assert.match(message.text, /A stranger, shown\./);
    assert.ok(
      message.text.includes(`${POST_ID}#comment-${repliesKey(noteId(BOB, 1))}`),
      message.text,
    );
  });

  it('is sent once when the same reply is delivered twice', async () => {
    const box = await site('show');

    await reply(box, BOB, 1, 'Said once, delivered twice.');
    await reply(box, BOB, 1, 'Said once, delivered twice.');

    onlyMessage(box.provider);
  });

  it('is not sent for a held reply a moderator approves', async () => {
    const box = await site();
    await reply(box, BOB, 1, 'A stranger says hello.');
    const moderation = onlyMessage(box.provider);
    box.provider.clear();

    await confirm(box, linkFor(moderation, 'approve'));

    assert.equal(stored(box)[0]?.status, 'approved');
    assert.equal(box.provider.sent.length, 0, 'approving was the moderator’s own act');
  });

  it('waits for the digest when the user chose one, and the digest lists it', async () => {
    const box = await site('show');
    const [user] = listUsers(box.dataDir);
    assert.ok(user !== undefined);
    await setUserNotificationMode({
      dataDir: box.dataDir,
      userId: user.id,
      event: 'published',
      mode: 'hourly',
    });

    await reply(box, BOB, 1, 'For the digest.');

    assert.equal(box.provider.sent.length, 0, 'nothing went as it arrived');
    assert.equal(await box.cms.digests.run(), 1);
    await box.cms.mail.settled();
    const digest = onlyMessage(box.provider);
    assert.match(digest.text, /New published comments and replies: 1/);
    assert.match(digest.text, /replied to “Hello world”/);
    assert.match(digest.text, /For the digest\./);
  });
});
