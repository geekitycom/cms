import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportJwk, generateCryptoKeyPair, importJwk, signRequest } from '@fedify/fedify';
import { Accept, Application, CryptographicKey, Follow, Reject } from '@fedify/vocab';

import { csrfField, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { SITE_ACTOR_IDENTIFIER } from './keys.ts';

/** The site under test. Fedify answers by origin, so every request uses this one. */
const BASE_URL = 'https://blog.example';
const SITE_ACTOR = `${BASE_URL}/ap/${SITE_ACTOR_IDENTIFIER}`;
const SITE_INBOX = `${BASE_URL}/ap/${SITE_ACTOR_IDENTIFIER}/inbox`;

/** The relay, which exists only in the fetch stub. */
const RELAY_ORIGIN = 'https://relay.example';
const RELAY_ACTOR = `${RELAY_ORIGIN}/actor`;
const RELAY_INBOX = `${RELAY_ORIGIN}/user/_____relay_____/inbox`;
const RELAY_KEY = `${RELAY_ACTOR}#main-key`;

/** A second relay, so a test can tell one subscription from another. */
const OTHER_RELAY_INBOX = `${RELAY_ORIGIN}/user/_____other_____/inbox`;

/** The ActivityStreams Public collection, which is what a relay follow names. */
const PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

/** One POST the site made. */
interface Sent {
  /** Where it went. */
  url: string;
  /** Its body, as the peer would read it. */
  body: Record<string, unknown>;
}

const started: Cms[] = [];
const temporaryDirs: string[] = [];
const sent: Sent[] = [];

let relayKeys: CryptoKeyPair;
let relayActorDocument: unknown;
let restoreFetch: () => void;

before(async () => {
  relayKeys = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
  relayActorDocument = await relayActor(relayKeys.publicKey);
  restoreFetch = routeRelayHost();
});

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * The relay's actor document, an `Application` as most relay servers are, with
 * the key its `Accept` is signed by.
 */
async function relayActor(publicKey: CryptoKey): Promise<unknown> {
  const actor = new Application({
    id: new URL(RELAY_ACTOR),
    preferredUsername: '_____relay_____',
    name: 'Example Relay',
    inbox: new URL(RELAY_INBOX),
    publicKey: new CryptographicKey({
      id: new URL(RELAY_KEY),
      owner: new URL(RELAY_ACTOR),
      publicKey: await importJwk(await exportJwk(publicKey), 'public'),
    }),
  });
  return await actor.toJsonLd();
}

/** Route the make-believe relay through memory: a POST is recorded, a GET is answered. */
function routeRelayHost(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== RELAY_ORIGIN) return await original(input, init);

    if (request.method === 'POST') {
      sent.push({ url: request.url, body: (await request.json()) as Record<string, unknown> });
      return new Response('', { status: 202 });
    }
    if (url.pathname === new URL(RELAY_ACTOR).pathname) {
      return new Response(JSON.stringify(relayActorDocument), {
        headers: { 'content-type': 'application/activity+json' },
      });
    }
    return new Response('Not found.', { status: 404 });
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

/** What {@link site} hands a test. */
interface Site {
  cms: Cms;
  contentDir: string;
  dataDir: string;
}

/**
 * A federated CMS with no queue — so a delivery is a POST that has already
 * happened by the time `settled()` resolves — and the private-address guard
 * off, because the relay host does not resolve.
 */
async function site(options: { relays?: readonly string[]; dataDir?: string } = {}): Promise<Site> {
  const dataDir = options.dataDir ?? (await temporaryDir('geekity-relays-data-'));
  const contentDir = await temporaryDir('geekity-relays-content-');

  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'Geekity',
      baseUrl: BASE_URL,
      actorHandle: 'blog',
      relays: options.relays ?? [],
    },
  });

  sent.length = 0;
  const cms = createCms({
    dataDir,
    contentDir,
    port: 0,
    watch: false,
    baseUrl: BASE_URL,
    federation: { queue: null, allowPrivateAddress: true },
  });
  started.push(cms);
  await cms.sync();
  return { cms, contentDir, dataDir };
}

