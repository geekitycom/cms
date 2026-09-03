import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportJwk, importJwk } from '@fedify/fedify';
import { CryptographicKey, Endpoints, Image, Person } from '@fedify/vocab';

import { csrfField, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { writeSiteSettings } from '../admin/settings.ts';
import { openAdminStore } from '../admin/store.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

/** The site under test. Fedify answers by origin, so every request uses this one. */
const BASE_URL = 'https://blog.example';

/** The peer that follows the site. It exists only in the fetch stub. */
const REMOTE_ORIGIN = 'https://remote.example';
const REMOTE_ACTOR = `${REMOTE_ORIGIN}/users/ada`;
const REMOTE_INBOX = `${REMOTE_ORIGIN}/users/ada/inbox`;
const REMOTE_SHARED_INBOX = `${REMOTE_ORIGIN}/inbox`;
const REMOTE_KEY = `${REMOTE_ACTOR}#main-key`;

/** A second follower on the same instance, so a shared inbox has two people behind it. */
const OTHER_ACTOR = `${REMOTE_ORIGIN}/users/bob`;
const OTHER_INBOX = `${REMOTE_ORIGIN}/users/bob/inbox`;

/** A third host, whose inbox answers every delivery with a server error. */
const BROKEN_ORIGIN = 'https://broken.example';
const BROKEN_ACTOR = `${BROKEN_ORIGIN}/users/nobody`;
const BROKEN_INBOX = `${BROKEN_ORIGIN}/users/nobody/inbox`;

/** One POST the site made while delivering. */
interface Delivery {
  /** Where it went. */
  url: string;
  /** Its body, as the JSON-LD the peer would read. */
  body: Record<string, unknown>;
}

const started: Cms[] = [];
const temporaryDirs: string[] = [];
const deliveries: Delivery[] = [];

let remoteActorDocument: unknown;
let restoreFetch: () => void;

before(async () => {
  const keys = await generateRemoteKeys();
  remoteActorDocument = await remoteActor(keys.publicKey);
  restoreFetch = routeRemoteHost();
});

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function generateRemoteKeys(): Promise<CryptoKeyPair> {
  const { generateCryptoKeyPair } = await import('@fedify/fedify');
  return await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
}

/** The actor document the stubbed host serves when the site dereferences the follower. */
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
      publicKey: await importJwk(await exportJwk(publicKey), 'public'),
    }),
  });
  return await person.toJsonLd();
}

/**
 * Route the make-believe hosts through memory instead of the network: a POST to
 * a follower's inbox is recorded rather than sent, and the broken host answers
 * every one of them with a server error.
 *
 * The URL is read without consuming the argument, so a request for anything
 * else — a JSON-LD context Fedify has not cached — reaches the real `fetch`
 * untouched.
 */
