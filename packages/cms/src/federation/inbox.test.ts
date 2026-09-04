import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportJwk, generateCryptoKeyPair, importJwk, signRequest } from '@fedify/fedify';
import {
  Announce,
  Create,
  CryptographicKey,
  Delete,
  Endpoints,
  Follow,
  Image,
  Like,
  Note,
  Person,
  Undo,
} from '@fedify/vocab';

import { DEFAULT_SITE_SETTINGS, writeSiteSettings } from '../admin/settings.ts';
import { openAdminStore } from '../admin/store.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { SITE_ACTOR_IDENTIFIER } from './keys.ts';

/** The site under test. Fedify answers by origin, so every request uses this one. */
const BASE_URL = 'https://blog.example';
const SITE_ACTOR = `${BASE_URL}/ap/${SITE_ACTOR_IDENTIFIER}`;
const SITE_INBOX = `${BASE_URL}/ap/${SITE_ACTOR_IDENTIFIER}/inbox`;

/** The peer that follows, likes and boosts. It exists only in the fetch stub. */
const REMOTE_ORIGIN = 'https://remote.example';
const REMOTE_ACTOR = `${REMOTE_ORIGIN}/users/ada`;
const REMOTE_INBOX = `${REMOTE_ORIGIN}/users/ada/inbox`;
const REMOTE_SHARED_INBOX = `${REMOTE_ORIGIN}/inbox`;
const REMOTE_KEY = `${REMOTE_ACTOR}#main-key`;

/** A second peer, so a test can tell one actor's follow from another's. */
const OTHER_ACTOR = `${REMOTE_ORIGIN}/users/bob`;

/** One POST the site made while handling an inbox delivery. */
interface Delivery {
  /** Where it went. */
  url: string;
  /** Its body, as the JSON-LD the peer would read. */
  body: Record<string, unknown>;
}

const started: Cms[] = [];
const temporaryDirs: string[] = [];
const deliveries: Delivery[] = [];

let remoteKeys: CryptoKeyPair;
/** A key pair that signs nothing the remote actor claims to own. */
let strangerKeys: CryptoKeyPair;
let remoteActorDocument: unknown;
let restoreFetch: () => void;

before(async () => {
  remoteKeys = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
  strangerKeys = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
  remoteActorDocument = await remoteActor(remoteKeys.publicKey);
  restoreFetch = routeRemoteHost();
});

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The actor document the stubbed host serves, with the key its requests are signed by. */
async function remoteActor(publicKey: CryptoKey): Promise<unknown> {
  const person = new Person({
    id: new URL(REMOTE_ACTOR),
    preferredUsername: 'ada',
    name: 'Ada Lovelace',
    url: new URL(`${REMOTE_ORIGIN}/@ada`),
    icon: new Image({ url: new URL(`${REMOTE_ORIGIN}/avatars/ada.png`) }),
    inbox: new URL(REMOTE_INBOX),
    endpoints: new Endpoints({ sharedInbox: new URL(REMOTE_SHARED_INBOX) }),
    publicKey: new CryptographicKey({
      id: new URL(REMOTE_KEY),
      owner: new URL(REMOTE_ACTOR),
      // Round-tripped through JWK so the document holds a key that was
      // exported the way a real instance would export it.
      publicKey: await importJwk(await exportJwk(publicKey), 'public'),
    }),
  });
  return await person.toJsonLd();
}

/**
 * Route the make-believe host through memory instead of the network.
 *
 * Fedify dereferences an actor with the global `fetch` and delivers with it
 * too, so replacing it is what lets one process hold both ends of a
 * federation: a GET of the remote actor answers with its document, and a POST
 * to its inbox is recorded rather than sent.
 */
