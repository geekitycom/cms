import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { signedIn, signIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import { openAdminStore } from '../admin/store.ts';
import type { AdminStore, NewFollower } from '../admin/store.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { deliveryTargets } from './delivery.ts';
import { readFileIfPresentSync } from '../files/atomic.ts';
import {
  addFollower,
  appendInboxActivity,
  followersFile,
  inboxFile,
  migrateFederationToFiles,
  readFollowers,
  readInboxLog,
  rebuildFederationIndexes,
  removeFollower,
} from './records.ts';

const temporaryDirs: string[] = [];
const openStores: AdminStore[] = [];

after(async () => {
  for (const opened of openStores) opened.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A directory that goes away when the file finishes. */
async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-records-'));
  temporaryDirs.push(dir);
  return dir;
}

/** A content directory and the index over it, both of this test's own. */
async function records(): Promise<{ admin: AdminStore; contentDir: string }> {
  const admin = openAdminStore({ dataDir: await temporaryDir() });
  openStores.push(admin);
  return { admin, contentDir: await temporaryDir() };
}

const ADA = 'https://remote.example/users/ada';

/** One follower, as a `Follow` from Ada's instance would describe her. */
function ada(overrides: Partial<NewFollower> = {}): NewFollower {
  return {
    actorId: ADA,
    inboxId: `${ADA}/inbox`,
    sharedInboxId: 'https://remote.example/inbox',
    handle: '@ada@remote.example',
    name: 'Ada Lovelace',
    iconUrl: 'https://remote.example/avatars/ada.png',
    url: 'https://remote.example/@ada',
    ...overrides,
  };
}

describe('the followers file', () => {
  it('is written by a follow, with everything the actor published', async () => {
    const site = await records();

    const stored = await addFollower(site, ada({ followedAt: '2026-09-01T10:00:00.000Z' }));

    assert.deepEqual(JSON.parse(await readFile(followersFile(site.contentDir), 'utf8')), [
      {
        actorId: ADA,
        inboxId: `${ADA}/inbox`,
        sharedInboxId: 'https://remote.example/inbox',
        handle: '@ada@remote.example',
        name: 'Ada Lovelace',
        iconUrl: 'https://remote.example/avatars/ada.png',
        url: 'https://remote.example/@ada',
        followedAt: '2026-09-01T10:00:00.000Z',
      },
    ]);
    assert.equal(stored.followedAt, '2026-09-01T10:00:00.000Z');
  });

  it('lives under content/_data/federation, so the site publishes it', async () => {
    const site = await records();

    assert.equal(
      path.relative(site.contentDir, followersFile(site.contentDir)),
      path.join('_data', 'federation', 'followers.json'),
    );
  });

  it('updates the index in the same step, so the collection sees the follow at once', async () => {
    const site = await records();

    await addFollower(site, ada());

    assert.equal(site.admin.countFollowers(), 1);
    assert.equal(site.admin.getFollower(ADA)?.inboxId, `${ADA}/inbox`);
  });

  it('times a follow that did not say when it happened', async () => {
    const site = await records();

    const stored = await addFollower(site, ada());

    assert.ok(!Number.isNaN(new Date(stored.followedAt).getTime()), stored.followedAt);
    assert.equal(readFollowers(site.contentDir)[0]?.followedAt, stored.followedAt);
  });

  it('refreshes a profile rather than adding a second entry, keeping the follow time', async () => {
    const site = await records();
    await addFollower(site, ada({ followedAt: '2026-09-01T10:00:00.000Z' }));

    await addFollower(site, ada({ name: 'Ada, Countess of Lovelace' }));

    const held = readFollowers(site.contentDir);
    assert.equal(held.length, 1);
    assert.equal(held[0]?.name, 'Ada, Countess of Lovelace');
    assert.equal(held[0]?.followedAt, '2026-09-01T10:00:00.000Z');
    assert.equal(site.admin.countFollowers(), 1);
  });

  it('keeps the followers in the order they arrived', async () => {
    const site = await records();

    await addFollower(site, ada());
    await addFollower(
      site,
      ada({ actorId: 'https://remote.example/users/bob', handle: '@bob@remote.example' }),
    );

    assert.deepEqual(
      readFollowers(site.contentDir).map((follower) => follower.handle),
      ['@ada@remote.example', '@bob@remote.example'],
    );
  });

  it('loses an entry to an unfollow, and the index with it', async () => {
    const site = await records();
    await addFollower(site, ada());

    const forgotten = await removeFollower(site, ADA);

    assert.equal(forgotten, true);
    assert.deepEqual(readFollowers(site.contentDir), []);
    assert.equal(site.admin.countFollowers(), 0);
    // Emptied rather than removed: an empty list is still what the file is for,
    // and an Eleventy build reads it either way.
    assert.deepEqual(JSON.parse(await readFile(followersFile(site.contentDir), 'utf8')), []);
  });

  it('says nothing was forgotten when the actor never followed', async () => {
    const site = await records();
    await addFollower(site, ada());

    assert.equal(await removeFollower(site, 'https://remote.example/users/nobody'), false);
    assert.equal(readFollowers(site.contentDir).length, 1);
  });

  it('is an empty list on a site nobody has followed yet', async () => {
    const site = await records();

    assert.deepEqual(readFollowers(site.contentDir), []);
  });

  it('leaves valid JSON after every step of a burst of follows and unfollows', async () => {
    const site = await records();

    await Promise.all([
      addFollower(site, ada({ actorId: `${ADA}-1` })),
      addFollower(site, ada({ actorId: `${ADA}-2` })),
      addFollower(site, ada({ actorId: `${ADA}-3` })),
      removeFollower(site, `${ADA}-1`),
      addFollower(site, ada({ actorId: `${ADA}-4` })),
    ]);

    const held = readFollowers(site.contentDir);
    // Whichever order they landed in, the file and the index say the same
    // thing, because the index write is inside the same lock as the file.
    assert.deepEqual(
      held.map((follower) => follower.actorId).sort(),
      site.admin
        .listFollowers()
        .map((follower) => follower.actorId)
        .sort(),
    );
    assert.ok(held.length >= 3, `only ${String(held.length)} followers survived`);
  });

  it('is a named error when it will not parse, rather than a site with no followers', async () => {
    const site = await records();
    await addFollower(site, ada());
    await writeFile(followersFile(site.contentDir), '[{"actorId": "https://rem', 'utf8');

    assert.throws(() => readFollowers(site.contentDir), /followers\.json/);
  });

  it('is a named error when an entry the site could never deliver to is edited in', async () => {
    const site = await records();
    await mkdir(path.dirname(followersFile(site.contentDir)), { recursive: true });
    await writeFile(
      followersFile(site.contentDir),
      JSON.stringify([{ actorId: ADA, handle: '@ada@remote.example' }]),
      'utf8',
    );

    // No inbox is no follower: delivering to it is the only thing a follower
    // is for, and a silent drop would leave the file and the index disagreeing
    // with nobody any the wiser.
    assert.throws(() => readFollowers(site.contentDir), /followers\.json/);
  });
});

/** One Like, as a peer's server would compact it before delivering it. */
function likeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: 'https://remote.example/likes/1',
    type: 'Like',
    actor: ADA,
    object: 'https://blog.example/ap/posts/hello',
    ...overrides,
  });
}

