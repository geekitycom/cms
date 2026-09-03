import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { writeSiteSettings } from '../admin/settings.ts';
import type { SiteSettings } from '../admin/settings.ts';
import { openAdminStore } from '../admin/store.ts';
import type { NewFollower } from '../admin/store.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { FOLLOWERS_PAGE_SIZE, followersPage } from './followers.ts';
import { federationOrigin } from './paths.ts';

/** The origin every request in this file is sent to; Fedify checks it. */
const BASE_URL = 'https://blog.example';

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
async function site(settings: Partial<SiteSettings> = {}): Promise<Cms> {
  const dataDir = await temporaryDir('geekity-fed-data-');
  const contentDir = await temporaryDir('geekity-fed-content-');

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
    avatar: '',
    ...settings,
  });
  seed.close();

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
  it('resolves acct:{handle}@{host} to the actor', async () => {
    const instance = await site();

    const response = await get(
      instance,
      '/.well-known/webfinger?resource=acct%3Ablog%40blog.example',
    );

    assert.equal(response.status, 200);
    const document = (await response.json()) as {
      subject: string;
      links: { rel: string; type?: string; href?: string }[];
    };
    assert.equal(document.subject, 'acct:blog@blog.example');
    const self = document.links.find((link) => link.rel === 'self');
    assert.equal(self?.type, 'application/activity+json');
    assert.equal(self?.href, `${BASE_URL}/ap/actor`);
  });

  it('follows the handle setting rather than a fixed name', async () => {
    const instance = await site({ actorHandle: 'notes' });

    const wrong = await get(instance, '/.well-known/webfinger?resource=acct%3Ablog%40blog.example');
    const right = await get(
      instance,
      '/.well-known/webfinger?resource=acct%3Anotes%40blog.example',
    );

    assert.equal(wrong.status, 404);
    assert.equal(right.status, 200);
    // The id is the same whatever the handle is, so a rename does not orphan
    // the followers of the old one.
    const document = (await right.json()) as { links: { rel: string; href?: string }[] };
    assert.equal(document.links.find((link) => link.rel === 'self')?.href, `${BASE_URL}/ap/actor`);
  });
});

