import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { writeUsers } from '../admin/__testing__/users.ts';
import type { UserProfile } from '../admin/accounts.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { SiteSettings } from '../admin/settings.ts';
import type { NewFollower } from '../admin/store.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { seedActorKeys } from './__testing__/keys.ts';
import { FOLLOWERS_PAGE_SIZE, followersPage } from './followers.ts';
import { federationOrigin } from './paths.ts';

/** The origin every request in this file is sent to; Fedify checks it. */
const BASE_URL = 'https://blog.example';

/** The one account these sites have, and so the one actor they publish. */
const ADA = 'ada';
const ACTOR_URL = `${BASE_URL}/author/${ADA}/`;

/** The host the make-believe followers in this file live on. */
const REMOTE_ORIGIN = 'https://remote.example';

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/**
 * A federated CMS on directories of its own.
 *
 * Settings are written before the CMS opens the database, because
 * {@link createCms} seeds an empty settings table from `site.json` and
 * federation reads what it finds there on every request.
 */
async function site(
  settings: Partial<SiteSettings> = {},
  profile: UserProfile = { displayName: 'Ada Lovelace', bio: 'Writes about engines.' },
  /** The id this person was published under elsewhere, when they have one. */
  storedActorId?: string,
): Promise<Cms> {
  const dataDir = await temporaryDir('geekity-fed-data-');
  const contentDir = await temporaryDir('geekity-fed-content-');

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
      ...settings,
    },
  });
  // decision-14: the actor is a user, so the account exists before the boot.
  writeUsers(dataDir, [
    { username: ADA, profile, ...(storedActorId === undefined ? {} : { actorId: storedActorId }) },
  ]);
  // And the key that actor publishes is the fixture's rather than a fresh one,
  // because these tests read the shape of the actor document, not its modulus.
  // The restart test below keeps minting its own: a key that survives a reboot
  // has to have been minted by the boot before it.
  seedActorKeys(dataDir, ADA);

  const instance = createCms({ dataDir, contentDir, watch: false, baseUrl: BASE_URL });
  started.push(instance);
  return instance;
}

/** A request to the site's own origin, since Fedify answers by origin. */
async function get(instance: Cms, pathname: string, accept?: string): Promise<Response> {
  const request = new Request(
    `${BASE_URL}${pathname}`,
    accept === undefined ? {} : { headers: { accept } },
  );
  return await instance.app.request(request);
}