/** One reply: a `Create` of a `Note` that answers a post of this site's. */
function replyJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: 'https://remote.example/creates/1',
    type: 'Create',
    actor: ADA,
    object: {
      id: 'https://remote.example/notes/1',
      type: 'Note',
      content: '<p>Good post.</p>',
      inReplyTo: 'https://blog.example/ap/posts/hello',
    },
    ...overrides,
  });
}

describe('the inbox log', () => {
  it('appends the activity to the month it arrived in, one line of JSON', async () => {
    const site = await records();

    await appendInboxActivity(site, likeJson(), '2026-09-03T10:00:00.000Z');

    const file = inboxFile(site.contentDir, '2026-09-03T10:00:00.000Z');
    assert.equal(path.basename(file), '2026-09.jsonl');
    assert.equal(
      path.relative(site.contentDir, path.dirname(file)),
      path.join('_data', 'federation', 'inbox'),
    );

    const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line !== '');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0] as string), {
      receivedAt: '2026-09-03T10:00:00.000Z',
      ...(JSON.parse(likeJson()) as Record<string, unknown>),
    });
  });

  it('files an activity by the month it arrived in, not the month before it', async () => {
    const site = await records();

    await appendInboxActivity(site, likeJson(), '2026-10-01T00:00:00.000Z');
    await appendInboxActivity(
      site,
      likeJson({ id: 'https://remote.example/likes/2' }),
      '2026-11-30T23:59:59.000Z',
    );

    assert.deepEqual(
      (await readdir(path.join(site.contentDir, '_data', 'federation', 'inbox'))).sort(),
      ['2026-10.jsonl', '2026-11.jsonl'],
    );
  });

  it('indexes it in the same step, deriving every column from the activity', async () => {
    const site = await records();

    const logged = await appendInboxActivity(site, likeJson(), '2026-09-03T10:00:00.000Z');

    assert.equal(logged?.activityId, 'https://remote.example/likes/1');
    assert.equal(logged?.activityType, 'Like');
    assert.equal(logged?.actorId, ADA);
    assert.equal(logged?.objectId, 'https://blog.example/ap/posts/hello');
    assert.equal(logged?.receivedAt, '2026-09-03T10:00:00.000Z');
    assert.equal(logged?.inReplyTo, null);
    // The index keeps the activity as it arrived; `receivedAt` is the log's
    // word, not the peer's, so it is on the line and not in the JSON.
    assert.equal(logged?.json, likeJson());
    assert.equal(site.admin.countInboxActivities(), 1);
  });

  it('indexes a reply by what it answers', async () => {
    const site = await records();

    const logged = await appendInboxActivity(site, replyJson(), '2026-09-03T10:00:00.000Z');

    assert.equal(logged?.inReplyTo, 'https://blog.example/ap/posts/hello');
    assert.equal(site.admin.countRepliesTo('https://blog.example/ap/posts/hello'), 1);
  });

  it('replaces the line a redelivered activity already has, rather than logging it twice', async () => {
    const site = await records();
    await appendInboxActivity(site, likeJson(), '2026-09-03T10:00:00.000Z');

    await appendInboxActivity(
      site,
      likeJson({ object: 'https://blog.example/ap/posts/second' }),
      '2026-09-04T10:00:00.000Z',
    );

    const held = readInboxLog(site.contentDir);
    assert.equal(held.length, 1);
    assert.equal(held[0]?.receivedAt, '2026-09-04T10:00:00.000Z');
    assert.equal(site.admin.countInboxActivities(), 1);
  });

  it('drops an activity with no actor without writing anything', async () => {
    const site = await records();

    const logged = await appendInboxActivity(
      site,
      JSON.stringify({ id: 'https://remote.example/likes/9', type: 'Like' }),
      '2026-09-03T10:00:00.000Z',
    );

    assert.equal(logged, undefined);
    assert.deepEqual(readInboxLog(site.contentDir), []);
    assert.equal(site.admin.countInboxActivities(), 0);
  });

  it('reads the months back in order, oldest first', async () => {
    const site = await records();

    await appendInboxActivity(
      site,
      likeJson({ id: 'https://remote.example/likes/late' }),
      '2026-11-01T00:00:00.000Z',
    );
    await appendInboxActivity(
      site,
      likeJson({ id: 'https://remote.example/likes/early' }),
      '2026-09-01T00:00:00.000Z',
    );

    assert.deepEqual(
      readInboxLog(site.contentDir).map((line) => line.receivedAt),
      ['2026-09-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
    );
  });

  it('is an empty log on a site nobody has interacted with', async () => {
    const site = await records();

    assert.deepEqual(readInboxLog(site.contentDir), []);
  });

  it('is a named error when a line will not parse', async () => {
    const site = await records();
    await appendInboxActivity(site, likeJson(), '2026-09-03T10:00:00.000Z');
    await writeFile(
      inboxFile(site.contentDir, '2026-09-03T10:00:00.000Z'),
      '{"receivedAt":"2026-09-03T10:00:00.000Z","type":"Li\n',
      'utf8',
    );

    assert.throws(() => readInboxLog(site.contentDir), /2026-09\.jsonl/);
  });

  it('keeps every line whole through a burst of arrivals', async () => {
    const site = await records();

    await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        appendInboxActivity(
          site,
          likeJson({ id: `https://remote.example/likes/${String(index)}` }),
          '2026-09-03T10:00:00.000Z',
        ),
      ),
    );

    assert.equal(readInboxLog(site.contentDir).length, 12);
    assert.equal(site.admin.countInboxActivities(), 12);
  });
});

