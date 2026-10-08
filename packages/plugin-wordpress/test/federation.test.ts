import assert from 'node:assert/strict';
import type { webcrypto } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportJwk, importJwk, signRequest } from '@fedify/fedify';
import { CryptographicKey, Endpoints, Follow, Image, Person, Undo } from '@fedify/vocab';

import { createCms } from '@geekity/cms';
import type { Cms } from '@geekity/cms';

import wordpress from '../src/index.ts';
import { ACTORS_FILE, REQUESTS_FILE } from '../src/records.ts';
import type { WordPressRequests } from '../src/records.ts';
import { seedActorKeys, testKeyPair, writeSite, writeUsers } from './site.ts';

/**
 * The WordPress ActivityPub compatibility paths (TASK-70, TASK-282).
 *
 * The paths under test are the ones andrewshell.org publishes today
 * (decision-14): the personal inbox `/wp-json/activitypub/1.0/actors/2/inbox`,
 * the shared `/wp-json/activitypub/1.0/inbox`, and the collections beside
 * them. They are cache rather than identity, which is why every one of them is
 * served only while the plugin is enabled and why the identity a peer reads
 * back is always the canonical one.
 */

const BASE_URL = 'https://blog.example';

/** The one account these sites have: the person WordPress numbered 2. */
const LOCAL_USER = 'andrew';
const WORDPRESS_ACTOR_ID = 2;
/** The id WordPress published them under, which their followers hold. */
const STORED_ACTOR_ID = `${BASE_URL}/?author=2`;

/** Where the plugin put this person's endpoints. */
const WP_BASE = '/wp-json/activitypub/1.0';
const WP_ACTOR = `${BASE_URL}${WP_BASE}/actors/${String(WORDPRESS_ACTOR_ID)}`;
const WP_INBOX = `${WP_ACTOR}/inbox`;
const WP_SHARED_INBOX = `${BASE_URL}${WP_BASE}/inbox`;

/** The peer that follows. It exists only in the fetch stub. */
const REMOTE_ORIGIN = 'https://remote.example';
const REMOTE_ACTOR = `${REMOTE_ORIGIN}/users/ada`;
const REMOTE_INBOX = `${REMOTE_ACTOR}/inbox`;
const REMOTE_KEY = `${REMOTE_ACTOR}#main-key`;

/**
 * The fixture key pairs the peer and the impostor hold, each different from
 * the site's own: the test that refuses a stranger's signature is only worth
 * anything while the three keys are three keys.
 */
const REMOTE_PAIR = 1;
const STRANGER_PAIR = 2;

const started: Cms[] = [];
const temporaryDirs: string[] = [];
const deliveries: { url: string; body: Record<string, unknown> }[] = [];

let remoteKeys: webcrypto.CryptoKeyPair;
let strangerKeys: webcrypto.CryptoKeyPair;
let remoteActorDocument: unknown;
let restoreFetch: () => void;

before(async () => {
  remoteKeys = await testKeyPair(REMOTE_PAIR);
  strangerKeys = await testKeyPair(STRANGER_PAIR);
  remoteActorDocument = await new Person({
    id: new URL(REMOTE_ACTOR),
    preferredUsername: 'ada',
    name: 'Ada Lovelace',
    url: new URL(`${REMOTE_ORIGIN}/@ada`),
    icon: new Image({ url: new URL(`${REMOTE_ORIGIN}/avatars/ada.png`) }),
    inbox: new URL(REMOTE_INBOX),
    endpoints: new Endpoints({ sharedInbox: new URL(`${REMOTE_ORIGIN}/inbox`) }),
    publicKey: new CryptographicKey({
      id: new URL(REMOTE_KEY),
      owner: new URL(REMOTE_ACTOR),
      publicKey: await importJwk(await exportJwk(remoteKeys.publicKey), 'public'),
    }),
  }).toJsonLd();
  restoreFetch = routeRemoteHost();
});

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Answer the make-believe peer from memory rather than over the network. */
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

/** How a site under test is set up. */
interface SiteOptions {
  /** Whether the plugin starts enabled. Off, as a new install's is. */
  enabled?: boolean;
  /** The number the plugin gave this person, or none at all. */
  wordpressActorId?: number | undefined;
  /** The id they were published under, or none at all. */
  actorId?: string | undefined;
}

/** The plugin's data folder under a site's data directory. */
function pluginData(dataDir: string): string {
  return path.join(dataDir, 'plugins', '@geekity', 'plugin-wordpress');
}