function routeRemoteHost(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== REMOTE_ORIGIN) return await original(input, init);

    if (request.method === 'POST') {
      deliveries.push({
        url: request.url,
        body: (await request.json()) as Record<string, unknown>,
      });
      return new Response('', { status: 202 });
    }
    if (url.pathname === new URL(REMOTE_ACTOR).pathname) {
      return new Response(JSON.stringify(remoteActorDocument), {
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

/**
 * A federated CMS with no queue, so an activity is handled and any reply
 * delivered before the inbox request is answered, and with the private-address
 * guard off, because neither host in this file resolves.
 */
async function site(): Promise<Cms> {
  const dataDir = await temporaryDir('geekity-inbox-data-');
  const contentDir = await temporaryDir('geekity-inbox-content-');

  const seed = openAdminStore({ dataDir });
  writeSiteSettings(seed, {
    ...DEFAULT_SITE_SETTINGS,
    title: 'Geekity',
    tagline: 'A file-first CMS',
    baseUrl: BASE_URL,
    timezone: 'UTC',
    postsPerPage: 10,
    author: 'Ada',
    actorHandle: 'blog',
    actorType: 'Person',
    avatar: '',
  });
  seed.close();

  deliveries.length = 0;
  const instance = createCms({
    dataDir,
    contentDir,
    watch: false,
    baseUrl: BASE_URL,
    federation: { queue: null, allowPrivateAddress: true },
  });
  started.push(instance);
  return instance;
}

/** How a POST to the inbox is signed. */
interface PostOptions {
  /** The private key that signs it. The remote actor's, by default. */
  key?: CryptoKey;
  /** The key id the signature names. The remote actor's, by default. */
  keyId?: string;
  /** Skip the signature altogether. */
  unsigned?: boolean;
}

/** Deliver one activity to the site's inbox, signed as a real peer would. */
async function deliver(
  instance: Cms,
  activity: { toJsonLd(): Promise<unknown> },
  options: PostOptions = {},
): Promise<Response> {
  const body = JSON.stringify(await activity.toJsonLd());
  const request = new Request(SITE_INBOX, {
    method: 'POST',
    headers: { 'content-type': 'application/activity+json' },
    body,
  });
  const sent =
    options.unsigned === true
      ? request
      : await signRequest(
          request,
          options.key ?? remoteKeys.privateKey,
          new URL(options.keyId ?? REMOTE_KEY),
        );
  return await instance.app.request(sent);
}

/** A `Follow` of the site actor from the remote peer. */
function follow(id = `${REMOTE_ORIGIN}/follows/1`, actor = REMOTE_ACTOR): Follow {
  return new Follow({
    id: new URL(id),
    actor: new URL(actor),
    object: new URL(SITE_ACTOR),
  });
}

describe('a Follow', () => {
  it('stores the follower with the inboxes and the profile it published', async () => {
    const instance = await site();

    const response = await deliver(instance, follow());

    assert.equal(response.status, 202, await response.text());
    const stored = instance.admin.getFollower(REMOTE_ACTOR);
    assert.equal(stored?.inboxId, REMOTE_INBOX);
    assert.equal(stored?.sharedInboxId, REMOTE_SHARED_INBOX);
    assert.equal(stored?.handle, '@ada@remote.example');
    assert.equal(stored?.name, 'Ada Lovelace');
    assert.equal(stored?.iconUrl, `${REMOTE_ORIGIN}/avatars/ada.png`);
    assert.equal(stored?.url, `${REMOTE_ORIGIN}/@ada`);
    assert.ok((stored?.followedAt ?? '') !== '', 'the follow was timed');
  });

  it('replies Accept to the follower’s inbox', async () => {
    const instance = await site();

    await deliver(instance, follow());

    const accept = deliveries.find((delivery) => delivery.url === REMOTE_INBOX);
    assert.ok(accept !== undefined, `nothing was delivered to ${REMOTE_INBOX}`);
    assert.equal(accept.body['type'], 'Accept');
    assert.equal(accept.body['actor'], SITE_ACTOR);
    const accepted = accept.body['object'] as Record<string, unknown> | string;
    const acceptedId = typeof accepted === 'string' ? accepted : accepted['id'];
    assert.equal(acceptedId, `${REMOTE_ORIGIN}/follows/1`);
  });

  it('ignores a Follow of something that is not the site actor', async () => {
    const instance = await site();

    await deliver(
      instance,
      new Follow({
        id: new URL(`${REMOTE_ORIGIN}/follows/elsewhere`),
        actor: new URL(REMOTE_ACTOR),
        object: new URL(`${BASE_URL}/ap/posts/hello`),
      }),
    );

    assert.equal(instance.admin.countFollowers(), 0);
    assert.deepEqual(deliveries, []);
  });

  it('is idempotent: following twice leaves one follower', async () => {
    const instance = await site();

    await deliver(instance, follow(`${REMOTE_ORIGIN}/follows/1`));
    await deliver(instance, follow(`${REMOTE_ORIGIN}/follows/2`));

    assert.equal(instance.admin.countFollowers(), 1);
  });
});

describe('an Undo of a Follow', () => {
  it('removes the follower', async () => {
    const instance = await site();
    await deliver(instance, follow());
    assert.equal(instance.admin.countFollowers(), 1);

    const response = await deliver(
      instance,
      new Undo({
        id: new URL(`${REMOTE_ORIGIN}/undos/1`),
        actor: new URL(REMOTE_ACTOR),
        object: follow(),
      }),
    );

    assert.equal(response.status, 202, await response.text());
    assert.equal(instance.admin.countFollowers(), 0);
    assert.equal(instance.admin.getFollower(REMOTE_ACTOR), undefined);
  });

  it('will not let one actor undo another actor’s follow', async () => {
    const instance = await site();
    await deliver(instance, follow());

    await deliver(
      instance,
      new Undo({
        id: new URL(`${REMOTE_ORIGIN}/undos/2`),
        actor: new URL(REMOTE_ACTOR),
        object: follow(`${REMOTE_ORIGIN}/follows/bob`, OTHER_ACTOR),
      }),
    );

    assert.equal(instance.admin.countFollowers(), 1, 'the follow that was not undone stands');
  });
});

describe('a Delete of an actor', () => {
  it('removes the follower the deleted actor was', async () => {
    const instance = await site();
    await deliver(instance, follow());

    const response = await deliver(
      instance,
      new Delete({
        id: new URL(`${REMOTE_ACTOR}#delete`),
        actor: new URL(REMOTE_ACTOR),
        object: new URL(REMOTE_ACTOR),
      }),
    );

    assert.equal(response.status, 202, await response.text());
    assert.equal(instance.admin.countFollowers(), 0);
  });

  it('leaves the follower alone when something other than the actor is deleted', async () => {
    const instance = await site();
    await deliver(instance, follow());

    await deliver(
      instance,
      new Delete({
        id: new URL(`${REMOTE_ORIGIN}/deletes/note`),
        actor: new URL(REMOTE_ACTOR),
        object: new URL(`${REMOTE_ORIGIN}/notes/1`),
      }),
    );

    assert.equal(instance.admin.countFollowers(), 1);
  });
});

describe('the inbound activity log', () => {
  it('records a Like with its actor, type, object and arrival time', async () => {
    const instance = await site();

    await deliver(
      instance,
      new Like({
        id: new URL(`${REMOTE_ORIGIN}/likes/1`),
        actor: new URL(REMOTE_ACTOR),
        object: new URL(`${BASE_URL}/ap/posts/hello`),
      }),
    );

    const logged = instance.admin
      .listInboxActivities()
      .find((entry) => entry.activityType === 'Like');
    assert.ok(logged !== undefined, 'the Like was logged');
    assert.equal(logged.actorId, REMOTE_ACTOR);
    assert.equal(logged.objectId, `${BASE_URL}/ap/posts/hello`);
    assert.equal(logged.activityId, `${REMOTE_ORIGIN}/likes/1`);
    assert.ok(logged.receivedAt !== '', 'the arrival was timed');
    assert.match(logged.json, /"Like"/);
  });

  it('records an Announce', async () => {
    const instance = await site();

    await deliver(
      instance,
      new Announce({
        id: new URL(`${REMOTE_ORIGIN}/announces/1`),
        actor: new URL(REMOTE_ACTOR),
        object: new URL(`${BASE_URL}/ap/posts/hello`),
      }),
    );

    const logged = instance.admin
      .listInboxActivities()
      .find((entry) => entry.activityType === 'Announce');
    assert.equal(logged?.actorId, REMOTE_ACTOR);
    assert.equal(logged?.objectId, `${BASE_URL}/ap/posts/hello`);
  });

  it('records a reply, which arrives as a Create of a Note', async () => {
    const instance = await site();

    await deliver(
      instance,
      new Create({
        id: new URL(`${REMOTE_ORIGIN}/creates/1`),
        actor: new URL(REMOTE_ACTOR),
        object: new Note({
          id: new URL(`${REMOTE_ORIGIN}/notes/1`),
          attribution: new URL(REMOTE_ACTOR),
          content: 'Good post.',
          replyTarget: new URL(`${BASE_URL}/ap/posts/hello`),
        }),
      }),
    );

    const logged = instance.admin
      .listInboxActivities()
      .find((entry) => entry.activityType === 'Create');
    assert.ok(logged !== undefined, 'the reply was logged');
    assert.equal(logged.actorId, REMOTE_ACTOR);
    assert.equal(logged.objectId, `${REMOTE_ORIGIN}/notes/1`);
    assert.match(logged.json, /Good post\./);
  });

  it('acts on none of them: a Like is not a follow and gets no reply', async () => {
    const instance = await site();

    await deliver(
      instance,
      new Like({
        id: new URL(`${REMOTE_ORIGIN}/likes/2`),
        actor: new URL(REMOTE_ACTOR),
        object: new URL(`${BASE_URL}/ap/posts/hello`),
      }),
    );

    assert.equal(instance.admin.countFollowers(), 0);
    assert.deepEqual(deliveries, []);
  });

  it('records the follow traffic too, so the log is the whole story', async () => {
    const instance = await site();

    await deliver(instance, follow());

    assert.deepEqual(
      instance.admin.listInboxActivities().map((entry) => entry.activityType),
      ['Follow'],
    );
  });
});

describe('an invalid HTTP signature', () => {
  it('is refused when the request is not signed at all', async () => {
    const instance = await site();

    const response = await deliver(instance, follow(), { unsigned: true });

    assert.ok(!response.ok, `an unsigned Follow was answered ${String(response.status)}`);
    assert.equal(instance.admin.countFollowers(), 0);
    assert.equal(instance.admin.countInboxActivities(), 0);
    assert.deepEqual(deliveries, []);
  });

  it('is refused when the signature is by a key the actor does not own', async () => {
    const instance = await site();

    const response = await deliver(instance, follow(), { key: strangerKeys.privateKey });

    assert.ok(!response.ok, `a forged Follow was answered ${String(response.status)}`);
    assert.equal(instance.admin.countFollowers(), 0);
    assert.equal(instance.admin.countInboxActivities(), 0);
    assert.deepEqual(deliveries, []);
  });

  it('is refused when the signature names a key nobody publishes', async () => {
    const instance = await site();

    const response = await deliver(instance, follow(), {
      keyId: `${REMOTE_ACTOR}#unpublished-key`,
    });

    assert.ok(
      !response.ok,
      `a Follow signed by an unknown key was answered ${String(response.status)}`,
    );
    assert.equal(instance.admin.countFollowers(), 0);
  });
});