describe('rebuilding the indexes from the files', () => {
  it('puts the followers and the log into an empty database, and says what it indexed', async () => {
    const site = await records();
    await addFollower(site, ada({ followedAt: '2026-09-01T10:00:00.000Z' }));
    await appendInboxActivity(site, likeJson(), '2026-09-03T10:00:00.000Z');
    await appendInboxActivity(site, replyJson(), '2026-09-04T10:00:00.000Z');
    const before = {
      followers: site.admin.listFollowers(),
      inbox: site.admin.listInboxActivities(),
    };

    // What a deleted database is: the files as they stand, and an index with
    // nothing in it.
    const empty = openAdminStore({ dataDir: await temporaryDir() });
    openStores.push(empty);
    const report = rebuildFederationIndexes({ admin: empty, contentDir: site.contentDir });

    assert.deepEqual(report, { followers: 1, activities: 2 });
    assert.deepEqual(empty.listFollowers(), before.followers);
    assert.deepEqual(empty.listInboxActivities(), before.inbox);
  });

  it('is what the files say and nothing else: a row they do not carry goes', async () => {
    const site = await records();
    await addFollower(site, ada());
    site.admin.putFollower({
      actorId: 'https://remote.example/users/ghost',
      inboxId: 'https://remote.example/users/ghost/inbox',
      sharedInboxId: null,
      handle: null,
      name: null,
      iconUrl: null,
      url: null,
    });
    assert.equal(site.admin.countFollowers(), 2);

    rebuildFederationIndexes(site);

    assert.deepEqual(
      site.admin.listFollowers().map((follower) => follower.actorId),
      [ADA],
    );
  });

  it('gives the log the same row ids every time, so a rebuild is not a reshuffle', async () => {
    const site = await records();
    await appendInboxActivity(site, likeJson(), '2026-09-03T10:00:00.000Z');
    await appendInboxActivity(site, replyJson(), '2026-09-04T10:00:00.000Z');
    const first = site.admin.listInboxActivities();

    rebuildFederationIndexes(site);
    rebuildFederationIndexes(site);

    assert.deepEqual(site.admin.listInboxActivities(), first);
  });

  it('reflects an edit made to followers.json by hand', async () => {
    const site = await records();
    await addFollower(site, ada());
    const held = readFollowers(site.contentDir);
    await writeFile(
      followersFile(site.contentDir),
      JSON.stringify([
        ...held,
        {
          actorId: 'https://remote.example/users/grace',
          inboxId: 'https://remote.example/users/grace/inbox',
          handle: '@grace@remote.example',
          followedAt: '2026-09-02T10:00:00.000Z',
        },
      ]),
      'utf8',
    );

    rebuildFederationIndexes(site);

    assert.equal(site.admin.countFollowers(), 2);
    assert.equal(
      site.admin.getFollower('https://remote.example/users/grace')?.handle,
      '@grace@remote.example',
    );
  });

  it('throws over a file it cannot read rather than emptying the index', async () => {
    const site = await records();
    await addFollower(site, ada());
    await writeFile(followersFile(site.contentDir), 'not json at all', 'utf8');

    assert.throws(() => rebuildFederationIndexes(site), /followers\.json/);
    assert.equal(site.admin.countFollowers(), 1, 'the index was emptied before the read failed');
  });
});