/** The record of when each path was last asked for, as the file says now. */
function readRequests(dataDir: string): WordPressRequests {
  try {
    return JSON.parse(readFileSync(path.join(pluginData(dataDir), REQUESTS_FILE), 'utf8'));
  } catch {
    return { users: {} };
  }
}

/** A federated CMS with no queue, so an inbox delivery is over when it answers. */
async function site(options: SiteOptions = {}): Promise<Cms> {
  const dataDir = await temporaryDir('geekity-wp-data-');
  const contentDir = await temporaryDir('geekity-wp-content-');

  writeSite(contentDir, {
    baseUrl: BASE_URL,
    author: LOCAL_USER,
    enabled: options.enabled ?? false,
  });
  const actorId = 'actorId' in options ? options.actorId : STORED_ACTOR_ID;
  const wordpressActorId =
    'wordpressActorId' in options ? options.wordpressActorId : WORDPRESS_ACTOR_ID;
  writeUsers(dataDir, [
    {
      username: LOCAL_USER,
      displayName: 'Andrew Shell',
      ...(actorId === undefined ? {} : { actorId }),
    },
  ]);
  if (wordpressActorId !== undefined) {
    mkdirSync(pluginData(dataDir), { recursive: true });
    writeFileSync(
      path.join(pluginData(dataDir), ACTORS_FILE),
      JSON.stringify({ [LOCAL_USER]: wordpressActorId }),
    );
  }
  // Before the site boots, so nothing here spends a quarter of a second
  // minting an actor key whose value no test in this file reads.
  seedActorKeys(dataDir, LOCAL_USER);

  deliveries.length = 0;
  const instance = createCms({
    dataDir,
    contentDir,
    watch: false,
    baseUrl: BASE_URL,
    federation: { queue: null, allowPrivateAddress: true },
    plugins: [wordpress],
  });
  started.push(instance);
  return instance;
}

/** Enable or disable the plugin on a running site, as the Plugins screen would. */
function setEnabled(instance: Cms, on: boolean): void {
  writeSite(instance.config.contentDir, { baseUrl: BASE_URL, author: LOCAL_USER, enabled: on });
}

/** How a POST to one of the compatibility inboxes is signed. */
interface DeliverOptions {
  /** Which inbox to deliver to. The personal one, by default. */
  inbox?: string;
  /** The private key that signs it. The remote actor's, by default. */
  key?: CryptoKey;
  /** Skip the signature altogether. */
  unsigned?: boolean;
  /** Headers besides the content type, such as Fetch Metadata. */
  headers?: Record<string, string>;
}

/** Deliver one activity, signed as a real peer would sign it. */
async function deliver(
  instance: Cms,
  activity: { toJsonLd(): Promise<unknown> },
  options: DeliverOptions = {},
): Promise<Response> {
  const request = new Request(options.inbox ?? WP_INBOX, {
    method: 'POST',
    headers: { ...options.headers, 'content-type': 'application/activity+json' },
    body: JSON.stringify(await activity.toJsonLd()),
  });
  const sent =
    options.unsigned === true
      ? request
      : await signRequest(request, options.key ?? remoteKeys.privateKey, new URL(REMOTE_KEY));
  return await instance.app.request(sent);
}

/** A `Follow` of the person, addressed at the id WordPress published. */
function follow(id = `${REMOTE_ORIGIN}/follows/1`, object = STORED_ACTOR_ID): Follow {
  return new Follow({
    id: new URL(id),
    actor: new URL(REMOTE_ACTOR),
    object: new URL(object),
  });
}

/** A GET of one of the compatibility paths, as a peer would make it. */
async function get(instance: Cms, url: string): Promise<Response> {
  return await instance.app.request(
    new Request(url, { headers: { accept: 'application/activity+json' } }),
  );
}

describe('with the plugin disabled', () => {
  it('registers no /wp-json/ path at all', async () => {
    const instance = await site();

    for (const url of [WP_ACTOR, `${WP_ACTOR}/outbox`, `${WP_ACTOR}/followers`]) {
      assert.equal((await get(instance, url)).status, 404, url);
    }
    assert.equal((await deliver(instance, follow())).status, 404, WP_INBOX);
    assert.equal(
      (await deliver(instance, follow(), { inbox: WP_SHARED_INBOX })).status,
      404,
      WP_SHARED_INBOX,
    );
    assert.equal(instance.admin.countFollowers(LOCAL_USER), 0);
  });
});

