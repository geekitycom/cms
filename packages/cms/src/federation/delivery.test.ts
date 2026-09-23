import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exportJwk, importJwk } from '@fedify/fedify';
import { CryptographicKey, Endpoints, Image, Person } from '@fedify/vocab';

import { csrfField, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { listUsers } from '../admin/accounts.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { seedActorKeys, testKeyPair } from './__testing__/keys.ts';
import { addFollower } from './records.ts';

/** The site under test. Fedify answers by origin, so every request uses this one. */
const BASE_URL = 'https://blog.example';

/**
 * The one account these sites have — the name the setup form creates — and so
 * the actor every post is announced by (decision-14).
 */
const ADA = 'ada';
const ACTOR_URL = `${BASE_URL}/author/${ADA}/`;

/** The peer that follows the site. It exists only in the fetch stub. */
const REMOTE_ORIGIN = 'https://remote.example';
const REMOTE_ACTOR = `${REMOTE_ORIGIN}/users/ada`;
const REMOTE_INBOX = `${REMOTE_ORIGIN}/users/ada/inbox`;
const REMOTE_SHARED_INBOX = `${REMOTE_ORIGIN}/inbox`;
const REMOTE_KEY = `${REMOTE_ACTOR}#main-key`;

/**
 * The fixture key pair the peer signs and is verified by, which is not the one
 * the site under test holds: two identities whose keys were the same would
 * prove nothing about a signature.
 */
const REMOTE_PAIR = 1;

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
  /**
   * What it was signed with: the `Signature-Input` header RFC 9421 asks for,
   * which names the key id a receiving server has to dereference.
   */
  signature: string;
}

const started: Cms[] = [];
const temporaryDirs: string[] = [];
const deliveries: Delivery[] = [];

let remoteActorDocument: unknown;
let restoreFetch: () => void;