describe('an older database, whose rows the files do not have yet', () => {
  it('has its followers and its log written out once, and reads back the same', async () => {
    const site = await records();
    site.admin.putFollower({ ...ada(), followedAt: '2026-09-01T10:00:00.000Z' });
    site.admin.logInboxActivity({
      activityId: 'https://remote.example/likes/1',
      activityType: 'Like',
      actorId: ADA,
      objectId: 'https://blog.example/ap/posts/hello',
      receivedAt: '2026-09-03T10:00:00.000Z',
      json: likeJson(),
    });
    const before = {
      followers: site.admin.listFollowers(),
      inbox: site.admin.listInboxActivities(),
    };

    migrateFederationToFiles(site);
    rebuildFederationIndexes(site);

    assert.deepEqual(readFollowers(site.contentDir), before.followers);
    assert.deepEqual(site.admin.listFollowers(), before.followers);
    assert.deepEqual(site.admin.listInboxActivities(), before.inbox);
    assert.equal(
      path.basename(inboxFile(site.contentDir, '2026-09-03T10:00:00.000Z')),
      '2026-09.jsonl',
    );
  });

  it('leaves the files alone when they are already there, because the file wins', async () => {
    const site = await records();
    await addFollower(site, ada());
    site.admin.putFollower({
      actorId: 'https://remote.example/users/ghost',
      inboxId: 'https://remote.example/users/ghost/inbox',
      sharedInboxId: null,
      handle: null,
      name: null,
      iconUrl: null,
      url: null,
    });

    migrateFederationToFiles(site);

    assert.deepEqual(
      readFollowers(site.contentDir).map((follower) => follower.actorId),
      [ADA],
    );
  });

  it('writes nothing at all for a site that has never been federated', async () => {
    const site = await records();

    migrateFederationToFiles(site);

    assert.deepEqual(readFollowers(site.contentDir), []);
    assert.equal(readFileIfPresentSync(followersFile(site.contentDir)), undefined);
  });
});

