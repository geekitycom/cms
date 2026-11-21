import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportJwk, importJwk, signRequest } from '@fedify/fedify';
import { Announce, CryptographicKey, Endpoints, Follow, Like, Person, Undo } from '@fedify/vocab';

import { writeUsers } from '../admin/__testing__/users.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { createMemoryMailProvider } from '../mail/memory.ts';
import type { MemoryMailProvider } from '../mail/memory.ts';
import type { OutgoingMail } from '../mail/provider.ts';
import { DEFAULT_SITE_SETTINGS } from '../site/settings.ts';
import { listUsers, setUserNotification, setUserNotificationMode } from '../site/users.ts';
import { writeSiteSettings } from '../__testing__/site-settings.ts';
import { seedActorKeys, testKeyPair } from './__testing__/keys.ts';

/**
 * The notices a like, a boost, a quote and a new follower send, driven
 * through the inbox with signed deliveries: the message each sends as it
 * arrives, the digest it waits for otherwise, and the Undo that takes it out
 * of a digest that has not gone yet.
 */

const BASE_URL = 'https://blog.example';
const NOW = new Date('2026-09-20T12:00:00.000Z');
const LOCAL_USER = 'blog';
const SITE_ACTOR = `${BASE_URL}/author/${LOCAL_USER}/`;
const SITE_INBOX = `${SITE_ACTOR}inbox/`;
const PERMALINK = '/2026/09/hello-world/';
const POST_ID = `${BASE_URL}${PERMALINK}`;

const REMOTE_ORIGIN = 'https://remote.example';

interface Peer {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  keys: CryptoKeyPair;
  document: unknown;
}

const ADA: Peer = peer('ada', 'Ada Lovelace');
const RELAY: Peer = peer('relay', 'A Relay');

function peer(username: string, name: string): Peer {
  return {
    id: `${REMOTE_ORIGIN}/users/${username}`,
    username,
    name,
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
  RELAY.keys = await testKeyPair(2);
  for (const one of [ADA, RELAY]) one.document = await actorDocument(one);
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
    name: one.name,
    url: new URL(`${REMOTE_ORIGIN}/@${one.username}`),
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
    const found = [ADA, RELAY].find((one) => new URL(one.id).pathname === url.pathname);
    if (found === undefined) return new Response('Not found.', { status: 404 });
    return new Response(JSON.stringify(found.document), {
      headers: { 'content-type': 'application/activity+json' },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

interface Site {
  cms: Cms;
  provider: MemoryMailProvider;
  dataDir: string;
  userId: number;
}

async function site(): Promise<Site> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-notices-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-notices-data-'));
  temporaryDirs.push(contentDir, dataDir);
  seedActorKeys(dataDir, LOCAL_USER);
  const file = path.join(contentDir, 'posts/2026-09-19-hello-world.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, POST, 'utf8');
  await writeSiteSettings({
    contentDir,
    settings: { ...DEFAULT_SITE_SETTINGS, title: 'A Site', base_url: BASE_URL, author: LOCAL_USER },
  });
  writeUsers(dataDir, [{ username: LOCAL_USER, email: 'blog@example.com' }]);

  const provider = createMemoryMailProvider();
  const cms = createCms({
    contentDir,
    dataDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
    federation: { queue: null, allowPrivateAddress: true },
    mail: { provider, backoffMs: () => 0, logger: { info: () => {}, warn: () => {} } },
  });
  started.push(cms);
  await cms.sync();
  const [user] = listUsers(dataDir);
  assert.ok(user !== undefined);
  return { cms, provider, dataDir, userId: user.id };
}

/** Choose how the one user takes an event, turning it on. */
async function choose(box: Site, event: string, mode: string): Promise<void> {
  await setUserNotification({ dataDir: box.dataDir, userId: box.userId, event, on: true });
  await setUserNotificationMode({ dataDir: box.dataDir, userId: box.userId, event, mode });
}

async function deliver(
  box: Site,
  from: Peer,
  activity: { toJsonLd(): Promise<unknown> } | Record<string, unknown>,
): Promise<void> {
  const body = typeof activity.toJsonLd === 'function' ? await activity.toJsonLd() : activity;
  const request = new Request(SITE_INBOX, {
    method: 'POST',
    headers: { 'content-type': 'application/activity+json' },
    body: JSON.stringify(body),
  });
  const signed = await signRequest(request, from.keys.privateKey, new URL(`${from.id}#main-key`));
  const response = await box.cms.app.request(signed);
  assert.ok(response.status < 300, `the inbox took it: ${response.status}`);
  await box.cms.actorProfiles.settled();
  await box.cms.mail.settled();
}

function like(n = 1, object = POST_ID): Like {
  return new Like({
    id: new URL(`${ADA.id}#likes/${n}`),
    actor: new URL(ADA.id),
    object: new URL(object),
  });
}

function boost(n = 1): Announce {
  return new Announce({
    id: new URL(`${ADA.id}/statuses/${n}/activity`),
    actor: new URL(ADA.id),
    object: new URL(POST_ID),
  });
}

function follow(from: Peer = ADA): Follow {
  return new Follow({
    id: new URL(`${from.id}/follows/1`),
    actor: new URL(from.id),
    object: new URL(SITE_ACTOR),
  });
}

function undo(from: Peer, object: Like | Announce | Follow): Undo {
  return new Undo({
    id: new URL(`${object.id?.href ?? from.id}/undo`),
    actor: new URL(from.id),
    object,
  });
}

const QUOTE = `${ADA.id}/statuses/99`;
const REQUEST = `${ADA.id}/quote_requests/1`;

/** A QuoteRequest shaped the way Mastodon writes one, the quote carried inside it. */
function quoteRequest(id = REQUEST): Record<string, unknown> {
  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      { QuoteRequest: 'https://w3id.org/fep/044f#QuoteRequest' },
    ],
    id,
    type: 'QuoteRequest',
    actor: ADA.id,
    object: POST_ID,
    instrument: {
      id: QUOTE,
      type: 'Note',
      attributedTo: ADA.id,
      content: '<p>This is <b>worth</b> reading.</p>',
      url: `${REMOTE_ORIGIN}/@ada/99`,
    },
  };
}

function undoQuote(): Record<string, unknown> {
  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      { QuoteRequest: 'https://w3id.org/fep/044f#QuoteRequest' },
    ],
    id: `${REQUEST}/undo`,
    type: 'Undo',
    actor: ADA.id,
    object: quoteRequest(),
  };
}