before(async () => {
  const keys = await testKeyPair(REMOTE_PAIR);
  remoteActorDocument = await remoteActor(keys.publicKey);
  restoreFetch = routeRemoteHost();
});

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

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
        signature: request.headers.get('signature-input') ?? request.headers.get('signature') ?? '',
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
  options: {
    watch?: boolean;
    followers?: number;
    files?: Record<string, string>;
    now?: () => Date;
    /**
     * Create the account before the site boots, for a test that never signs
     * in: decision-14 makes a user the actor a post is announced by, and a
     * site with no accounts federates nothing at all. A test that *does* sign
     * in leaves this off, because the setup form only answers for a site with
     * no accounts and it creates this same name.
     */
    account?: boolean;
    /**
     * The id the account was published under somewhere else (TASK-69), which
     * is then what every activity it sends names as its actor. Implies
     * `account`, because a stored id is a field of a user record.
     */
    actorId?: string;
  } = {},
): Promise<Site> {
  const dataDir = await temporaryDir('geekity-delivery-data-');
  const contentDir = await temporaryDir('geekity-delivery-content-');
  // Before the site boots, so nothing here spends a quarter of a second
  // minting an actor key whose value no test in this file reads.
  seedActorKeys(dataDir, ADA);

  for (const [relative, source] of Object.entries(options.files ?? {})) {
    await writeDocument(contentDir, relative, source);
  }

  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'Geekity',
      tagline: 'A file-first CMS',
      baseUrl: BASE_URL,
      timezone: 'UTC',
      postsPerPage: 10,
      author: ADA,
    },
  });

  if (options.account === true || options.actorId !== undefined) {
    writeUsers(dataDir, [
      { username: ADA, ...(options.actorId === undefined ? {} : { actorId: options.actorId }) },
    ]);
  }

  deliveries.length = 0;
  const cms = createCms({
    dataDir,
    contentDir,
    port: 0,
    watch: options.watch ?? false,
    baseUrl: BASE_URL,
    federation: { queue: null, allowPrivateAddress: true },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  started.push(cms);

  // Through the file rather than straight into the index (decision-9): the
  // index is emptied and read back from `followers.json` on every boot, so a
  // row written only to SQLite would vanish the next time a test reboots the
  // same directories.
  const records = { admin: cms.admin, contentDir };
  await addFollower(records, ADA, {
    actorId: REMOTE_ACTOR,
    inboxId: REMOTE_INBOX,
    sharedInboxId: REMOTE_SHARED_INBOX,
    handle: '@ada@remote.example',
    name: 'Ada Lovelace',
    iconUrl: null,
    url: null,
  });
  if ((options.followers ?? 1) > 1) {
    await addFollower(records, ADA, {
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

/** A draft nobody outside the site has ever seen. */
function draftPost(): string {
  return `---
title: Not finished
date: 2026-03-04T10:00:00.000Z
permalink: /2026/03/secret/
draft: true
---

Still thinking about it.
`;
}

/**
 * The same post after somebody took it back to a draft, still carrying the
 * stamp that says the followers were once told about it — which is what makes
 * a resend a `Delete` rather than nothing at all.
 */
function draftedPost(): string {
  return `---
title: On watching files
date: 2026-03-04T10:00:00.000Z
permalink: /2026/03/watched/
author: ${ADA}
draft: true
activitypub:
  published: '2026-03-04T10:00:00Z'
---

Back to the drawing board.
`;
}

/** A published post file, as a site's own content directory would hold it. */
function publishedPost(body: string): string {
  return `---
title: On watching files
date: 2026-03-04T10:00:00.000Z
permalink: /2026/03/watched/
author: ${ADA}
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
    assert.equal(create.body['actor'], ACTOR_URL);

    const object = create.body['object'] as Record<string, unknown>;
    assert.equal(object['type'], 'Article');
    assert.equal(object['id'], `${BASE_URL}/2026/03/hello-world/`);
    assert.equal(object['name'], 'Hello, world');
  });

  it('writes the first-published time, and no id, into the post’s front matter', async () => {
    const { cms, contentDir } = await site();
    const agent = await signedIn(cms);

    await publishNewPost(agent);
    await cms.delivery.settled();

    const source = await readFile(
      path.join(contentDir, 'posts', '2026-03-04-hello-world.md'),
      'utf8',
    );
    assert.match(source, /^activitypub:$/m);
    assert.match(source, /^ {2}published: '2026-03-04T10:00:00Z'$/m);
    // decision-13: the id is the permalink, so there is nothing to freeze.
    assert.doesNotMatch(source, /^ {2}id:/m);

    const indexed = cms.store.getBySlug('hello-world');
    assert.equal(indexed?.activitypub?.id, undefined);
    assert.equal(indexed?.activitypub?.published, '2026-03-04T10:00:00Z');
  });
});

describe('a scheduled post', () => {
  it('federates nothing while its date is ahead, then one Create when it arrives', async () => {
    let now = new Date('2026-09-03T12:00:00Z');
    const { cms } = await site({ now: () => now });
    const agent = await signedIn(cms);
    await cms.scheduler.start();

    const response = await publishNewPost(agent, { date: '2026-09-04T09:00:00.000Z' });
    assert.equal(response.status, 303, await response.text());
    await cms.delivery.settled();

    assert.deepEqual(deliveries, [], 'nothing goes out while the post is held');
    assert.equal(cms.scheduler.waitingFor(), '2026-09-04T09:00:00.000Z');

    now = new Date('2026-09-04T09:00:00Z');
    assert.equal(await cms.scheduler.run(), 1);
    await cms.delivery.settled();

    const creates = delivered('Create');
    assert.equal(creates.length, 1, `expected one Create, saw ${JSON.stringify(deliveries)}`);
    const object = (creates[0] as Delivery).body['object'] as Record<string, unknown>;
    assert.equal(object['type'], 'Article');
    assert.equal(object['name'], 'Hello, world');
    assert.equal(object['id'], `${BASE_URL}/2026/09/hello-world/`);

    await cms.scheduler.run();
    await cms.delivery.settled();

    assert.equal(delivered('Create').length, 1, 'and only once');
  });

  it('withdraws a published post whose date is pushed into the future', async () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const { cms } = await site({ now: () => now });
    const agent = await signedIn(cms);
    await publishNewPost(agent, { date: '2026-09-03T09:00:00.000Z' });
    await cms.delivery.settled();
    assert.equal(delivered('Create').length, 1);

    await submitEditor(agent, '/admin/posts/hello-world', { date: '2026-09-10T09:00:00.000Z' });
    await cms.delivery.settled();

    const deletes = delivered('Delete');
    assert.equal(deletes.length, 1, `expected one Delete, saw ${JSON.stringify(deliveries)}`);
    const tombstone = (deletes[0] as Delivery).body['object'] as Record<string, unknown>;
    assert.equal(tombstone['type'], 'Tombstone');
    assert.equal(tombstone['formerType'], 'as:Article');
  });

  it('federates once, on the next boot, a post that came due while nothing was running', async () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const { cms, dataDir, contentDir } = await site({ now: () => now });
    const agent = await signedIn(cms);
    await cms.scheduler.start();
    await publishNewPost(agent, { date: '2026-09-04T09:00:00.000Z' });
    await cms.delivery.settled();
    assert.deepEqual(deliveries, []);
    await cms.close();

    // The date passed while nothing was running; the same directories come back
    // up under a clock that is past it.
    let later = new Date('2026-09-05T08:00:00Z');
    const rebooted = createCms({
      dataDir,
      contentDir,
      port: 0,
      watch: false,
      baseUrl: BASE_URL,
      federation: { queue: null, allowPrivateAddress: true },
      now: () => later,
    });
    started.push(rebooted);
    await rebooted.sync();
    await rebooted.scheduler.start();
    await rebooted.delivery.settled();

    assert.equal(delivered('Create').length, 1, `saw ${JSON.stringify(deliveries)}`);

    // And a second boot after that says nothing about it again.
    await rebooted.close();
    later = new Date('2026-09-06T08:00:00Z');
    const again = createCms({
      dataDir,
      contentDir,
      port: 0,
      watch: false,
      baseUrl: BASE_URL,
      federation: { queue: null, allowPrivateAddress: true },
      now: () => later,
    });
    started.push(again);
    await again.sync();
    await again.scheduler.start();
    await again.delivery.settled();

    assert.equal(delivered('Create').length, 1, 'the watermark had already passed it');
  });

  it('publishes on its own timer, with no restart and nothing prompting it', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await cms.scheduler.start();

    const due = new Date(Date.now() + 1000).toISOString();
    await publishNewPost(agent, { date: due });
    await cms.delivery.settled();
    assert.deepEqual(deliveries, [], 'nothing goes out at the moment of saving');

    const create = await waitForDelivery('Create');

    assert.equal(
      (create.body['object'] as Record<string, unknown>)['name'],
      'Hello, world',
      'the timer fired on its own',
    );
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
    assert.equal(object['id'], `${BASE_URL}/2026/03/hello-world/`);
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

    const response = await cms.app.request(`${BASE_URL}/2026/03/hello-world/`, {
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
    assert.equal(object['id'], `${BASE_URL}/2026/03/hello-world/`);
  });
});

describe('editing a published post file on disk', () => {
  const POST_FILE = 'posts/2026-03-04-watched.md';

  it('delivers an Update of the Article', async () => {
    const { cms, contentDir } = await site({
      watch: true,
      account: true,
      files: { [POST_FILE]: publishedPost('The version everybody already has.') },
    });
    await cms.serve();
    await cms.delivery.settled();
    assert.deepEqual(deliveries, [], 'the boot scan announced nothing');

    await writeDocument(contentDir, POST_FILE, publishedPost('A second thought, written later.'));

    const update = await waitForDelivery('Update');
    assert.equal(update.url, REMOTE_SHARED_INBOX);
    assert.equal(update.body['actor'], ACTOR_URL);

    const object = update.body['object'] as Record<string, unknown>;
    assert.equal(object['type'], 'Article');
    assert.equal(object['id'], `${BASE_URL}/2026/03/watched/`);
    assert.match(String(object['content']), /A second thought, written later\./);

    // The write-back that stamps the front matter goes through the index the
    // same way an admin save does, so it is not itself an edit to announce.
    await cms.delivery.settled();
    assert.equal(delivered('Update').length, 1, `saw ${JSON.stringify(deliveries)}`);
    assert.equal(delivered('Create').length, 0, 'an edit is not a new post');
  });
});

describe('the object type across a post’s life', () => {
  const FILE = 'posts/2026-03-04-hello-world.md';

  it('names a Note in the Create, the Update and the Delete of an untitled post', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    await publishNewPost(agent, { title: '', body: 'A thought with no title.' });
    await cms.delivery.settled();
    const created = (delivered('Create')[0] as Delivery | undefined)?.body['object'];
    assert.equal((created as Record<string, unknown>)['type'], 'Note');

    await submitEditor(agent, '/admin/posts/hello-world', { body: 'A second thought.' });
    await cms.delivery.settled();
    const updated = (delivered('Update')[0] as Delivery | undefined)?.body['object'];
    assert.equal((updated as Record<string, unknown>)['type'], 'Note');

    await submitEditor(agent, '/admin/posts/hello-world', { action: 'save-draft' });
    await cms.delivery.settled();
    const deleted = (delivered('Delete')[0] as Delivery | undefined)?.body['object'];
    assert.equal((deleted as Record<string, unknown>)['formerType'], 'as:Note');
  });

  it('keeps an author-written activitypub.type through an admin save, and sends it', async () => {
    const { cms, contentDir } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();

    // The author adds the override by hand, beside the key the delivery stamped.
    const file = path.join(contentDir, ...FILE.split('/'));
    const stamped = await readFile(file, 'utf8');
    await writeFile(file, stamped.replace(/^activitypub:$/m, 'activitypub:\n  type: Note'), 'utf8');
    await cms.sync();
    deliveries.length = 0;

    const response = await submitEditor(agent, '/admin/posts/hello-world', {
      body: 'The first post, edited.',
    });
    assert.equal(response.status, 303, await response.text());
    await cms.delivery.settled();

    const source = await readFile(file, 'utf8');
    assert.match(source, /^ {2}type: Note$/m, 'the save kept the author’s type');
    assert.match(source, /^ {2}published: '2026-03-04T10:00:00Z'$/m, 'and the stamp beside it');

    const update = delivered('Update')[0] as Delivery | undefined;
    assert.ok(update !== undefined, `expected an Update, saw ${JSON.stringify(deliveries)}`);
    assert.equal((update.body['object'] as Record<string, unknown>)['type'], 'Note');

    deliveries.length = 0;
    await submitEditor(agent, '/admin/posts/hello-world', { action: 'save-draft' });
    await cms.delivery.settled();
    const deleted = (delivered('Delete')[0] as Delivery | undefined)?.body['object'];
    assert.equal((deleted as Record<string, unknown>)['formerType'], 'as:Note');
  });
});

describe('the delivery log', () => {
  it('records how every follower behind a shared inbox fared', async () => {
    const { cms } = await site({ followers: 2 });
    const agent = await signedIn(cms);

    await publishNewPost(agent);
    await cms.delivery.settled();

    const activity = cms.admin.lastDeliveryToObject(`${BASE_URL}/2026/03/hello-world/`);
    assert.ok(activity !== undefined, 'the activity that went out was recorded');
    assert.equal(activity.activityType, 'Create');
    assert.equal(activity.objectId, `${BASE_URL}/2026/03/hello-world/`);
    assert.equal(activity.slug, 'hello-world');

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
      username: ADA,
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

    const activity = cms.admin.lastDeliveryToObject(`${BASE_URL}/2026/03/hello-world/`);
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
});

describe('a user whose record carries a stored actor id', () => {
  /** What the WordPress ActivityPub plugin published this person as. */
  const STORED = `${BASE_URL}/?author=2`;
  const POST_FILE = 'posts/2026-03-04-watched.md';
  const WATCHED_OBJECT = `${BASE_URL}/2026/03/watched/`;

  /** A site whose one account was published under {@link STORED} elsewhere. */
  async function migrated(): Promise<Site> {
    return await site({ actorId: STORED, files: { [POST_FILE]: publishedPost('A first post.') } });
  }

  it('names the stored id as the actor of a Create, and signs with its key (AC #3)', async () => {
    const { cms } = await migrated();

    const report = await cms.delivery.resend('watched');
    await cms.delivery.settled();

    assert.equal(report?.activityType, 'Create');
    const create = delivered('Create')[0] as Delivery;
    assert.equal(create.body['actor'], STORED);
    assert.match(
      create.signature,
      new RegExp(`keyid="${STORED.replaceAll('?', '\\?')}#main-key"`),
      `the signature names a key the actor publishes: ${create.signature}`,
    );
    // FEP-8b32, the proof a peer verifies when it does not use the HTTP
    // signature. Fedify numbers the Ed25519 multikey 1 (doc-8).
    const proof = create.body['proof'] as { verificationMethod?: string } | undefined;
    assert.equal(proof?.verificationMethod, `${STORED}#multikey-1`);
  });

  it('names it on an Update and on a Delete as well (AC #3)', async () => {
    const { cms, contentDir } = await migrated();
    await cms.delivery.resend('watched');
    await cms.delivery.settled();
    // The Create stamped the announcement into the file; the index re-reads it,
    // so the next resend knows the followers already hold this post.
    await cms.sync();
    deliveries.length = 0;

    // A post the followers already hold goes out again as an Update.
    await cms.delivery.resend('watched');
    await cms.delivery.settled();
    assert.equal((delivered('Update')[0] as Delivery).body['actor'], STORED);

    // And one that has become a draft is withdrawn with a Delete.
    deliveries.length = 0;
    await writeDocument(contentDir, POST_FILE, draftedPost());
    await cms.sync();
    await cms.delivery.resend('watched');
    await cms.delivery.settled();

    const withdrawal = delivered('Delete')[0] as Delivery;
    assert.equal(withdrawal.body['actor'], STORED);
    assert.equal((withdrawal.body['object'] as Record<string, unknown>)['id'], WATCHED_OBJECT);
  });

  it('sends an Update of the actor under the stored id itself (AC #3)', async () => {
    const { cms, dataDir } = await migrated();
    const user = listUsers(dataDir)[0];
    assert.ok(user !== undefined);

    await cms.delivery.updateActor(user);
    await cms.delivery.settled();

    const update = delivered('Update')[0] as Delivery;
    assert.equal(update.body['actor'], STORED);
    const object = update.body['object'] as Record<string, unknown>;
    assert.equal(object['id'], STORED, 'the object is the actor, under the id followers hold');
    assert.equal(
      (object['publicKey'] as { id?: string } | undefined)?.id,
      `${STORED}#main-key`,
      'and the key a peer verifies the signature with hangs off it',
    );
  });
});

describe('resending a post', () => {
  /** Where the editor files the post {@link publishNewPost} writes. */
  const PUBLISHED_FILE = 'posts/2026-03-04-hello-world.md';
  const PUBLISHED_OBJECT = `${BASE_URL}/2026/03/hello-world/`;

  it('sends an Update built from the file as it now reads (AC #1)', async () => {
    const { cms, contentDir } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();
    const announced = String((delivered('Create')[0] as Delivery).body['id']);

    // Edited on disk and indexed by a scan, which federates nothing: the
    // followers are a revision behind, which is the state a resend is pressed
    // in. The front matter is carried through, so the post keeps the id they
    // were given.
    const file = path.join(contentDir, ...PUBLISHED_FILE.split('/'));
    const edited = (await readFile(file, 'utf8')).replace(
      'The first post.',
      'A second thought, written later.',
    );
    await writeFile(file, edited, 'utf8');
    await cms.sync();
    deliveries.length = 0;

    const report = await cms.delivery.resend('hello-world');
    assert.ok(report !== undefined, 'the post was found and sent');
    assert.equal(report.activityType, 'Update');
    assert.equal(report.objectId, PUBLISHED_OBJECT);

    const updates = delivered('Update');
    assert.equal(updates.length, 1, `expected one Update, saw ${JSON.stringify(deliveries)}`);
    const update = updates[0] as Delivery;
    assert.equal(update.body['id'], report.activityId);
    assert.notEqual(update.body['id'], announced, 'under an id no follower has seen');

    const object = update.body['object'] as Record<string, unknown>;
    assert.equal(object['id'], PUBLISHED_OBJECT, 'about the object the followers hold');
    assert.match(String(object['content']), /A second thought, written later\./);
  });

  it('gives two resends of an unchanged post two activity ids (AC #1)', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();

    // Nothing about the post moves between them, so an id derived from its
    // content — which is what a save uses — would be the same id twice, and a
    // peer is entitled to ignore an activity id it has already seen.
    const first = await cms.delivery.resend('hello-world');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await cms.delivery.resend('hello-world');

    assert.ok(first !== undefined && second !== undefined);
    assert.equal(first.objectId, second.objectId, 'both were about the same post');
    assert.notEqual(first.activityId, second.activityId);
  });

  it('sends a Create and stamps the announcement into the file when it has none (AC #2)', async () => {
    const file = 'posts/2026-03-04-watched.md';
    // Indexed by the boot scan, which federates nothing and stamps nothing, so
    // the file is a published post no follower has ever been told about.
    const { cms, contentDir } = await site({
      account: true,
      files: { [file]: publishedPost('Published, but never announced.') },
    });
    assert.deepEqual(deliveries, [], 'the scan announced nothing');

    const report = await cms.delivery.resend('watched');
    assert.equal(report?.activityType, 'Create');

    const creates = delivered('Create');
    assert.equal(creates.length, 1, `expected one Create, saw ${JSON.stringify(deliveries)}`);
    const object = (creates[0] as Delivery).body['object'] as Record<string, unknown>;
    assert.equal(object['id'], `${BASE_URL}/2026/03/watched/`);

    const source = await readFile(path.join(contentDir, ...file.split('/')), 'utf8');
    assert.match(source, /activitypub:/, 'and the announcement is in the file');
    assert.match(source, /^ {2}published: /m);
    assert.doesNotMatch(source, /^ {2}id:/m);
  });

  it('sends a Delete of a Tombstone for a post in the trash (AC #3)', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();

    await submitEditor(agent, '/admin/posts/hello-world', { action: 'trash', return: '' });
    await cms.delivery.settled();
    const withdrawn = String((delivered('Delete')[0] as Delivery).body['id']);
    deliveries.length = 0;

    const report = await cms.delivery.resend('hello-world');
    assert.equal(report?.activityType, 'Delete');

    const deletes = delivered('Delete');
    assert.equal(deletes.length, 1, `expected one Delete, saw ${JSON.stringify(deliveries)}`);
    const withdrawal = deletes[0] as Delivery;
    assert.notEqual(withdrawal.body['id'], withdrawn, 'under an id no follower has seen');

    const object = withdrawal.body['object'] as Record<string, unknown>;
    assert.equal(object['type'], 'Tombstone');
    assert.equal(object['id'], PUBLISHED_OBJECT, 'for the id the followers were given');
    assert.equal(object['formerType'], 'as:Article');
  });

  it('sends a Delete of a Tombstone for a post that has become a draft (AC #3)', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();
    await submitEditor(agent, '/admin/posts/hello-world', { action: 'save-draft' });
    await cms.delivery.settled();
    deliveries.length = 0;

    const report = await cms.delivery.resend('hello-world');

    assert.equal(report?.activityType, 'Delete');
    const object = (delivered('Delete')[0] as Delivery).body['object'] as Record<string, unknown>;
    assert.equal(object['id'], PUBLISHED_OBJECT);
  });

  it('records the outcome per follower, exactly as a publish does', async () => {
    const { cms } = await site({ followers: 2 });
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();

    const report = await cms.delivery.resend('hello-world');
    assert.ok(report !== undefined);

    assert.deepEqual(
      cms.admin.listDeliveries(report.activityId).map((delivery) => delivery.status),
      ['sent', 'sent'],
    );
    const last = cms.admin.lastDeliveryToObject(PUBLISHED_OBJECT);
    assert.equal(last?.activityType, 'Update');
    assert.equal(last?.slug, 'hello-world');
  });

  it('answers undefined for a slug no post answers to', async () => {
    const { cms } = await site();

    assert.equal(await cms.delivery.resend('nothing-of-the-sort'), undefined);
    assert.deepEqual(deliveries, [], 'and nothing was sent');
  });

  it('answers undefined for a draft the site has never announced', async () => {
    const { cms } = await site({
      files: { 'posts/2026-03-04-secret.md': draftPost() },
    });

    assert.equal(await cms.delivery.resend('secret'), undefined);
    assert.deepEqual(deliveries, [], 'there is no copy anywhere to withdraw');
  });
});

