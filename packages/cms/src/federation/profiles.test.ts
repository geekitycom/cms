/**
 * The profiles of fediverse actors who are not followers (TASK-184).
 *
 * The actor at the centre of every test is shaped the way a current Mastodon
 * publishes one: its id is `/ap/users/{number}`, which says nothing about who
 * it is, and its name, handle, profile page and picture are only in the
 * document the id dereferences to. The network is a table in memory, and every
 * request made to it is recorded, so a test can say what was fetched and when.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { exportJwk, importJwk, signRequest } from '@fedify/fedify';
import type { KvStore } from '@fedify/fedify';
import { CryptographicKey, Endpoints, Image, Like, Person } from '@fedify/vocab';
import sharp from 'sharp';

import { sandbox } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { avatarHref } from '../avatars/avatars.ts';
import { discardDatabase } from '../cache.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';
import { testKeyPair } from './__testing__/keys.ts';
import { createActorProfileService } from './profiles.ts';
import type { ActorProfile } from '../admin/store.ts';

const box = sandbox();

const BASE_URL = 'https://blog.example';
const LOCAL_USER = 'blog';
const SITE_INBOX = `${BASE_URL}/author/${LOCAL_USER}/inbox/`;
const POST = `${BASE_URL}/2026/09/test-004-long-content/`;

/** A Mastodon actor minted after numeric ids: nothing in the URL names them. */
const NICO = 'https://mastodon.social/ap/users/117132440785278319';
const NICO_KEY = `${NICO}#main-key`;
const NICO_PAGE = 'https://mastodon.social/@nicopeaks';
const NICO_ICON = 'https://files.mastodon.social/accounts/avatars/117/132/original/nico.png';

/** A second numeric actor, whose server never answers for them. */
const SILENT = 'https://mastodon.social/ap/users/117000000000000001';

/** A follower, who is also somebody the actor profiles know. */
const ADA = 'https://mastodon.social/ap/users/42';