describe('WebFinger', () => {
  /** The JRD for one resource, or the response when it is not a 200. */
  async function webFinger(instance: Cms, resource: string): Promise<Response> {
    return await get(instance, `/.well-known/webfinger?resource=${encodeURIComponent(resource)}`);
  }

  it('resolves acct:{username}@{host} to the actor (AC #1)', async () => {
    const instance = await site();

    const response = await webFinger(instance, `acct:${ADA}@blog.example`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/jrd\+json/);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const document = (await response.json()) as {
      subject: string;
      aliases: string[];
      links: { rel: string; type?: string; href?: string }[];
    };
    assert.equal(document.subject, `acct:${ADA}@blog.example`);
    const self = document.links.find((link) => link.rel === 'self');
    assert.equal(self?.type, 'application/activity+json');
    assert.equal(self?.href, ACTOR_URL);
    const profile = document.links.find(
      (link) => link.rel === 'http://webfinger.net/rel/profile-page',
    );
    assert.equal(profile?.href, ACTOR_URL);
  });

  it('lists the author URL and /@{username} as aliases', async () => {
    const instance = await site();

    const document = (await (await webFinger(instance, `acct:${ADA}@blog.example`)).json()) as {
      aliases: string[];
    };

    assert.deepEqual(document.aliases, [ACTOR_URL, `${BASE_URL}/@${ADA}`]);
  });

  it('answers for the author URL and for /@{username} as well as the handle', async () => {
    const instance = await site();

    for (const resource of [ACTOR_URL, `${BASE_URL}/@${ADA}`, `${ADA}@blog.example`]) {
      const response = await webFinger(instance, resource);
      assert.equal(response.status, 200, `${resource} resolves`);
      const document = (await response.json()) as { subject: string };
      assert.equal(document.subject, `acct:${ADA}@blog.example`);
    }
  });

  it('answers a handle whose host is spelled in another case (AC #1)', async () => {
    const instance = await site();

    const response = await webFinger(instance, `acct:${ADA}@BLOG.EXAMPLE`);

    assert.equal(response.status, 200);
    const document = (await response.json()) as { subject: string; links: { href?: string }[] };
    assert.equal(document.subject, `acct:${ADA}@blog.example`);
    assert.equal(document.links[0]?.href, ACTOR_URL);
  });

  it('answers a handle written with the leading @ a person reads (AC #2)', async () => {
    const instance = await site();

    for (const resource of [`acct:@${ADA}@blog.example`, `@${ADA}@blog.example`]) {
      const response = await webFinger(instance, resource);
      assert.equal(response.status, 200, `${resource} resolves`);
      const document = (await response.json()) as { subject: string };
      assert.equal(document.subject, `acct:${ADA}@blog.example`);
    }
  });

  it('answers an actor URL whose host is spelled in another case (AC #4)', async () => {
    const instance = await site();

    const response = await webFinger(instance, `https://BLOG.EXAMPLE/author/${ADA}/`);

    assert.equal(response.status, 200);
    const document = (await response.json()) as { subject: string; links: { href?: string }[] };
    assert.equal(document.subject, `acct:${ADA}@blog.example`);
    assert.equal(document.links[0]?.href, ACTOR_URL);
  });

  // A host is case-insensitive and a username is not: `findUser` compares a
  // username exactly, so `Ada` is somebody else, and WebFinger must not be the
  // one place where two accounts quietly become one.
  it('does not answer for a username spelled in another case (AC #3)', async () => {
    const instance = await site();

    for (const resource of [
      `acct:Ada@blog.example`,
      `acct:@ADA@blog.example`,
      `Ada@blog.example`,
      `${BASE_URL}/@Ada`,
      `${BASE_URL}/author/Ada/`,
    ]) {
      assert.equal((await webFinger(instance, resource)).status, 404, `${resource} is nobody`);
    }
  });

  it("carries the site's own spelling as the subject, whatever was asked for (AC #5)", async () => {
    const instance = await site();

    for (const resource of [
      `acct:${ADA}@BLOG.EXAMPLE`,
      `acct:@${ADA}@Blog.Example`,
      `@${ADA}@blog.example`,
      `  acct:${ADA}@blog.example  `,
      `https://BLOG.EXAMPLE/@${ADA}`,
    ]) {
      const response = await webFinger(instance, resource);
      assert.equal(response.status, 200, `${resource} resolves`);
      const document = (await response.json()) as { subject: string; aliases: string[] };
      assert.equal(document.subject, `acct:${ADA}@blog.example`);
      assert.deepEqual(document.aliases, [ACTOR_URL, `${BASE_URL}/@${ADA}`]);
    }
  });

  it('is a 404 for a username nobody has', async () => {
    const instance = await site();

    assert.equal((await webFinger(instance, 'acct:nobody@blog.example')).status, 404);
    assert.equal((await webFinger(instance, '')).status, 404);
  });
});

describe('/@{username}', () => {
  it('redirects to the author archive, as WordPress does', async () => {
    const instance = await site();

    const response = await get(instance, `/@${ADA}`);

    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), `/author/${ADA}/`);
  });
});