/** The site under test in the boot tests. Fedify answers by origin. */
const BASE_URL = 'https://blog.example';
const FOLLOWERS_URL = `${BASE_URL}/ap/actor/followers`;

const booted: Cms[] = [];
after(async () => {
  for (const instance of booted) await instance.close();
});

/** A federated site over one pair of directories, booted from what they hold. */
async function boot(dirs: { contentDir: string; dataDir: string }): Promise<Cms> {
  const instance = createCms({
    ...dirs,
    watch: false,
    baseUrl: BASE_URL,
    federation: { queue: null, allowPrivateAddress: true },
  });
  booted.push(instance);
  return await Promise.resolve(instance);
}

/** A content and data directory with the settings a federated site needs. */
async function federatedDirs(): Promise<{ contentDir: string; dataDir: string }> {
  const contentDir = await temporaryDir();
  const dataDir = await temporaryDir();
  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'Geekity',
      baseUrl: BASE_URL,
      timezone: 'UTC',
      actorHandle: 'blog',
      actorType: 'Person',
    },
  });
  return { contentDir, dataDir };
}

/** The followers collection and its first page, as a peer would read them. */
async function followersCollection(instance: Cms): Promise<unknown[]> {
  const headers = { accept: 'application/activity+json' };
  const collection = await instance.app.request(FOLLOWERS_URL, { headers });
  const page = await instance.app.request(`${FOLLOWERS_URL}?cursor=0`, { headers });
  assert.equal(collection.status, 200);
  assert.equal(page.status, 200);
  return [await collection.json(), await page.json()];
}

/** The federation screen, with the one thing on it that is per-session taken out. */
async function federationScreen(agent: Browser): Promise<string> {
  const response = await agent.get('/admin/federation');
  assert.equal(response.status, 200);
  return (await response.text()).replaceAll(
    /name="csrf_token" value="[^"]*"/g,
    'name="csrf_token"',
  );
}

/** Throw the database away, the way decision-9 says a site is free to. */
async function deleteDatabase(dataDir: string): Promise<void> {
  for (const suffix of ['', '-wal', '-shm']) {
    await rm(path.join(dataDir, `geekity.db${suffix}`), { force: true });
  }
}