/** The fields the settings form submits, with the values a relay test does not care about. */
const SETTINGS_FORM: Record<string, string> = {
  title: 'Geekity',
  tagline: '',
  base_url: BASE_URL,
  timezone: 'UTC',
  language: 'en',
  posts_per_page: '10',
  author: '',
  actor_handle: 'blog',
  actor_type: 'Person',
  tag_base: 'tag',
  category_base: 'category',
  comments: '1',
  comments_close_after_days: '14',
  notify_server: '',
  relays: '',
};

/** Save the settings form the way a browser would. */
async function saveSettings(agent: Browser, fields: Record<string, string>): Promise<Response> {
  const html = await (await agent.get('/admin/settings')).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the settings form carried a CSRF token');

  return agent.post('/admin/settings', { csrf_token: token, ...SETTINGS_FORM, ...fields });
}

/** Everything sent whose activity is of this type. */
function ofType(type: string): Sent[] {
  return sent.filter((one) => one.body['type'] === type);
}

/** Deliver one activity to the site's inbox, signed as the relay would sign it. */
async function deliver(cms: Cms, activity: { toJsonLd(): Promise<unknown> }): Promise<Response> {
  const request = new Request(SITE_INBOX, {
    method: 'POST',
    headers: { 'content-type': 'application/activity+json' },
    body: JSON.stringify(await activity.toJsonLd()),
  });
  return await cms.app.request(
    await signRequest(request, relayKeys.privateKey, new URL(RELAY_KEY)),
  );
}

/** The relay's `Accept` of the follow the site sent, as FEP-ae0c spells it. */
function accept(followId: string): Accept {
  return new Accept({
    id: new URL(`${RELAY_ORIGIN}/accepts/1`),
    actor: new URL(RELAY_ACTOR),
    object: new Follow({
      id: new URL(followId),
      actor: new URL(SITE_ACTOR),
      object: new URL(PUBLIC),
    }),
  });
}

/** The relay's `Reject`, which names the follow by id and says why. */
function reject(followId: string, reason: string): Reject {
  return new Reject({
    id: new URL(`${RELAY_ORIGIN}/rejects/1`),
    actor: new URL(RELAY_ACTOR),
    object: new URL(followId),
    summary: reason,
  });
}

describe('adding a relay on the settings screen', () => {
  it('sends a signed Follow of the Public collection to its inbox (AC #1)', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    const response = await saveSettings(agent, { relays: RELAY_INBOX });
    assert.equal(response.status, 303, await response.text());
    await cms.relays.settled();

    const follows = ofType('Follow');
    assert.equal(follows.length, 1, `expected one Follow, saw ${JSON.stringify(sent)}`);
    const follow = follows[0] as Sent;
    assert.equal(follow.url, RELAY_INBOX, 'it went to the relay’s inbox');
    assert.equal(follow.body['actor'], SITE_ACTOR);
    assert.equal(follow.body['object'], PUBLIC, 'the object is the Public collection');
    assert.ok(
      typeof follow.body['signature'] === 'object',
      'it carries the Linked Data signature a Mastodon-style relay verifies',
    );
  });

  it('records the subscription as pending, with the follow it sent', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    await saveSettings(agent, { relays: RELAY_INBOX });
    await cms.relays.settled();

    const stored = cms.admin.getRelay(RELAY_INBOX);
    assert.equal(stored?.state, 'pending');
    assert.equal(stored?.actorId, null, 'the relay has not said who it is yet');
    assert.equal(stored?.followId, ofType('Follow')[0]?.body['id']);
  });
});