describe('a user actor', () => {
  it('answers the author URL with a Person built from the profile (AC #1)', async () => {
    const instance = await site();

    const response = await get(instance, `/author/${ADA}/`, 'application/activity+json');

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /application\/(activity\+json|ld\+json)/,
    );

    const actor = (await response.json()) as Record<string, unknown>;
    assert.equal(actor['type'], 'Person');
    assert.equal(actor['id'], ACTOR_URL);
    assert.equal(actor['preferredUsername'], ADA);
    assert.equal(actor['name'], 'Ada Lovelace');
    assert.equal(actor['summary'], 'Writes about engines.');
    assert.equal(actor['url'], ACTOR_URL);
    assert.equal(actor['inbox'], `${ACTOR_URL}inbox/`);
    assert.equal(actor['outbox'], `${ACTOR_URL}outbox/`);
    assert.equal(actor['followers'], `${ACTOR_URL}followers/`);
    assert.equal(actor['following'], `${ACTOR_URL}following/`);
    assert.equal(actor['manuallyApprovesFollowers'], false);
    assert.equal(
      (actor['endpoints'] as { sharedInbox?: string } | undefined)?.sharedInbox,
      `${BASE_URL}/inbox/`,
      'the shared inbox is /inbox/ (decision-14)',
    );
  });

  it('is the archive to a browser at the same URL (AC #1)', async () => {
    const instance = await site();

    const page = await get(instance, `/author/${ADA}/`, 'text/html');

    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await page.text(), /Ada Lovelace/);
  });

  it('lists every URL it answers to as alsoKnownAs', async () => {
    const instance = await site();

    const actor = (await (
      await get(instance, `/author/${ADA}/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.deepEqual(actor['alsoKnownAs'], [ACTOR_URL, `${BASE_URL}/@${ADA}`]);
  });

  it('publishes an RSA public key and an Ed25519 assertion method', async () => {
    const instance = await site();

    const actor = (await (
      await get(instance, `/author/${ADA}/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;

    const publicKey = actor['publicKey'] as { id?: string; owner?: string; publicKeyPem?: string };
    assert.equal(publicKey.owner, ACTOR_URL);
    assert.equal(publicKey.id, `${ACTOR_URL}#main-key`, 'the key id hangs off the actor id');
    assert.match(publicKey.publicKeyPem ?? '', /^-----BEGIN PUBLIC KEY-----/);

    const methods = actor['assertionMethod'];
    const list = (Array.isArray(methods) ? methods : [methods]) as {
      id?: string;
      publicKeyMultibase?: string;
    }[];
    assert.equal(list.length, 2, 'both key pairs are published as multikeys');
    assert.deepEqual(
      list.map((method) => method.id),
      [`${ACTOR_URL}#multikey-0`, `${ACTOR_URL}#multikey-1`],
    );
    assert.ok(
      list.some((method) => (method.publicKeyMultibase ?? '').startsWith('z6Mk')),
      'one of them is the Ed25519 multikey FEP-8b32 proofs are verified against',
    );
  });

  it('carries no icon until the profile has an avatar, and the avatar once it does (AC #3)', async () => {
    const without = await site({}, { displayName: 'Ada Lovelace' });
    // A profile holds the public path the upload endpoint handed back; the
    // actor has to carry an absolute URL, which is a peer's only way to fetch
    // it.
    const with_ = await site({}, { avatar: '/uploads/2026/09/me.png' });

    const bare = (await (
      await get(without, `/author/${ADA}/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;
    const iconed = (await (
      await get(with_, `/author/${ADA}/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.equal(bare['icon'], undefined);
    assert.equal(
      (iconed['icon'] as { url?: string } | undefined)?.url,
      `${BASE_URL}/uploads/2026/09/me.png`,
    );
  });

  it('leaves an avatar that is already an absolute URL alone', async () => {
    const instance = await site({}, { avatar: 'https://cdn.example/me.png' });

    const actor = (await (
      await get(instance, `/author/${ADA}/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.equal(
      (actor['icon'] as { url?: string } | undefined)?.url,
      'https://cdn.example/me.png',
    );
  });

  it('publishes a profile’s links as property attachments', async () => {
    const instance = await site(
      {},
      { links: [{ label: 'Home', href: 'https://example.org/ada' }] },
    );

    const actor = (await (
      await get(instance, `/author/${ADA}/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;

    const attachment = actor['attachment'];
    const list = (Array.isArray(attachment) ? attachment : [attachment]) as {
      type?: string;
      name?: string;
      value?: string;
    }[];
    assert.equal(list[0]?.type, 'PropertyValue');
    assert.equal(list[0]?.name, 'Home');
    assert.match(list[0]?.value ?? '', /href="https:\/\/example\.org\/ada"/);
  });

  it('serves collections with no inline items: the outbox pages, the rest are empty', async () => {
    const instance = await site();

    for (const collection of ['outbox', 'followers', 'following']) {
      const response = await get(
        instance,
        `/author/${ADA}/${collection}/`,
        'application/activity+json',
      );
      assert.equal(response.status, 200, `${collection} answers`);
      const document = (await response.json()) as Record<string, unknown>;
      assert.equal(document['orderedItems'] ?? document['items'] ?? undefined, undefined);
    }
  });

  it('answers 404 for a username nobody has', async () => {
    const instance = await site();

    const response = await get(instance, '/author/someone-else/', 'application/activity+json');

    assert.equal(response.status, 404);
  });

  it('no longer answers the site actor at /ap/ (AC #5)', async () => {
    const instance = await site();

    for (const gone of [
      '/ap/actor',
      '/ap/actor/inbox',
      '/ap/actor/followers',
      '/ap/actor/outbox',
    ]) {
      const response = await get(instance, gone, 'application/activity+json');
      assert.equal(response.status, 404, `${gone} is unregistered`);
    }
  });
});

describe('a user whose record carries a stored actor id', () => {
  /** What WordPress published andrewshell.org's author as (decision-14). */
  const STORED = `${BASE_URL}/?author=2`;

  /** A site whose one account was published under {@link STORED} elsewhere. */
  async function migrated(): Promise<Cms> {
    return await site({}, { displayName: 'Ada Lovelace', bio: 'Writes about engines.' }, STORED);
  }

  it('publishes the stored id as the actor’s id, and its keys under it (AC #1)', async () => {
    const instance = await migrated();

    const actor = (await (
      await get(instance, `/author/${ADA}/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.equal(actor['id'], STORED, 'the id its followers already hold');
    assert.equal(actor['url'], ACTOR_URL, 'the archive is still where a person is sent');
    const publicKey = actor['publicKey'] as { id?: string; owner?: string };
    assert.equal(publicKey.id, `${STORED}#main-key`);
    assert.equal(publicKey.owner, STORED);
    const methods = actor['assertionMethod'];
    const list = (Array.isArray(methods) ? methods : [methods]) as { id?: string }[];
    assert.deepEqual(
      list.map((method) => method.id),
      [`${STORED}#multikey-0`, `${STORED}#multikey-1`],
    );
  });

  it('lists the stored id, the archive and /@{username} as alsoKnownAs', async () => {
    const instance = await migrated();

    const actor = (await (
      await get(instance, `/author/${ADA}/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.deepEqual(actor['alsoKnownAs'], [STORED, ACTOR_URL, `${BASE_URL}/@${ADA}`]);
  });

  it('serves the Person at the stored URL, query string and all (AC #1)', async () => {
    const instance = await migrated();

    const response = await get(instance, '/?author=2', 'application/activity+json');

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /application\/(activity\+json|ld\+json)/,
    );
    const actor = (await response.json()) as Record<string, unknown>;
    assert.equal(actor['type'], 'Person');
    assert.equal(actor['id'], STORED);
    assert.equal(actor['preferredUsername'], ADA);
    assert.equal((actor['publicKey'] as { id?: string }).id, `${STORED}#main-key`);
  });

  it('redirects a browser from the stored URL to the author archive (AC #1)', async () => {
    const instance = await migrated();

    const response = await get(instance, '/?author=2', 'text/html');

    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), `/author/${ADA}/`);
  });

  it('leaves the home page alone for every other request (AC #4)', async () => {
    const instance = await migrated();

    assert.equal((await get(instance, '/', 'text/html')).status, 200);
    assert.equal((await get(instance, '/?author=9', 'text/html')).status, 200);
    assert.equal((await get(instance, '/?p=2', 'text/html')).status, 200);
  });

  it('answers WebFinger with the stored id as self and all three as aliases (AC #2)', async () => {
    const instance = await migrated();

    const document = (await (
      await get(
        instance,
        `/.well-known/webfinger?resource=${encodeURIComponent(`acct:${ADA}@blog.example`)}`,
      )
    ).json()) as {
      subject: string;
      aliases: string[];
      links: { rel: string; href?: string }[];
    };

    // WordPress's own document: the handle is still the subject, but `self` is
    // the id, because that is the document a peer should fetch (doc-8).
    assert.equal(document.subject, `acct:${ADA}@blog.example`);
    assert.deepEqual(document.aliases, [STORED, ACTOR_URL, `${BASE_URL}/@${ADA}`]);
    assert.equal(document.links.find((link) => link.rel === 'self')?.href, STORED);
    assert.equal(
      document.links.find((link) => link.rel === 'http://webfinger.net/rel/profile-page')?.href,
      ACTOR_URL,
    );
  });

  it('resolves a WebFinger lookup by the stored id to the same person (AC #2)', async () => {
    const instance = await migrated();

    for (const resource of [STORED, ACTOR_URL, `${BASE_URL}/@${ADA}`, `acct:${ADA}@blog.example`]) {
      const response = await get(
        instance,
        `/.well-known/webfinger?resource=${encodeURIComponent(resource)}`,
      );
      assert.equal(response.status, 200, `${resource} resolves`);
      const document = (await response.json()) as { subject: string; links: { href?: string }[] };
      assert.equal(document.subject, `acct:${ADA}@blog.example`);
      assert.equal(document.links[0]?.href, STORED, `${resource} points at the stored id`);
    }
  });

  it('serves a path-shaped stored id the same way (AC #4)', async () => {
    const stored = `${BASE_URL}/wp-json/activitypub/1.0/actors/2`;
    const instance = await site({}, { displayName: 'Ada Lovelace' }, stored);

    const object = await get(
      instance,
      '/wp-json/activitypub/1.0/actors/2',
      'application/activity+json',
    );
    assert.equal(object.status, 200);
    assert.equal(((await object.json()) as Record<string, unknown>)['id'], stored);

    const browser = await get(instance, '/wp-json/activitypub/1.0/actors/2', 'text/html');
    assert.equal(browser.status, 301);
    assert.equal(browser.headers.get('location'), `/author/${ADA}/`);
  });
});

describe('the followers collection', () => {
  /** A follower row, with the columns the collection and delivery both read. */
  function follower(index: number): NewFollower {
    return {
      username: ADA,
      actorId: `${REMOTE_ORIGIN}/users/${index}`,
      inboxId: `${REMOTE_ORIGIN}/users/${index}/inbox`,
      sharedInboxId: `${REMOTE_ORIGIN}/inbox`,
      handle: `@user${index}@remote.example`,
      name: `User ${index}`,
      iconUrl: null,
      url: `${REMOTE_ORIGIN}/@user${index}`,
      followedAt: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    };
  }

  it('reports how many followers the site has, and pages rather than inlining them', async () => {
    const instance = await site();
    instance.admin.putFollower(follower(0));
    instance.admin.putFollower(follower(1));

    const response = await get(instance, `/author/${ADA}/followers/`, 'application/activity+json');

    assert.equal(response.status, 200);
    const collection = (await response.json()) as Record<string, unknown>;
    assert.equal(collection['totalItems'], 2);
    assert.equal(collection['orderedItems'], undefined, 'the collection itself pages');
    assert.equal(collection['first'], `${ACTOR_URL}followers/?cursor=0`);
    assert.equal(collection['last'], `${ACTOR_URL}followers/?cursor=0`);
  });

  it('lists the stored followers on a page, newest follow first', async () => {
    const instance = await site();
    instance.admin.putFollower(follower(0));
    instance.admin.putFollower(follower(1));

    const page = (await (
      await get(instance, `/author/${ADA}/followers/?cursor=0`, 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.deepEqual(page['orderedItems'], [
      'https://remote.example/users/1',
      'https://remote.example/users/0',
    ]);
    assert.equal(page['next'], undefined, 'one page holds them all');
  });

  it('walks a follower list longer than one page', async () => {
    const instance = await site();
    for (let index = 0; index <= FOLLOWERS_PAGE_SIZE; index += 1) {
      instance.admin.putFollower(follower(index));
    }

    const first = (await (
      await get(instance, `/author/${ADA}/followers/?cursor=0`, 'application/activity+json')
    ).json()) as Record<string, unknown>;
    const items = first['orderedItems'] as string[];

    assert.equal(items.length, FOLLOWERS_PAGE_SIZE);
    assert.equal(first['next'], `${ACTOR_URL}followers/?cursor=${String(FOLLOWERS_PAGE_SIZE)}`);

    const second = (await (
      await get(
        instance,
        `/author/${ADA}/followers/?cursor=${String(FOLLOWERS_PAGE_SIZE)}`,
        'application/activity+json',
      )
    ).json()) as Record<string, unknown>;

    assert.deepEqual(second['orderedItems'], ['https://remote.example/users/0']);
    assert.equal(second['prev'], `${ACTOR_URL}followers/?cursor=0`);
  });

  it('hands delivery every follower at once, and with the inboxes to reach them', async () => {
    // A cursor of `null` is how Fedify asks for the whole collection before it
    // fans an activity out. Answering that with one page would silently strand
    // every follower past the first twenty.
    const instance = await site();
    for (let index = 0; index <= FOLLOWERS_PAGE_SIZE; index += 1) {
      instance.admin.putFollower(follower(index));
    }
    const context = instance.federation.createContext(new URL(BASE_URL), {
      admin: instance.admin,
      store: instance.store,
      config: instance.config,
    });

    const everybody = followersPage(context, ADA, null);

    assert.equal(everybody.items.length, FOLLOWERS_PAGE_SIZE + 1);
    assert.equal(everybody.nextCursor ?? null, null, 'there is nothing left to page to');
    const first = everybody.items[0];
    assert.equal(first?.id?.href, `${REMOTE_ORIGIN}/users/${String(FOLLOWERS_PAGE_SIZE)}`);
    assert.equal(
      first?.inboxId?.href,
      `${REMOTE_ORIGIN}/users/${String(FOLLOWERS_PAGE_SIZE)}/inbox`,
    );
    assert.equal(first?.endpoints?.sharedInbox?.href, `${REMOTE_ORIGIN}/inbox`);
  });

  it('stays empty for the following collection, which the site never fills', async () => {
    const instance = await site();
    instance.admin.putFollower(follower(0));

    const following = (await (
      await get(instance, `/author/${ADA}/following/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.equal(following['totalItems'] ?? 0, 0);
  });
});

describe('NodeInfo', () => {
  it('points /.well-known/nodeinfo at the 2.1 document', async () => {
    const instance = await site();

    const response = await get(instance, '/.well-known/nodeinfo');

    assert.equal(response.status, 200);
    const document = (await response.json()) as { links: { rel: string; href: string }[] };
    const link = document.links.find(
      (entry) => entry.rel === 'http://nodeinfo.diaspora.software/ns/schema/2.1',
    );
    assert.equal(link?.href, `${BASE_URL}/nodeinfo/2.1`);
  });

  it('reports geekity-cms and the package version at the linked document', async () => {
    const { version } = await import('../../package.json', { with: { type: 'json' } }).then(
      (module) => module.default as { version: string },
    );
    const instance = await site();

    const response = await get(instance, '/nodeinfo/2.1');

    assert.equal(response.status, 200);
    const info = (await response.json()) as {
      version: string;
      software: { name: string; version: string };
      protocols: string[];
      usage: { users: { total: number }; localPosts: number };
      openRegistrations: boolean;
    };
    assert.equal(info.version, '2.1');
    assert.equal(info.software.name, 'geekity-cms');
    assert.equal(info.software.version, version);
    assert.deepEqual(info.protocols, ['activitypub']);
    assert.equal(info.openRegistrations, false);
    assert.equal(info.usage.users.total, 1);
    assert.equal(info.usage.localPosts, 0);
  });
});

describe('the CMS instance', () => {
  it('exposes the federation object so later work can send activities', async () => {
    const instance = await site();

    assert.equal(typeof instance.federation.fetch, 'function');
  });

  it('keeps the actor keys across a restart of the same data directory', async () => {
    // Criterion 3, at the level a follower sees it: the published key has to
    // be the same one after a reboot, or every signature stops verifying.
    const dataDir = await temporaryDir('geekity-fed-restart-data-');
    const contentDir = await temporaryDir('geekity-fed-restart-content-');

    writeUsers(dataDir, [{ username: ADA }]);
    const first = createCms({ dataDir, contentDir, watch: false, baseUrl: BASE_URL });
    const before = (await (
      await get(first, `/author/${ADA}/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;
    await first.close();

    const second = createCms({ dataDir, contentDir, watch: false, baseUrl: BASE_URL });
    started.push(second);
    const after_ = (await (
      await get(second, `/author/${ADA}/`, 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.deepEqual(after_['publicKey'], before['publicKey']);
    assert.deepEqual(after_['assertionMethod'], before['assertionMethod']);
  });
});

describe('the rest of the app', () => {
  it('still answers a browser, so Fedify only claims its own paths', async () => {
    const instance = await site();

    const home = await get(instance, '/', 'text/html');
    const health = await get(instance, '/_geekity/health');

    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(health.status, 200);
  });
});

describe('federationOrigin', () => {
  it('keeps the host and the scheme of a plain base URL', () => {
    assert.deepEqual(federationOrigin('https://blog.example'), {
      handleHost: 'blog.example',
      webOrigin: 'https://blog.example',
    });
  });

  it('drops the path, because WebFinger lives at the host root', () => {
    // A site under a subdirectory still federates as @handle@host and still
    // answers /.well-known/webfinger on the host; only its pages are prefixed.
    assert.deepEqual(federationOrigin('https://example.com/blog'), {
      handleHost: 'example.com',
      webOrigin: 'https://example.com',
    });
  });

  it('keeps a non-default port, which is part of the handle host', () => {
    assert.deepEqual(federationOrigin('http://localhost:3000'), {
      handleHost: 'localhost:3000',
      webOrigin: 'http://localhost:3000',
    });
  });
});