function routeRemoteHost(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(requestUrl(input));
    if (url.origin === BROKEN_ORIGIN) {
      return new Response('This instance is having a bad day.', { status: 500 });
    }
    if (url.origin !== REMOTE_ORIGIN) return await original(input, init);

    const request = new Request(input, init);
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

/** The URL a `fetch` argument names, without reading the body a Request holds. */
function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** What {@link site} hands a test: the CMS and the directories it was built over. */
interface Site {
  cms: Cms;
  contentDir: string;
  dataDir: string;
}

/**
 * A federated CMS with one follower, no queue — so a delivery is a POST that
 * has already happened by the time `settled()` resolves — and the
 * private-address guard off, because neither host in this file resolves.
 */
async function site(
  options: { watch?: boolean; followers?: number; files?: Record<string, string> } = {},
): Promise<Site> {
  const dataDir = await temporaryDir('geekity-delivery-data-');
  const contentDir = await temporaryDir('geekity-delivery-content-');

  for (const [relative, source] of Object.entries(options.files ?? {})) {
    await writeDocument(contentDir, relative, source);
  }

  const seed = openAdminStore({ dataDir });
  writeSiteSettings(seed, {
    title: 'Geekity',
    tagline: 'A file-first CMS',
    baseUrl: BASE_URL,
    timezone: 'UTC',
    postsPerPage: 10,
    author: 'Ada',
    actorHandle: 'blog',
    actorType: 'Person',
  });
  seed.close();

  deliveries.length = 0;
  const cms = createCms({
    dataDir,
    contentDir,
    port: 0,
    watch: options.watch ?? false,
    baseUrl: BASE_URL,
    federation: { queue: null, allowPrivateAddress: true },
  });
  started.push(cms);

  cms.admin.putFollower({
    actorId: REMOTE_ACTOR,
    inboxId: REMOTE_INBOX,
    sharedInboxId: REMOTE_SHARED_INBOX,
    handle: '@ada@remote.example',
    name: 'Ada Lovelace',
    iconUrl: null,
    url: null,
  });
  if ((options.followers ?? 1) > 1) {
    cms.admin.putFollower({
      actorId: OTHER_ACTOR,
      inboxId: OTHER_INBOX,
      sharedInboxId: REMOTE_SHARED_INBOX,
      handle: '@bob@remote.example',
      name: 'Bob',
      iconUrl: null,
      url: null,
    });
  }

  await cms.sync();
  return { cms, contentDir, dataDir };
}

/** Write one Markdown file under the content directory. */
async function writeDocument(contentDir: string, relative: string, source: string): Promise<void> {
  const file = path.join(contentDir, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source, 'utf8');
}

/** Post the "add post" form the way a browser would, and follow nothing. */
async function publishNewPost(
  agent: Browser,
  fields: Record<string, string> = {},
): Promise<Response> {
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

/** The value of a form field in a rendered editor. */
function field(html: string, name: string): string | undefined {
  return new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html)?.[1];
}

/**
 * Fill in the editor for an existing post and submit it, the way a browser
 * would: load the form, keep every value it came with, change the ones the
 * test cares about, and post it back with the CSRF token and the hash.
 */
async function submitEditor(
  agent: Browser,
  url: string,
  changes: Record<string, string>,
): Promise<Response> {
  const html = await (await agent.get(url)).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, `the editor at ${url} carried a CSRF token`);

  return agent.post(url, {
    csrf_token: token,
    hash: field(html, 'hash') ?? '',
    title: field(html, 'title') ?? '',
    slug: field(html, 'slug') ?? '',
    permalink: field(html, 'permalink') ?? '',
    date: field(html, 'date') ?? '',
    tags: field(html, 'tags') ?? '',
    description: field(html, 'description') ?? '',
    body: /<textarea[^>]*name="body"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '',
    action: 'update',
    ...changes,
  });
}

/** Every delivery whose activity is of this type. */
function delivered(type: string): Delivery[] {
  return deliveries.filter((delivery) => delivery.body['type'] === type);
}

/**
 * The first delivery of this type, waiting for it to arrive.
 *
 * The watcher debounces, so a change made on disk is federated a moment after
 * the write rather than during it; there is nothing to await but the effect.
 */