describe('the relay’s answer', () => {
  it('marks the subscription accepted (AC #2)', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await saveSettings(agent, { relays: RELAY_INBOX });
    await cms.relays.settled();
    const followId = String(ofType('Follow')[0]?.body['id']);

    const response = await deliver(cms, accept(followId));

    assert.equal(response.status, 202, await response.text());
    const stored = cms.admin.getRelay(RELAY_INBOX);
    assert.equal(stored?.state, 'accepted');
    assert.equal(stored?.actorId, RELAY_ACTOR, 'and it now knows who the relay is');
  });

  it('marks it rejected, keeping the reason (AC #2)', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await saveSettings(agent, { relays: RELAY_INBOX });
    await cms.relays.settled();
    const followId = String(ofType('Follow')[0]?.body['id']);

    await deliver(cms, reject(followId, 'This relay is invitation only.'));

    const stored = cms.admin.getRelay(RELAY_INBOX);
    assert.equal(stored?.state, 'rejected');
    assert.equal(stored?.reason, 'This relay is invitation only.');
  });

  it('takes one whose follow id it no longer holds, because only one subscription on that host is waiting', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await saveSettings(agent, { relays: RELAY_INBOX });
    await cms.relays.settled();

    await deliver(cms, accept(`${BASE_URL}/ap/actor#relay-follow/an-older-one`));

    assert.equal(cms.admin.getRelay(RELAY_INBOX)?.state, 'accepted');
  });

  it('will not guess when two subscriptions on the same host are both waiting', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await saveSettings(agent, { relays: `${RELAY_INBOX}\n${OTHER_RELAY_INBOX}` });
    await cms.relays.settled();

    await deliver(cms, accept(`${BASE_URL}/ap/actor#relay-follow/an-older-one`));

    assert.equal(cms.admin.getRelay(RELAY_INBOX)?.state, 'pending');
    assert.equal(cms.admin.getRelay(OTHER_RELAY_INBOX)?.state, 'pending');
  });
});

describe('removing a relay', () => {
  it('sends Undo of the follow and drops the record (AC #4)', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await saveSettings(agent, { relays: RELAY_INBOX });
    await cms.relays.settled();
    const followId = String(ofType('Follow')[0]?.body['id']);

    await saveSettings(agent, { relays: '' });
    await cms.relays.settled();

    const undos = ofType('Undo');
    assert.equal(undos.length, 1, `expected one Undo, saw ${JSON.stringify(sent)}`);
    assert.equal(undos[0]?.url, RELAY_INBOX);
    assert.equal(undos[0]?.body['object'], followId, 'it names the follow it undoes');
    assert.equal(cms.admin.getRelay(RELAY_INBOX), undefined);
  });

  it('leaves the relays that stayed on the list alone', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await saveSettings(agent, { relays: `${RELAY_INBOX}\n${OTHER_RELAY_INBOX}` });
    await cms.relays.settled();
    assert.equal(ofType('Follow').length, 2);

    await saveSettings(agent, { relays: OTHER_RELAY_INBOX });
    await cms.relays.settled();

    assert.equal(ofType('Undo').length, 1);
    assert.equal(ofType('Undo')[0]?.url, RELAY_INBOX);
    assert.equal(ofType('Follow').length, 2, 'the one that stayed was not followed again');
    assert.ok(cms.admin.getRelay(OTHER_RELAY_INBOX) !== undefined);
  });
});

describe('booting', () => {
  it('follows a relay the file lists that has no record yet', async () => {
    const { cms } = await site({ relays: [RELAY_INBOX] });
    await cms.relays.settled();

    assert.equal(ofType('Follow').length, 1);
    assert.equal(ofType('Follow')[0]?.url, RELAY_INBOX);
    assert.equal(cms.admin.getRelay(RELAY_INBOX)?.state, 'pending');
  });

  it('does not follow again one it already has a record of', async () => {
    const dataDir = await temporaryDir('geekity-relays-boot-');
    const first = await site({ relays: [RELAY_INBOX], dataDir });
    await first.cms.relays.settled();
    await first.cms.close();

    const again = await site({ relays: [RELAY_INBOX], dataDir });
    await again.cms.relays.settled();

    assert.equal(ofType('Follow').length, 0, 'a subscription is not renewed on every boot');
    assert.ok(again.cms.admin.getRelay(RELAY_INBOX) !== undefined);
  });
});