const ADDRESSES: Record<string, string[]> = {
  'mastodon.social': ['203.0.113.20'],
  'files.mastodon.social': ['203.0.113.21'],
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
let web: Record<string, (request: Request) => Response | Promise<Response>> = {};

let nicoKeys: CryptoKeyPair;
let nicoName = 'Nico Peaks';
let icon: Buffer;

const original = globalThis.fetch;
before(async () => {
  nicoKeys = await testKeyPair(1);
  icon = await sharp({
    create: { width: 120, height: 120, channels: 3, background: { r: 20, g: 90, b: 200 } },
  })
    .png()
    .toBuffer();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = request.url.replace(/#.*$/, '');
    if (request.method === 'GET') requested.push(url);
    return (await web[url]?.(request)) ?? new Response('missing', { status: 404 });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = original;
  await box.cleanup();
});

afterEach(() => {
  requested.length = 0;
  nicoName = 'Nico Peaks';
  web = {};
});

/** The actor document mastodon.social serves for Nico, as it would serve it. */
async function nicoDocument(): Promise<unknown> {
  return await new Person({
    id: new URL(NICO),
    preferredUsername: 'nicopeaks',
    name: nicoName,
    url: new URL(NICO_PAGE),
    icon: new Image({ url: new URL(NICO_ICON), mediaType: 'image/png' }),
    inbox: new URL(`${NICO}/inbox`),
    endpoints: new Endpoints({ sharedInbox: new URL('https://mastodon.social/inbox') }),
    publicKey: new CryptographicKey({
      id: new URL(NICO_KEY),
      owner: new URL(NICO),
      publicKey: await importJwk(await exportJwk(nicoKeys.publicKey), 'public'),
    }),
  }).toJsonLd();
}

/**
 * Put Nico and his picture on the stubbed web. mastodon.social answers an
 * unsigned request for an actor with a 401, so this does too.
 */
function serveNico(): void {
  web[NICO] = async (request) =>
    request.headers.has('signature') || request.headers.has('signature-input')
      ? new Response(JSON.stringify(await nicoDocument()), {
          headers: { 'content-type': 'application/activity+json' },
        })
      : new Response('{"error":"Request not signed"}', { status: 401 });
  web[NICO_ICON] = () => new Response(icon, { headers: { 'content-type': 'image/png' } });
}

/** One logged Like of the post by `actor`, as the inbox log holds it. */
function likeLine(actor: string, n: number): string {
  return `${JSON.stringify({
    receivedAt: `2026-09-2${String(n)}T10:00:00.000Z`,
    recipient: LOCAL_USER,
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${actor}#likes/${String(n)}`,
    type: 'Like',
    actor,
    object: POST,
  })}\n`;
}

/** A KV store that keeps nothing, so every document is fetched afresh. */
const forgetful: KvStore = {
  get: () => Promise.resolve(undefined),
  set: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  async *list() {},
};

interface Site {
  cms: Cms;
  contentDir: string;
  dataDir: string;
  clock: { at: Date };
}

/**
 * A site with one post, whose inbox log already holds whatever `log` says:
 * the state of a site that was running before this task shipped.
 */
async function site(log = '', kv?: KvStore): Promise<Site> {
  const contentDir = await box.dir('geekity-profiles-content-');
  const dataDir = await box.dir('geekity-profiles-data-');
  const files: Record<string, string> = {
    'posts/test-004-long-content.md': [
      '---',
      'title: Test 004',
      "date: '2026-09-10T09:00:00Z'",
      'permalink: /2026/09/test-004-long-content/',
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

  const clock = { at: new Date('2026-09-29T12:00:00Z') };
  const cms = await boot(contentDir, dataDir, clock, kv);
  return { cms, contentDir, dataDir, clock };
}

async function boot(
  contentDir: string,
  dataDir: string,
  clock: { at: Date },
  kv?: KvStore,
): Promise<Cms> {
  return await box.open(
    {
      contentDir,
      dataDir,
      baseUrl: BASE_URL,
      hostLookup: lookup,
      now: () => clock.at,
      federation: { queue: null, allowPrivateAddress: true, ...(kv === undefined ? {} : { kv }) },
    },
    { actorKeys: [LOCAL_USER] },
  );
}

/** The post page, as a reader is served it. */
async function page(cms: Cms): Promise<string> {
  const response = await cms.app.request('/2026/09/test-004-long-content/');
  assert.equal(response.status, 200);
  return await response.text();
}

/** Deliver a Like from Nico, signed with his key, to the site's inbox. */
async function deliverLike(cms: Cms): Promise<Response> {
  const like = new Like({
    id: new URL(`${NICO}#likes/live`),
    actor: new URL(NICO),
    object: new URL(POST),
  });
  const request = new Request(SITE_INBOX, {
    method: 'POST',
    headers: { 'content-type': 'application/activity+json' },
    body: JSON.stringify(await like.toJsonLd()),
  });
  return await cms.app.request(await signRequest(request, nicoKeys.privateKey, new URL(NICO_KEY)));
}