async function waitForDelivery(type: string, timeoutMs = 5000): Promise<Delivery> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const found = delivered(type)[0];
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      assert.fail(
        `no ${type} arrived within ${String(timeoutMs)}ms: ${JSON.stringify(deliveries)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** A published post file, as a site's own content directory would hold it. */
function publishedPost(body: string): string {
  return `---
title: On watching files
date: 2026-03-04T10:00:00.000Z
permalink: /2026/03/watched/
tags:
  - essays
---

${body}
`;
}

describe('publishing a post from the admin', () => {
  it('delivers a Create of the Article to the follower’s shared inbox', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    const response = await publishNewPost(agent);
    assert.equal(response.status, 303, await response.text());
    await cms.delivery.settled();

    const creates = delivered('Create');
    assert.equal(creates.length, 1, `expected one Create, saw ${JSON.stringify(deliveries)}`);
    const create = creates[0] as Delivery;
    assert.equal(create.url, REMOTE_SHARED_INBOX, 'the shared inbox was preferred');
    assert.equal(create.body['actor'], `${BASE_URL}/ap/actor`);

    const object = create.body['object'] as Record<string, unknown>;
    assert.equal(object['type'], 'Article');
    assert.equal(object['id'], `${BASE_URL}/ap/posts/hello-world`);
    assert.equal(object['name'], 'Hello, world');
  });

  it('writes the object id and the first-published time into the post’s front matter', async () => {
    const { cms, contentDir } = await site();
    const agent = await signedIn(cms);

    await publishNewPost(agent);
    await cms.delivery.settled();

    const source = await readFile(
      path.join(contentDir, 'posts', '2026-03-04-hello-world.md'),
      'utf8',
    );
    assert.match(source, /^activitypub:$/m);
    assert.match(source, new RegExp(`^ {2}id: ${BASE_URL}/ap/posts/hello-world$`, 'm'));
    assert.match(source, /^ {2}published: '2026-03-04T10:00:00\.000Z'$/m);

    const indexed = cms.store.getBySlug('hello-world');
    assert.equal(indexed?.activitypub?.id, `${BASE_URL}/ap/posts/hello-world`);
    assert.equal(indexed?.activitypub?.published, '2026-03-04T10:00:00.000Z');
  });
});

describe('unpublishing a post', () => {
  it('delivers a Delete of a Tombstone that keeps the object’s id', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();
    deliveries.length = 0;

    const response = await submitEditor(agent, '/admin/posts/hello-world', {
      action: 'save-draft',
    });
    assert.equal(response.status, 303, await response.text());
    await cms.delivery.settled();

    const deletes = delivered('Delete');
    assert.equal(deletes.length, 1, `expected one Delete, saw ${JSON.stringify(deliveries)}`);
    const withdrawal = deletes[0] as Delivery;
    assert.equal(withdrawal.url, REMOTE_SHARED_INBOX);

    const object = withdrawal.body['object'] as Record<string, unknown>;
    assert.equal(object['type'], 'Tombstone');
    assert.equal(object['id'], `${BASE_URL}/ap/posts/hello-world`);
    assert.equal(object['formerType'], 'as:Article', 'the tombstone says what it used to be');
    assert.ok(typeof object['deleted'] === 'string', 'the tombstone was dated');
  });

  it('stops serving the object, so a peer that refetches sees it is gone', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();

    await submitEditor(agent, '/admin/posts/hello-world', { action: 'save-draft' });
    await cms.delivery.settled();

    const response = await cms.app.request(`${BASE_URL}/ap/posts/hello-world`, {
      headers: { accept: 'application/activity+json' },
    });
    assert.equal(response.status, 404);
  });
});

describe('restoring a post from the trash', () => {
  it('announces it again under the object id it was first published with', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();
    const firstObjectId = (
      (delivered('Create')[0] as Delivery).body['object'] as Record<string, unknown>
    )['id'];

    await submitEditor(agent, '/admin/posts/hello-world', { action: 'trash', return: '' });
    await cms.delivery.settled();
    assert.equal(delivered('Delete').length, 1, 'trashing withdrew the post');

    deliveries.length = 0;
    const response = await submitEditor(agent, '/admin/posts/hello-world', {
      action: 'restore',
      return: '',
    });
    assert.equal(response.status, 303, await response.text());
    await cms.delivery.settled();

    const creates = delivered('Create');
    assert.equal(creates.length, 1, `expected one Create, saw ${JSON.stringify(deliveries)}`);
    const object = (creates[0] as Delivery).body['object'] as Record<string, unknown>;
    assert.equal(object['id'], firstObjectId, 'the restored post kept its object id');
    assert.equal(object['id'], `${BASE_URL}/ap/posts/hello-world`);
  });
});

describe('editing a published post file on disk', () => {
  const POST_FILE = 'posts/2026-03-04-watched.md';

  it('delivers an Update of the Article', async () => {
    const { cms, contentDir } = await site({
      watch: true,
      files: { [POST_FILE]: publishedPost('The version everybody already has.') },
    });
    await cms.serve();
    await cms.delivery.settled();
    assert.deepEqual(deliveries, [], 'the boot scan announced nothing');

    await writeDocument(contentDir, POST_FILE, publishedPost('A second thought, written later.'));

    const update = await waitForDelivery('Update');
    assert.equal(update.url, REMOTE_SHARED_INBOX);
    assert.equal(update.body['actor'], `${BASE_URL}/ap/actor`);

    const object = update.body['object'] as Record<string, unknown>;
    assert.equal(object['type'], 'Article');
    assert.equal(object['id'], `${BASE_URL}/ap/posts/watched`);
    assert.match(String(object['content']), /A second thought, written later\./);

    // The write-back that stamps the front matter goes through the index the
    // same way an admin save does, so it is not itself an edit to announce.
    await cms.delivery.settled();
    assert.equal(delivered('Update').length, 1, `saw ${JSON.stringify(deliveries)}`);
    assert.equal(delivered('Create').length, 0, 'an edit is not a new post');
  });
});

describe('the delivery log', () => {
  it('records how every follower behind a shared inbox fared', async () => {
    const { cms } = await site({ followers: 2 });
    const agent = await signedIn(cms);

    await publishNewPost(agent);
    await cms.delivery.settled();

    const [activity] = cms.admin.listOutboundActivities();
    assert.ok(activity !== undefined, 'the activity that went out was recorded');
    assert.equal(activity.activityType, 'Create');
    assert.equal(activity.objectId, `${BASE_URL}/ap/posts/hello-world`);
    assert.equal(activity.slug, 'hello-world');
    assert.match(activity.json, /"Create"/);

    const recorded = cms.admin.listDeliveries(activity.activityId);
    assert.deepEqual(
      recorded.map((delivery) => [delivery.actorId, delivery.inboxId, delivery.status]),
      [
        [REMOTE_ACTOR, REMOTE_SHARED_INBOX, 'sent'],
        [OTHER_ACTOR, REMOTE_SHARED_INBOX, 'sent'],
      ].sort(),
    );
    assert.deepEqual(cms.admin.countDeliveriesByStatus(activity.activityId), {
      sent: 2,
      queued: 0,
      failed: 0,
    });
    assert.equal(delivered('Create').length, 1, 'one shared inbox took one POST');
  });

  it('records the reason a delivery failed', async () => {
    const { cms } = await site();
    cms.admin.putFollower({
      actorId: BROKEN_ACTOR,
      inboxId: BROKEN_INBOX,
      sharedInboxId: null,
      handle: '@nobody@broken.example',
      name: null,
      iconUrl: null,
      url: null,
    });
    const agent = await signedIn(cms);

    await publishNewPost(agent);
    await cms.delivery.settled();

    const [activity] = cms.admin.listOutboundActivities();
    assert.ok(activity !== undefined);
    const failed = cms.admin
      .listDeliveries(activity.activityId)
      .find((delivery) => delivery.actorId === BROKEN_ACTOR);
    assert.equal(failed?.status, 'failed');
    assert.ok((failed?.error ?? '') !== '', 'the failure was explained');

    const reached = cms.admin
      .listDeliveries(activity.activityId)
      .find((delivery) => delivery.actorId === REMOTE_ACTOR);
    assert.equal(reached?.status, 'sent', 'one bad inbox does not stop the others');
  });

  it('sends a recorded activity again when asked to redeliver it', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();

    const [activity] = cms.admin.listOutboundActivities();
    assert.ok(activity !== undefined);
    deliveries.length = 0;

    const report = await cms.delivery.redeliver(activity.activityId);
    assert.ok(report !== undefined, 'the activity was found and sent again');
    assert.equal(report.activityId, activity.activityId);
    assert.equal(report.activityType, 'Create');
    assert.deepEqual(
      report.deliveries.map((delivery) => delivery.status),
      ['sent'],
    );

    const resent = delivered('Create');
    assert.equal(resent.length, 1, `expected one Create, saw ${JSON.stringify(deliveries)}`);
    assert.equal((resent[0] as Delivery).body['id'], activity.activityId);
  });

  it('answers undefined for an activity it never sent', async () => {
    const { cms } = await site();

    assert.equal(await cms.delivery.redeliver(`${BASE_URL}/ap/posts/nothing#create`), undefined);
  });
});