describe('a site whose database is thrown away', () => {
  it('serves the same followers collection, screen and fan-out from the files alone', async () => {
    const dirs = await federatedDirs();
    const first = await boot(dirs);
    const site = { admin: first.admin, contentDir: dirs.contentDir };

    await addFollower(site, ada({ followedAt: '2026-09-01T10:00:00.000Z' }));
    await addFollower(
      site,
      ada({
        actorId: 'https://remote.example/users/grace',
        inboxId: 'https://remote.example/users/grace/inbox',
        sharedInboxId: null,
        handle: '@grace@remote.example',
        name: 'Grace Hopper',
        followedAt: '2026-09-02T10:00:00.000Z',
      }),
    );
    await appendInboxActivity(site, likeJson(), '2026-09-03T10:00:00.000Z');
    await appendInboxActivity(site, replyJson(), '2026-09-04T10:00:00.000Z');

    const before = {
      collection: await followersCollection(first),
      targets: deliveryTargets(first.admin),
      screen: await federationScreen(await signedIn(first)),
    };

    // The comparison below is only worth making over a screen and a collection
    // that had something on them.
    assert.match(JSON.stringify(before.collection), /users\/grace/);
    assert.equal(before.targets.length, 2, 'two inboxes to fan out to');
    assert.match(before.screen, /liked/);
    assert.match(before.screen, /replied to/);
    assert.match(before.screen, /Grace Hopper/);

    await first.close();
    await deleteDatabase(dirs.dataDir);
    const second = await boot(dirs);

    assert.deepEqual(await followersCollection(second), before.collection);
    assert.deepEqual(deliveryTargets(second.admin), before.targets);
    assert.equal(await federationScreen(await signIn(second)), before.screen);
  });
});

describe('a site whose files the database is ahead of', () => {
  it('has its rows written out on the first boot, and the collection does not move', async () => {
    const dirs = await federatedDirs();
    const first = await boot(dirs);

    // Straight into the index, the way the version before this one stored
    // them: no file is written, so the next boot is the migrating one.
    first.admin.putFollower({ ...ada(), followedAt: '2026-09-01T10:00:00.000Z' });
    first.admin.logInboxActivity({
      activityId: 'https://remote.example/likes/1',
      activityType: 'Like',
      actorId: ADA,
      objectId: 'https://blog.example/ap/posts/hello',
      receivedAt: '2026-09-03T10:00:00.000Z',
      json: likeJson(),
    });
    const before = await followersCollection(first);
    assert.equal(readFileIfPresentSync(followersFile(dirs.contentDir)), undefined);

    await first.close();
    const second = await boot(dirs);

    assert.deepEqual(await followersCollection(second), before);
    assert.deepEqual(
      readFollowers(dirs.contentDir).map((follower) => follower.actorId),
      [ADA],
    );
    assert.deepEqual(
      readInboxLog(dirs.contentDir).map((line) => line.receivedAt),
      ['2026-09-03T10:00:00.000Z'],
    );
  });
});

describe('followers.json edited by hand', () => {
  it('is what the collection says after a restart', async () => {
    const dirs = await federatedDirs();
    const first = await boot(dirs);
    await addFollower({ admin: first.admin, contentDir: dirs.contentDir }, ada());
    await first.close();

    await writeFile(
      followersFile(dirs.contentDir),
      JSON.stringify([
        {
          actorId: 'https://remote.example/users/grace',
          inboxId: 'https://remote.example/users/grace/inbox',
          handle: '@grace@remote.example',
          followedAt: '2026-09-02T10:00:00.000Z',
        },
      ]),
      'utf8',
    );
    const second = await boot(dirs);

    assert.deepEqual(
      second.admin.listFollowers().map((follower) => follower.actorId),
      ['https://remote.example/users/grace'],
    );
    const [, page] = await followersCollection(second);
    assert.match(JSON.stringify(page), /users\/grace/);
    assert.doesNotMatch(JSON.stringify(page), /users\/ada/);
  });
});