describe('with the plugin enabled', () => {
  it('accepts a signed Follow at the plugin’s personal inbox', async () => {
    const instance = await site({ enabled: true });

    const response = await deliver(instance, follow());

    assert.equal(response.status, 202, await response.text());
    const stored = instance.admin.getFollower(LOCAL_USER, REMOTE_ACTOR);
    assert.equal(stored?.inboxId, REMOTE_INBOX);
    assert.equal(stored?.handle, '@ada@remote.example');

    // The Accept comes from the id the actor document publishes, not from the
    // /wp-json/ path the delivery happened to arrive at: those paths are cache
    // and the actor's id is identity (decision-14).
    const accept = deliveries.find((delivery) => delivery.url === REMOTE_INBOX);
    assert.equal(accept?.body['type'], 'Accept');
    assert.equal(accept?.body['actor'], STORED_ACTOR_ID);
  });

  it('accepts one at the plugin’s shared inbox', async () => {
    const instance = await site({ enabled: true });

    const response = await deliver(instance, follow(), { inbox: WP_SHARED_INBOX });

    assert.equal(response.status, 202, await response.text());
    assert.equal(instance.admin.getFollower(LOCAL_USER, REMOTE_ACTOR)?.inboxId, REMOTE_INBOX);
  });

  it('accepts one at either inbox whatever Fetch Metadata it carries (TASK-132)', async () => {
    const crossSite = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' };

    for (const inbox of [WP_INBOX, WP_SHARED_INBOX]) {
      const instance = await site({ enabled: true });
      const response = await deliver(instance, follow(), { inbox, headers: crossSite });

      assert.equal(response.status, 202, await response.text());
      assert.equal(instance.admin.countFollowers(LOCAL_USER), 1, inbox);
    }
  });

  it('refuses an unsigned or badly signed one', async () => {
    const instance = await site({ enabled: true });

    assert.equal((await deliver(instance, follow(), { unsigned: true })).status, 401);
    assert.equal(
      (await deliver(instance, follow(), { key: strangerKeys.privateKey })).status,
      401,
      'a signature by a key the actor does not own',
    );
    assert.equal(instance.admin.countFollowers(LOCAL_USER), 0);
  });

  it('answers the actor and the three collections under actors/{id}', async () => {
    const instance = await site({ enabled: true });
    await deliver(instance, follow());

    const actor = await get(instance, WP_ACTOR);
    assert.equal(actor.status, 200, await actor.clone().text());
    const person = (await actor.json()) as Record<string, unknown>;
    assert.equal(person['type'], 'Person');
    assert.equal(person['id'], STORED_ACTOR_ID, 'the identity, not the path it was fetched at');
    assert.equal(person['inbox'], `${BASE_URL}/author/${LOCAL_USER}/inbox/`, 'the canonical inbox');

    for (const name of ['outbox', 'followers', 'following']) {
      const response = await get(instance, `${WP_ACTOR}/${name}`);
      assert.equal(response.status, 200, `${name}: ${await response.clone().text()}`);
      const collection = (await response.json()) as Record<string, unknown>;
      assert.match(String(collection['type']), /Collection/, name);
      assert.equal(
        collection['totalItems'] ?? 0,
        name === 'followers' ? 1 : 0,
        `${name} counts what the user has`,
      );
    }
  });

  it('answers nothing for a number no user carries', async () => {
    const instance = await site({ enabled: true });

    assert.equal((await get(instance, `${BASE_URL}${WP_BASE}/actors/9`)).status, 404);
    assert.equal(
      (await deliver(instance, follow(), { inbox: `${BASE_URL}${WP_BASE}/actors/9/inbox` })).status,
      404,
    );
  });
});

describe('an Undo of a Follow at the old inbox', () => {
  it('removes the follower, as the site’s own inbox would', async () => {
    const instance = await site({ enabled: true });
    await deliver(instance, follow());
    assert.equal(instance.admin.countFollowers(LOCAL_USER), 1);

    const undo = new Undo({
      id: new URL(`${REMOTE_ORIGIN}/follows/1/undo`),
      actor: new URL(REMOTE_ACTOR),
      object: follow(),
    });
    const response = await deliver(instance, undo);

    assert.equal(response.status, 202, await response.text());
    assert.equal(instance.admin.countFollowers(LOCAL_USER), 0);
  });
});