function onlyMessage(provider: MemoryMailProvider): OutgoingMail {
  assert.equal(provider.sent.length, 1, `exactly one message went, not ${provider.sent.length}`);
  const [message] = provider.sent;
  assert.ok(message !== undefined);
  return message;
}

/** Send whatever digests are due and hand back the one message that went, if any. */
async function digest(box: Site): Promise<OutgoingMail | undefined> {
  box.provider.clear();
  await box.cms.digests.run();
  await box.cms.mail.settled();
  return box.provider.sent[0];
}

describe('likes and boosts', () => {
  it('send nothing while the event is off, which it is by default', async () => {
    const box = await site();

    await deliver(box, ADA, like());
    await deliver(box, ADA, boost());

    assert.equal(box.provider.sent.length, 0);
    assert.equal(await digest(box), undefined, 'and nothing waits for a digest');
  });

  it('go in the daily digest when turned on, naming who, which post, with links', async () => {
    const box = await site();
    await setUserNotification({
      dataDir: box.dataDir,
      userId: box.userId,
      event: 'reactions',
      on: true,
    });

    await deliver(box, ADA, like());
    await deliver(box, ADA, boost());

    assert.equal(box.provider.sent.length, 0, 'nothing went as it arrived');
    const message = await digest(box);
    assert.ok(message !== undefined, 'a digest went');
    assert.match(message.text, /Likes and boosts: 2/);
    assert.match(message.text, /Ada Lovelace liked “Hello world”/);
    assert.match(message.text, /Ada Lovelace boosted “Hello world”/);
    assert.ok(message.text.includes(`Who: ${REMOTE_ORIGIN}/@ada`), message.text);
    assert.ok(message.text.includes(`Post: ${POST_ID}`), message.text);
  });

  it('send one message each as they arrive, once however often one is redelivered', async () => {
    const box = await site();
    await choose(box, 'reactions', 'immediately');

    await deliver(box, ADA, like());
    await deliver(box, ADA, like());

    const message = onlyMessage(box.provider);
    assert.deepEqual(
      message.to.map((to) => to.address),
      ['blog@example.com'],
    );
    assert.match(message.subject, /Ada Lovelace liked “Hello world”/);
    assert.ok(message.text.includes(POST_ID), message.text);
    assert.ok(message.text.includes(`${REMOTE_ORIGIN}/@ada`), message.text);
    assert.ok(message.html?.includes(`href="${POST_ID}"`), message.html ?? 'no html');
  });

  it('send nothing for a like of something that is not one of the site’s posts', async () => {
    const box = await site();
    await choose(box, 'reactions', 'immediately');

    await deliver(box, ADA, like(1, `${REMOTE_ORIGIN}/users/someone/statuses/5`));

    assert.equal(box.provider.sent.length, 0);
  });

  it('leave the digest when undone before it goes', async () => {
    const box = await site();
    await choose(box, 'reactions', 'daily');

    const liked = like(1);
    const boosted = boost(1);
    await deliver(box, ADA, liked);
    await deliver(box, ADA, boosted);
    await deliver(box, ADA, undo(ADA, liked));

    const message = await digest(box);
    assert.ok(message !== undefined);
    assert.match(message.text, /Likes and boosts: 1/);
    assert.doesNotMatch(message.text, /liked/);

    await deliver(box, ADA, undo(ADA, boosted));
    await deliver(box, ADA, like(2));
    await deliver(box, ADA, undo(ADA, like(2)));
    assert.equal(await digest(box), undefined, 'everything left was undone');
  });
});