describe('an activity from an actor the site does not know (AC #1, #8)', () => {
  it('stores their name, handle, profile page and picture', async () => {
    serveNico();
    const { cms } = await site();

    const response = await deliverLike(cms);
    assert.equal(response.status, 202, await response.text());
    await cms.actorProfiles.settled();

    const stored = cms.admin.getActorProfile(NICO);
    assert.equal(stored?.name, 'Nico Peaks');
    assert.equal(stored?.handle, '@nicopeaks@mastodon.social');
    assert.equal(stored?.url, NICO_PAGE);
    assert.equal(stored?.iconUrl, NICO_ICON);
  });

  it('is captured in the background, so the caller never waits for the fetch', async () => {
    const { cms } = await site();
    let release: (profile: ActorProfile) => void = () => undefined;
    const service = createActorProfileService({
      admin: cms.admin,
      config: cms.config,
      load: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    cms.admin.logInboxActivity({
      activityId: `${NICO}#likes/1`,
      activityType: 'Like',
      actorId: NICO,
      objectId: POST,
      json: likeLine(NICO, 1),
    });

    const returned = service.capture(NICO);

    assert.equal(returned, undefined, 'capture hands back nothing to wait on');
    assert.equal(cms.admin.getActorProfile(NICO), undefined, 'nothing is stored yet');
    release({
      actorId: NICO,
      handle: '@nicopeaks@mastodon.social',
      name: 'Nico Peaks',
      url: NICO_PAGE,
      iconUrl: NICO_ICON,
    });
    await service.settled();
    assert.equal(cms.admin.getActorProfile(NICO)?.name, 'Nico Peaks');
  });

  it('is shown on the post without anything fetched while the page is served', async () => {
    serveNico();
    const { cms } = await site();
    await deliverLike(cms);
    await cms.actorProfiles.settled();
    requested.length = 0;

    const html = await page(cms);

    assert.deepEqual(requested, [], 'drawing the page reached out to nobody');
    assert.match(html, /title="Nico Peaks"/);
    assert.ok(html.includes(`src="${avatarHref(NICO_ICON)}"`), 'the picture is the proxied one');
    assert.ok(!html.includes('117132440785278319'), 'no number is shown anywhere as a name');
  });
});

describe('naming an actor (AC #2, #3, #5)', () => {
  it('prefers the follower record, then the stored profile', async () => {
    const { cms } = await site(likeLine(ADA, 1) + likeLine(NICO, 2));
    cms.admin.putFollower({
      username: LOCAL_USER,
      actorId: ADA,
      inboxId: `${ADA}/inbox`,
      sharedInboxId: null,
      handle: '@ada@mastodon.social',
      name: 'Ada (as she followed)',
      iconUrl: null,
      url: 'https://mastodon.social/@ada',
    });
    cms.admin.putActorProfile({
      actorId: ADA,
      handle: '@ada@mastodon.social',
      name: 'Ada (as a stranger)',
      iconUrl: null,
      url: 'https://mastodon.social/@ada',
      fetchedAt: '2026-09-29T12:00:00.000Z',
    });
    cms.admin.putActorProfile({
      actorId: NICO,
      handle: '@nicopeaks@mastodon.social',
      name: 'Nico Peaks',
      iconUrl: null,
      url: NICO_PAGE,
      fetchedAt: '2026-09-29T12:00:00.000Z',
    });

    const html = await page(cms);

    assert.match(html, /title="Ada \(as she followed\)"/);
    assert.doesNotMatch(html, /as a stranger/);
    assert.match(html, /href="https:\/\/mastodon\.social\/@nicopeaks" title="Nico Peaks"/);
  });

  it('shows an unknown numeric actor by their server and links to their id', async () => {
    const { cms } = await site(likeLine(NICO, 1));

    const html = await page(cms);

    assert.ok(
      html.includes(`href="${NICO}" title="mastodon.social"`),
      'named by the server, linked to the actor id',
    );
    assert.ok(!html.includes('@117132440785278319'), 'the number is never a handle');
  });

  it('still guesses a handle from an actor URL that ends in a name', async () => {
    const { cms } = await site(likeLine('https://remote.example/users/grace', 1));

    const html = await page(cms);

    assert.match(html, /title="@grace@remote\.example"/);
  });
});

describe('the avatar proxy (AC #4)', () => {
  it('serves a stored profile’s picture, and nothing it has not recorded', async () => {
    serveNico();
    const { cms } = await site(likeLine(NICO, 1));
    const href = avatarHref(NICO_ICON);

    const before = await cms.app.request(href);
    assert.equal(before.status, 404, 'an icon nobody recorded is refused');

    await cms.actorProfiles.sweep();
    const served = await cms.app.request(href);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/webp');

    const stranger = await cms.app.request(avatarHref('https://files.mastodon.social/other.png'));
    assert.equal(stranger.status, 404, 'the proxy is still no open proxy');
  });
});

describe('keeping the profiles (AC #6)', () => {
  it('refetches a stale profile in the background and leaves a fresh one alone', async () => {
    serveNico();
    // Fedify's document cache keeps an actor for minutes, and a profile goes
    // stale in days, so by the time one is refreshed the cache has long let
    // go of it. A store that keeps nothing is that, without waiting a week.
    const { cms, clock } = await site(likeLine(NICO, 1), forgetful);
    await cms.actorProfiles.sweep();
    const first = cms.admin.getActorProfile(NICO)?.fetchedAt;

    requested.length = 0;
    clock.at = new Date(clock.at.getTime() + 24 * 60 * 60 * 1000);
    await cms.actorProfiles.sweep();
    assert.ok(!requested.includes(NICO), 'a day-old profile is not fetched again');
    assert.equal(cms.admin.getActorProfile(NICO)?.fetchedAt, first);

    nicoName = 'Nico P.';
    clock.at = new Date(clock.at.getTime() + 7 * 24 * 60 * 60 * 1000);
    await cms.actorProfiles.sweep();
    assert.equal(cms.admin.getActorProfile(NICO)?.name, 'Nico P.');
  });

  it('leaves a follower to the profile the follow stored', async () => {
    serveNico();
    const { cms } = await site(likeLine(NICO, 1));
    cms.admin.putFollower({
      username: LOCAL_USER,
      actorId: NICO,
      inboxId: `${NICO}/inbox`,
      sharedInboxId: null,
      handle: '@nicopeaks@mastodon.social',
      name: 'Nico Peaks',
      iconUrl: NICO_ICON,
      url: NICO_PAGE,
    });

    await cms.actorProfiles.sweep();

    assert.ok(!requested.includes(NICO), 'a follower is not fetched');
  });

  it('comes back after the database is deleted', async () => {
    serveNico();
    const { cms, contentDir, dataDir, clock } = await site(likeLine(NICO, 1));
    await cms.actorProfiles.sweep();
    assert.match(await page(cms), /title="Nico Peaks"/);
    await cms.close();

    discardDatabase(dataDir);
    const rebooted = await boot(contentDir, dataDir, clock);
    assert.equal(rebooted.admin.getActorProfile(NICO), undefined, 'the cache went with the file');
    assert.match(await page(rebooted), /title="mastodon\.social"/);

    await rebooted.actorProfiles.sweep();
    assert.match(await page(rebooted), /title="Nico Peaks"/);
  });

  it('does not ask a server that failed again within the hour', async () => {
    const { cms } = await site(likeLine(SILENT, 1));

    await cms.actorProfiles.sweep();
    assert.ok(requested.includes(SILENT), 'the first sweep asked');
    requested.length = 0;
    await cms.actorProfiles.sweep();

    assert.ok(!requested.includes(SILENT), 'the second did not');
    assert.equal(cms.admin.getActorProfile(SILENT), undefined);
  });
});

describe('an inbox log from before profiles were kept (AC #7)', () => {
  it('is backfilled when the sweep starts, once', async () => {
    serveNico();
    const { cms } = await site(likeLine(NICO, 1));
    assert.match(await page(cms), /title="mastodon\.social"/, 'unnamed before the backfill');

    cms.actorProfiles.start();
    await cms.actorProfiles.settled();
    cms.actorProfiles.stop();

    const html = await page(cms);
    assert.match(html, /title="Nico Peaks"/);
    assert.ok(html.includes(`src="${avatarHref(NICO_ICON)}"`));

    requested.length = 0;
    cms.actorProfiles.start();
    await cms.actorProfiles.settled();
    cms.actorProfiles.stop();
    assert.ok(!requested.includes(NICO), 'a second start fetches nothing it already has');
  });
});