describe('renaming a post that has already been announced', () => {
  it('keeps the object id, sends an Update, and goes on answering at the old URL', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();
    deliveries.length = 0;

    const response = await submitEditor(agent, '/admin/posts/hello-world', {
      slug: 'renamed',
      action: 'update',
    });
    assert.equal(response.status, 303, await response.text());
    await cms.delivery.settled();

    const updates = delivered('Update');
    assert.equal(updates.length, 1, `expected one Update, saw ${JSON.stringify(deliveries)}`);
    assert.equal(delivered('Create').length, 0, 'a rename is not a second post');
    assert.equal(delivered('Delete').length, 0, 'and it does not withdraw the first one');

    const object = (updates[0] as Delivery).body['object'] as Record<string, unknown>;
    assert.equal(object['id'], `${BASE_URL}/ap/posts/hello-world`);

    const served = await cms.app.request(`${BASE_URL}/ap/posts/hello-world`, {
      headers: { accept: 'application/activity+json' },
    });
    assert.equal(served.status, 200, 'the id every follower holds still dereferences');
    const document = (await served.json()) as Record<string, unknown>;
    assert.equal(document['id'], `${BASE_URL}/ap/posts/hello-world`);

    const fresh = await cms.app.request(`${BASE_URL}/ap/posts/renamed`, {
      headers: { accept: 'application/activity+json' },
    });
    assert.equal(fresh.status, 404, 'the new slug is not a second object');
  });
});