describe('renaming a post that has already been announced', () => {
  it('is refused, so no follower is ever handed a second object (decision-13)', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    await publishNewPost(agent);
    await cms.delivery.settled();
    deliveries.length = 0;

    const response = await submitEditor(agent, '/admin/posts/hello-world', {
      slug: 'renamed',
      action: 'update',
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /permalink of a published post is permanent/);
    await cms.delivery.settled();
    assert.deepEqual(deliveries, [], 'nothing was announced, because nothing moved');

    const served = await cms.app.request(`${BASE_URL}/2026/03/hello-world/`, {
      headers: { accept: 'application/activity+json' },
    });
    assert.equal(served.status, 200, 'the id every follower holds still dereferences');
  });
});

describe('two users', () => {
  it('delivers a post only to its own author’s followers (AC #3)', async () => {
    // decision-14: a post belongs to a person, and only that person's
    // followers agreed to hear from them.
    const { cms, contentDir } = await site({ account: true });
    writeUsers(cms.config.dataDir, [
      { username: ADA, id: 1 },
      { username: 'grace', id: 2 },
    ]);
    seedActorKeys(cms.config.dataDir, 'grace');
    await addFollower({ admin: cms.admin, contentDir }, 'grace', {
      actorId: OTHER_ACTOR,
      inboxId: OTHER_INBOX,
      sharedInboxId: null,
      handle: '@bob@remote.example',
      name: 'Bob',
      iconUrl: null,
      url: null,
    });

    await writeDocument(
      contentDir,
      'posts/2026-03-04-watched.md',
      publishedPost('Ada wrote this one.'),
    );
    await cms.sync();
    const report = await cms.delivery.resend('watched');

    assert.equal(report?.deliveries.length, 1, 'one recipient, not two');
    assert.equal(report?.deliveries[0]?.actorId, REMOTE_ACTOR, 'Ada’s follower');
    assert.deepEqual(
      delivered('Create').map((one) => one.url),
      [REMOTE_SHARED_INBOX],
      'Grace’s follower heard nothing about Ada’s post',
    );
  });
});