describe('the site actor', () => {
  it('answers the actor URL with a Person built from the settings', async () => {
    const instance = await site();

    const response = await get(instance, '/ap/actor', 'application/activity+json');

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') ?? '',
      /application\/(activity\+json|ld\+json)/,
    );

    const actor = (await response.json()) as Record<string, unknown>;
    assert.equal(actor['type'], 'Person');
    assert.equal(actor['id'], `${BASE_URL}/ap/actor`);
    assert.equal(actor['preferredUsername'], 'blog');
    assert.equal(actor['name'], 'Geekity');
    assert.equal(actor['summary'], 'A file-first CMS');
    // A URL, so the site root normalises with its trailing slash.
    assert.equal(actor['url'], `${BASE_URL}/`);
    assert.equal(actor['inbox'], `${BASE_URL}/ap/actor/inbox`);
    assert.equal(actor['outbox'], `${BASE_URL}/ap/actor/outbox`);
    assert.equal(actor['followers'], `${BASE_URL}/ap/actor/followers`);
  });

  it('publishes an RSA public key and an Ed25519 assertion method', async () => {
    const instance = await site();

    const actor = (await (
      await get(instance, '/ap/actor', 'application/activity+json')
    ).json()) as Record<string, unknown>;

    const publicKey = actor['publicKey'] as { id?: string; owner?: string; publicKeyPem?: string };
    assert.equal(publicKey.owner, `${BASE_URL}/ap/actor`);
    assert.match(publicKey.publicKeyPem ?? '', /^-----BEGIN PUBLIC KEY-----/);

    const methods = actor['assertionMethod'];
    const list = (Array.isArray(methods) ? methods : [methods]) as {
      publicKeyMultibase?: string;
    }[];
    assert.equal(list.length, 2, 'both key pairs are published as multikeys');
    assert.ok(
      list.some((method) => (method.publicKeyMultibase ?? '').startsWith('z6Mk')),
      'one of them is the Ed25519 multikey FEP-8b32 proofs are verified against',
    );
  });

  it('is the configured actor type, not always a Person', async () => {
    const instance = await site({ actorType: 'Service' });

    const actor = (await (
      await get(instance, '/ap/actor', 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.equal(actor['type'], 'Service');
  });

  it('carries no icon until an avatar is set, and the avatar once it is (AC #3)', async () => {
    const without = await site();
    // The setting holds the public path the upload endpoint handed back; the
    // actor has to carry an absolute URL, which is a peer's only way to fetch
    // it.
    const with_ = await site({ avatar: '/uploads/2026/09/me.png' });

    const bare = (await (
      await get(without, '/ap/actor', 'application/activity+json')
    ).json()) as Record<string, unknown>;
    const iconed = (await (
      await get(with_, '/ap/actor', 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.equal(bare['icon'], undefined);
    assert.equal(
      (iconed['icon'] as { url?: string } | undefined)?.url,
      `${BASE_URL}/uploads/2026/09/me.png`,
    );
  });

  it('leaves an avatar that is already an absolute URL alone', async () => {
    const instance = await site({ avatar: 'https://cdn.example/me.png' });

    const actor = (await (
      await get(instance, '/ap/actor', 'application/activity+json')
    ).json()) as Record<string, unknown>;

    assert.equal(
      (actor['icon'] as { url?: string } | undefined)?.url,
      'https://cdn.example/me.png',
    );
  });

  it('serves collections with no inline items: the outbox pages, the rest are empty', async () => {
    const instance = await site();

    for (const collection of ['outbox', 'followers', 'following']) {
      const response = await get(instance, `/ap/actor/${collection}`, 'application/activity+json');
      assert.equal(response.status, 200, `${collection} answers`);
      const document = (await response.json()) as Record<string, unknown>;
      assert.equal(document['orderedItems'] ?? document['items'] ?? undefined, undefined);
    }
  });

  it('answers 404 for an identifier that is not the site actor', async () => {
    const instance = await site();

    const response = await get(instance, '/ap/someone-else', 'application/activity+json');

    assert.equal(response.status, 404);
  });
});

describe('the followers collection', () => {
  /** A follower row, with the columns the collection and delivery both read. */
  function follower(index: number): NewFollower {
    return {
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

    const response = await get(instance, '/ap/actor/followers', 'application/activity+json');

    assert.equal(response.status, 200);
    const collection = (await response.json()) as Record<string, unknown>;
    assert.equal(collection['totalItems'], 2);
    assert.equal(collection['orderedItems'], undefined, 'the collection itself pages');
    assert.equal(collection['first'], `${BASE_URL}/ap/actor/followers?cursor=0`);
    assert.equal(collection['last'], `${BASE_URL}/ap/actor/followers?cursor=0`);
  });

  it('lists the stored followers on a page, newest follow first', async () => {
    const instance = await site();
    instance.admin.putFollower(follower(0));
    instance.admin.putFollower(follower(1));

    const page = (await (
      await get(instance, '/ap/actor/followers?cursor=0', 'application/activity+json')
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
      await get(instance, '/ap/actor/followers?cursor=0', 'application/activity+json')
    ).json()) as Record<string, unknown>;
    const items = first['orderedItems'] as string[];

    assert.equal(items.length, FOLLOWERS_PAGE_SIZE);
    assert.equal(
      first['next'],
      `${BASE_URL}/ap/actor/followers?cursor=${String(FOLLOWERS_PAGE_SIZE)}`,
    );

    const second = (await (
      await get(
        instance,
        `/ap/actor/followers?cursor=${String(FOLLOWERS_PAGE_SIZE)}`,
        'application/activity+json',
      )
    ).json()) as Record<string, unknown>;

    assert.deepEqual(second['orderedItems'], ['https://remote.example/users/0']);
    assert.equal(second['prev'], `${BASE_URL}/ap/actor/followers?cursor=0`);
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

    const everybody = followersPage(context, null);

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
      await get(instance, '/ap/actor/following', 'application/activity+json')
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
    assert.equal(info.usage.users.total, 0);
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

    const first = createCms({ dataDir, contentDir, watch: false, baseUrl: BASE_URL });
    const before = (await (
      await get(first, '/ap/actor', 'application/activity+json')
    ).json()) as Record<string, unknown>;
    await first.close();

    const second = createCms({ dataDir, contentDir, watch: false, baseUrl: BASE_URL });
    started.push(second);
    const after_ = (await (
      await get(second, '/ap/actor', 'application/activity+json')
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