describe('one Follow, two inboxes', () => {
  it('is handled once, however many of the paths it is delivered to', async () => {
    const instance = await site({ enabled: true });

    // The same activity, redelivered: a peer that holds both the old inbox and
    // the new one, or one retrying after a timeout. The default `per-inbox`
    // idempotence folds the recipient into the key, so `andrew` and `2` would
    // be two keys and the Accept would go out twice (doc-8).
    await deliver(instance, follow(), { inbox: WP_INBOX });
    await deliver(instance, follow(), { inbox: `${BASE_URL}/author/${LOCAL_USER}/inbox/` });

    assert.equal(instance.admin.countFollowers(LOCAL_USER), 1);
    assert.equal(
      deliveries.filter((delivery) => delivery.body['type'] === 'Accept').length,
      1,
      'the follower is told once',
    );
  });
});

describe('a user WordPress numbered but never published an id for', () => {
  it('is still followed at the compatibility inbox, under their author URL', async () => {
    const instance = await site({ enabled: true, actorId: undefined });
    const authorUrl = `${BASE_URL}/author/${LOCAL_USER}/`;

    const response = await deliver(instance, follow(`${REMOTE_ORIGIN}/follows/1`, authorUrl));

    assert.equal(response.status, 202, await response.text());
    assert.equal(instance.admin.getFollower(LOCAL_USER, REMOTE_ACTOR)?.inboxId, REMOTE_INBOX);
    const accept = deliveries.find((delivery) => delivery.body['type'] === 'Accept');
    assert.equal(accept?.body['actor'], authorUrl);
  });
});

describe('disabling the plugin', () => {
  it('takes the paths away on the next request, with nothing restarted', async () => {
    const instance = await site({ enabled: true });

    assert.equal((await get(instance, WP_ACTOR)).status, 200);

    setEnabled(instance, false);
    assert.equal((await get(instance, WP_ACTOR)).status, 404, 'gone on the very next request');
    assert.equal((await deliver(instance, follow())).status, 404);

    setEnabled(instance, true);
    assert.equal((await get(instance, WP_ACTOR)).status, 200, 'and back again, both ways');
  });
});

describe('when each path was last asked for', () => {
  it('records every route, per user, in a file under data/', async () => {
    const instance = await site({ enabled: true });

    assert.deepEqual(
      readRequests(instance.config.dataDir),
      { users: {} },
      'a site nobody has asked has nothing to say',
    );

    await get(instance, WP_ACTOR);
    await get(instance, `${WP_ACTOR}/outbox`);
    await get(instance, `${WP_ACTOR}/followers`);
    await get(instance, `${WP_ACTOR}/following`);
    await deliver(instance, follow());
    await deliver(instance, follow(`${REMOTE_ORIGIN}/follows/2`), { inbox: WP_SHARED_INBOX });

    const requests = readRequests(instance.config.dataDir);
    for (const route of ['actor', 'outbox', 'followers', 'following', 'inbox'] as const) {
      assert.match(
        requests.users[LOCAL_USER]?.[route] ?? '',
        /^\d{4}-\d{2}-\d{2}T/,
        `${route} was timed`,
      );
    }
    assert.match(requests.sharedInbox ?? '', /^\d{4}-\d{2}-\d{2}T/, 'and so was the shared inbox');

    const onDisk = JSON.parse(
      await readFile(path.join(pluginData(instance.config.dataDir), REQUESTS_FILE), 'utf8'),
    ) as Record<string, unknown>;
    assert.ok('users' in onDisk && 'sharedInbox' in onDisk);
  });

  it('survives a restart and a rebuilt database', async () => {
    const instance = await site({ enabled: true });
    await get(instance, WP_ACTOR);
    const before = readRequests(instance.config.dataDir).users[LOCAL_USER]?.actor;
    assert.ok(before !== undefined);

    await instance.close();
    await rm(path.join(instance.config.dataDir, 'geekity.db'), { force: true });
    const again = createCms({
      dataDir: instance.config.dataDir,
      contentDir: instance.config.contentDir,
      watch: false,
      baseUrl: BASE_URL,
      federation: { queue: null, allowPrivateAddress: true },
      plugins: [wordpress],
    });
    started.push(again);

    assert.equal(readRequests(again.config.dataDir).users[LOCAL_USER]?.actor, before);
  });

  it('records nothing for a number no user carries', async () => {
    const instance = await site({ enabled: true });

    await get(instance, `${BASE_URL}${WP_BASE}/actors/9`);

    assert.deepEqual(readRequests(instance.config.dataDir).users, {});
  });
});