describe('quotes', () => {
  it('go in the daily digest by default, with who, the post, the quote and its words', async () => {
    const box = await site();

    await deliver(box, ADA, quoteRequest());

    assert.equal(box.provider.sent.length, 0, 'nothing went as it arrived');
    const message = await digest(box);
    assert.ok(message !== undefined);
    assert.match(message.text, /Quotes: 1/);
    assert.match(message.text, /Ada Lovelace quoted “Hello world”/);
    assert.ok(message.text.includes(`Post: ${POST_ID}`), message.text);
    assert.ok(message.text.includes(`Link: ${REMOTE_ORIGIN}/@ada/99`), message.text);
    assert.match(message.text, /This is worth reading\./);
  });

  it('send one message as they arrive, and not again for a second request for the same quote', async () => {
    const box = await site();
    await choose(box, 'quotes', 'immediately');

    await deliver(box, ADA, quoteRequest());
    await deliver(box, ADA, quoteRequest(`${REQUEST}-again`));

    const message = onlyMessage(box.provider);
    assert.match(message.subject, /Ada Lovelace quoted “Hello world”/);
    assert.match(message.text, /This is worth reading\./);
    assert.ok(message.text.includes(`${REMOTE_ORIGIN}/@ada/99`), message.text);
  });

  it('leave the digest when the request is undone', async () => {
    const box = await site();

    await deliver(box, ADA, quoteRequest());
    await deliver(box, ADA, undoQuote());

    assert.equal(await digest(box), undefined);
  });

  it('leave the digest when the quote is deleted', async () => {
    const box = await site();

    await deliver(box, ADA, quoteRequest());
    await deliver(box, ADA, {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${QUOTE}#delete`,
      type: 'Delete',
      actor: ADA.id,
      object: QUOTE,
    });

    assert.equal(await digest(box), undefined);
  });
});

describe('new followers', () => {
  it('go in the daily digest by default, naming the follower and the account followed', async () => {
    const box = await site();

    await deliver(box, ADA, follow());

    assert.equal(box.provider.sent.length, 0, 'nothing went as it arrived');
    const message = await digest(box);
    assert.ok(message !== undefined);
    assert.match(message.text, /New followers: 1/);
    assert.match(message.text, /Ada Lovelace followed “@blog@blog\.example”/);
    assert.ok(message.text.includes(`Who: ${REMOTE_ORIGIN}/@ada`), message.text);
    assert.ok(message.text.includes(SITE_ACTOR), message.text);
  });

  it('send one message as they arrive, and none for a follow that is already a follower', async () => {
    const box = await site();
    await choose(box, 'followers', 'immediately');

    await deliver(box, ADA, follow());
    await deliver(box, ADA, follow());

    const message = onlyMessage(box.provider);
    assert.match(message.subject, /Ada Lovelace followed “@blog@blog\.example”/);
  });

  it('leave the digest when the follow is undone', async () => {
    const box = await site();

    const followed = follow();
    await deliver(box, ADA, followed);
    await deliver(box, ADA, undo(ADA, followed));

    assert.equal(await digest(box), undefined);
  });

  it('do not count a relay the site subscribes to', async () => {
    const box = await site();
    await choose(box, 'followers', 'immediately');
    box.cms.admin.putRelay({
      inboxId: `${RELAY.id}/inbox`,
      actorId: RELAY.id,
      state: 'accepted',
      reason: null,
      followId: null,
    });

    await deliver(box, RELAY, follow(RELAY));

    assert.equal(box.provider.sent.length, 0);
    assert.equal(await digest(box), undefined);
  });
});