describe('a user’s own profile', () => {
  /** Save one user's profile through the users screen, as a browser would. */
  async function saveProfile(agent: Browser, fields: Record<string, string>): Promise<Response> {
    const token = csrfField(await (await agent.get('/admin/users')).text());
    assert.ok(token !== undefined, 'the users screen carried a CSRF token');

    return agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: '1',
      display_name: '',
      bio: '',
      avatar: '',
      links: '',
      ...fields,
    });
  }

  it('delivers an Update of the actor when the profile is saved (AC #4)', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    const response = await saveProfile(agent, {
      display_name: 'Ada Lovelace',
      bio: 'Writes about engines.',
      avatar: '/uploads/2026/09/me.png',
    });
    assert.equal(response.status, 303, await response.text());
    await cms.delivery.settled();

    const updates = delivered('Update');
    assert.equal(updates.length, 1, `expected one Update, saw ${JSON.stringify(deliveries)}`);
    const update = updates[0] as Delivery;
    assert.equal(update.url, REMOTE_SHARED_INBOX, 'the shared inbox was preferred');
    assert.equal(update.body['actor'], ACTOR_URL);

    const object = update.body['object'] as Record<string, unknown>;
    assert.equal(object['id'], ACTOR_URL, 'the object is the actor itself');
    assert.equal(object['type'], 'Person');
    assert.equal(object['name'], 'Ada Lovelace');
    assert.equal(object['summary'], 'Writes about engines.');
    const icon = object['icon'] as { url?: string } | undefined;
    assert.equal(
      icon?.url,
      `${BASE_URL}/uploads/2026/09/me.png`,
      'carrying the avatar as an absolute URL',
    );

    assert.match(
      await (await agent.get('/admin/users')).text(),
      /One follower has been told\./,
      'and the screen says so',
    );

    // Recorded like every other delivery, so the cache says who was told.
    const recorded = cms.admin.lastDeliveryToObject(ACTOR_URL);
    assert.ok(recorded !== undefined);
    assert.equal(recorded.activityType, 'Update');
    assert.equal(recorded.objectId, ACTOR_URL);
    assert.equal(recorded.slug, null, 'an actor update is about no post');
    assert.deepEqual(
      cms.admin.listDeliveries(recorded.activityId).map((delivery) => delivery.status),
      ['sent'],
    );
  });

  it('delivers another Update when the avatar is taken off again', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);

    await saveProfile(agent, { avatar: '/uploads/2026/09/me.png' });
    await cms.delivery.settled();
    deliveries.length = 0;

    assert.equal((await saveProfile(agent, {})).status, 303);
    await cms.delivery.settled();

    const updates = delivered('Update');
    assert.equal(updates.length, 1, `expected one Update, saw ${JSON.stringify(deliveries)}`);
    const object = (updates[0] as Delivery).body['object'] as Record<string, unknown>;
    assert.equal(object['id'], ACTOR_URL);
    assert.equal(object['icon'], undefined, 'the profile no longer carries a picture');
    assert.equal(object['name'], ADA, 'and is called by the username again');
  });

  it('tells nobody about a setting that is the site’s own business', async () => {
    const { cms } = await site();
    const agent = await signedIn(cms);
    const token = csrfField(await (await agent.get('/admin/settings')).text());
    assert.ok(token !== undefined, 'the settings screen carried a CSRF token');

    const response = await agent.post('/admin/settings', {
      csrf_token: token,
      title: 'Renamed',
      tagline: 'A file-first CMS',
      base_url: BASE_URL,
      timezone: 'Europe/London',
      language: 'en',
      author: ADA,
    });
    assert.equal(response.status, 303, await response.text());
    await cms.delivery.settled();

    // decision-14: the site is not an actor any more, so nothing on the
    // settings screen is anybody's profile.
    assert.equal(delivered('Update').length, 0);
  });
});