describe('delivering to a relay', () => {
  /** Post the "add post" form the way a browser would. */
  async function publishNewPost(agent: Browser, fields: Record<string, string> = {}) {
    const html = await (await agent.get('/admin/posts/new')).text();
    const token = csrfField(html);
    assert.ok(token !== undefined, 'the editor carried a CSRF token');

    return agent.post('/admin/posts/new', {
      csrf_token: token,
      title: 'Hello, world',
      slug: 'hello-world',
      permalink: '',
      date: '2026-03-04T10:00:00.000Z',
      tags: 'essays',
      description: '',
      body: 'The first post.',
      hash: '',
      action: 'publish',
      ...fields,
    });
  }

  /** A site with the relay already accepted, so the handshake is behind us. */
  async function subscribed(): Promise<{ cms: Cms; agent: Browser }> {
    const { cms } = await site({ relays: [RELAY_INBOX] });
    await cms.relays.settled();
    const followId = String(ofType('Follow')[0]?.body['id']);
    await deliver(cms, accept(followId));
    const agent = await signedIn(cms);
    sent.length = 0;
    return { cms, agent };
  }

  it('sends the Create to the relay as well as to the followers (AC #3)', async () => {
    const { cms, agent } = await subscribed();
    cms.admin.putFollower({
      actorId: `${RELAY_ORIGIN}/users/ada`,
      inboxId: `${RELAY_ORIGIN}/users/ada/inbox`,
      sharedInboxId: null,
      handle: '@ada@relay.example',
      name: 'Ada',
      iconUrl: null,
      url: null,
    });

    assert.equal((await publishNewPost(agent)).status, 303);
    await cms.delivery.settled();

    const creates = ofType('Create');
    assert.deepEqual(
      creates.map((one) => one.url).sort(),
      [`${RELAY_ORIGIN}/users/ada/inbox`, RELAY_INBOX].sort(),
      'the follower and the relay both got it',
    );
  });

  it('records the outcome against the relay, like a follower (AC #3)', async () => {
    const { cms, agent } = await subscribed();

    assert.equal((await publishNewPost(agent)).status, 303);
    await cms.delivery.settled();

    const activityId = String(ofType('Create')[0]?.body['id']);
    const rows = cms.admin.listDeliveries(activityId);
    assert.deepEqual(
      rows.map((row) => [row.actorId, row.inboxId, row.status]),
      [[RELAY_ACTOR, RELAY_INBOX, 'sent']],
    );
    assert.equal(cms.admin.lastDeliveryToInbox(RELAY_INBOX)?.status, 'sent');
  });

  it('sends nothing to a pending or a rejected relay (AC #3)', async () => {
    const { cms } = await site({ relays: [RELAY_INBOX, OTHER_RELAY_INBOX] });
    await cms.relays.settled();
    await deliver(cms, reject(String(ofType('Follow')[0]?.body['id']), 'No thanks.'));
    const agent = await signedIn(cms);
    sent.length = 0;

    assert.equal((await publishNewPost(agent)).status, 303);
    await cms.delivery.settled();

    assert.deepEqual(
      ofType('Create'),
      [],
      'neither a rejected nor a pending relay is delivered to',
    );
  });

  it('sends the Update and the Delete too (AC #3)', async () => {
    const { cms, agent } = await subscribed();
    await publishNewPost(agent);
    await cms.delivery.settled();

    const editor = '/admin/posts/hello-world';
    const html = await (await agent.get(editor)).text();
    const token = csrfField(html);
    assert.ok(token !== undefined);
    const hash = /name="hash"[^>]*value="([^"]*)"/.exec(html)?.[1] ?? '';

    await agent.post(editor, {
      csrf_token: token,
      hash,
      title: 'Hello again',
      slug: 'hello-world',
      permalink: '',
      date: '2026-03-04T10:00:00.000Z',
      tags: 'essays',
      description: '',
      body: 'The first post, edited.',
      action: 'update',
    });
    await cms.delivery.settled();

    assert.equal(
      ofType('Update').length,
      1,
      `saw ${JSON.stringify(sent.map((one) => one.body['type']))}`,
    );
    assert.equal(ofType('Update')[0]?.url, RELAY_INBOX);
  });

  it('reaches the relay when a post is sent again (AC #6)', async () => {
    const { cms, agent } = await subscribed();
    await publishNewPost(agent);
    await cms.delivery.settled();
    sent.length = 0;

    // A resend of a post the relay already has is an `Update`: the activity is
    // rebuilt from the file rather than replayed (decision-9).
    const report = await cms.delivery.resend('hello-world');
    await cms.delivery.settled();

    assert.equal(ofType('Update').length, 1);
    assert.equal(ofType('Update')[0]?.url, RELAY_INBOX);
    assert.equal(report?.deliveries.length, 1, 'and the resend reports the relay as a recipient');
  });
});
