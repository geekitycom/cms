import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { openAdminStore } from './store.ts';
import type { AdminStore, NewDelivery, NewFollower, NewInboxActivity, NewRelay } from './store.ts';

const temporaryDirs: string[] = [];
const openStores: AdminStore[] = [];

after(async () => {
  for (const opened of openStores) opened.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A data directory that goes away when the file finishes. */
async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-admin-'));
  temporaryDirs.push(dir);
  return dir;
}

/** An admin store on a data dir of its own, closed when the file finishes. */
async function store(): Promise<AdminStore> {
  const dir = await temporaryDir();
  const opened = openAdminStore({ dataDir: dir });
  openStores.push(opened);
  return opened;
}

const HOUR = 3600;

/**
 * The user ids the session tests use. They are bare numbers because there is
 * no users table for them to point into any more: the accounts are in
 * `data/users.json` (decision-9), and the sessions are a cache that names one
 * by id. Whether a session's user still exists is the admin guard's question,
 * not the store's.
 */
const ADA = 1;
const GRACE = 2;

describe('sessions', () => {
  it('hands back an unguessable id and a CSRF token of its own', async () => {
    const admin = await store();

    const session = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });

    // 256 bits, hex encoded.
    assert.match(session.id, /^[0-9a-f]{64}$/);
    assert.match(session.csrfToken, /^[0-9a-f]{64}$/);
    assert.notEqual(session.id, session.csrfToken);
    assert.equal(session.userId, ADA);

    const second = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });
    assert.notEqual(second.id, session.id, 'two sessions never share an id');
  });

  it('reads a live session back and drops one that is gone', async () => {
    const admin = await store();
    const session = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });

    const read = admin.getSession(session.id);
    assert.equal(read?.userId, ADA);
    assert.equal(read?.csrfToken, session.csrfToken);

    assert.equal(admin.deleteSession(session.id), true, 'the row was there to delete');
    assert.equal(admin.getSession(session.id), undefined, 'logout invalidates it server-side');
    assert.equal(admin.deleteSession(session.id), false, 'deleting twice is a no-op');
  });

  it('treats an expired session as absent and prunes the row', async () => {
    const admin = await store();

    const now = new Date('2026-09-02T12:00:00Z');
    const session = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR, now });
    assert.equal(session.expiresAt, '2026-09-02T13:00:00.000Z');

    const stillGood = new Date('2026-09-02T12:59:59Z');
    assert.equal(admin.getSession(session.id, stillGood)?.id, session.id);

    const past = new Date('2026-09-02T13:00:01Z');
    assert.equal(admin.getSession(session.id, past), undefined, 'an expired session is absent');
    assert.equal(
      admin.getSession(session.id, stillGood),
      undefined,
      'and the row itself was pruned, so a clock that goes backwards cannot revive it',
    );
  });

  it('sweeps every expired session at once', async () => {
    const admin = await store();
    const now = new Date('2026-09-02T12:00:00Z');

    const short = admin.createSession({ userId: ADA, lifetimeSeconds: 60, now });
    const long = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR, now });

    const later = new Date('2026-09-02T12:30:00Z');
    assert.equal(admin.pruneSessions(later), 1);
    assert.equal(admin.getSession(short.id, later), undefined);
    assert.equal(admin.getSession(long.id, later)?.id, long.id);
  });

  it('keeps an anonymous session, which is what carries the CSRF token before login', async () => {
    const admin = await store();

    const session = admin.createSession({ userId: null, lifetimeSeconds: HOUR });

    assert.equal(session.userId, null);
    assert.equal(admin.getSession(session.id)?.userId, null);
  });

  it('drops every session a user has but the one that is asking', async () => {
    const admin = await store();
    const keep = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });
    const elsewhere = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });
    const somebodyElse = admin.createSession({ userId: GRACE, lifetimeSeconds: HOUR });

    assert.equal(admin.deleteSessionsForUser(ADA, { except: keep.id }), 1);

    assert.ok(admin.getSession(keep.id) !== undefined, 'the asking session is still live');
    assert.equal(admin.getSession(elsewhere.id), undefined);
    assert.ok(
      admin.getSession(somebodyElse.id) !== undefined,
      "another user's session is not touched",
    );
  });

  it('drops every session a user has when nothing is spared', async () => {
    const admin = await store();
    const one = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });
    const two = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });

    assert.equal(admin.deleteSessionsForUser(ADA), 2);

    assert.equal(admin.getSession(one.id), undefined);
    assert.equal(admin.getSession(two.id), undefined);
  });

  it('is kept for a user the database knows nothing about, since it is only a cache', async () => {
    const admin = await store();

    // There is no users table to reference, so this must not fail the way an
    // insert against the old foreign key would have. A session whose user is
    // not in `data/users.json` is refused by the admin guard instead.
    const session = admin.createSession({ userId: 12345, lifetimeSeconds: HOUR });

    assert.equal(admin.getSession(session.id)?.userId, 12345);
  });
});

describe('password reset tokens (AC #3)', () => {
  it('hands back a token nobody could guess and stores only its hash', async () => {
    const admin = await store();

    const reset = admin.createPasswordReset({ userId: ADA, lifetimeSeconds: HOUR });

    // 256 bits, hex encoded, exactly as a session id is.
    assert.match(reset.token, /^[0-9a-f]{64}$/);
    assert.equal(admin.getPasswordReset(reset.token)?.userId, ADA);

    // The database never holds anything a link could be rebuilt from.
    const db = new DatabaseSync(admin.file);
    try {
      const rows = db.prepare('SELECT * FROM password_resets').all();
      assert.equal(rows.length, 1);
      assert.equal(
        JSON.stringify(rows[0]).includes(reset.token),
        false,
        'the token itself reached the database',
      );
    } finally {
      db.close();
    }
  });

  it('is good once: using it takes it away', async () => {
    const admin = await store();
    const reset = admin.createPasswordReset({ userId: ADA, lifetimeSeconds: HOUR });

    assert.equal(admin.deletePasswordReset(reset.token), true);
    assert.equal(admin.getPasswordReset(reset.token), undefined);
    assert.equal(admin.deletePasswordReset(reset.token), false);
  });

  it('stops being valid an hour out, and the row goes with it', async () => {
    const admin = await store();
    const now = new Date('2026-09-04T12:00:00Z');

    const reset = admin.createPasswordReset({ userId: ADA, lifetimeSeconds: HOUR, now });
    assert.equal(reset.expiresAt, '2026-09-04T13:00:00.000Z');

    const stillGood = new Date('2026-09-04T12:59:59Z');
    assert.equal(admin.getPasswordReset(reset.token, stillGood)?.userId, ADA);

    const past = new Date('2026-09-04T13:00:01Z');
    assert.equal(admin.getPasswordReset(reset.token, past), undefined);
    assert.equal(
      admin.getPasswordReset(reset.token, stillGood),
      undefined,
      'the row was pruned, so a clock that goes backwards cannot revive it',
    );
  });

  it('drops every token a user has, which is what a finished reset does', async () => {
    const admin = await store();
    const one = admin.createPasswordReset({ userId: ADA, lifetimeSeconds: HOUR });
    const two = admin.createPasswordReset({ userId: ADA, lifetimeSeconds: HOUR });
    const hers = admin.createPasswordReset({ userId: GRACE, lifetimeSeconds: HOUR });

    assert.equal(admin.deletePasswordResetsForUser(ADA), 2);

    assert.equal(admin.getPasswordReset(one.token), undefined);
    assert.equal(admin.getPasswordReset(two.token), undefined);
    assert.equal(admin.getPasswordReset(hers.token)?.userId, GRACE);
  });

  it('sweeps every expired token at once', async () => {
    const admin = await store();
    const now = new Date('2026-09-04T12:00:00Z');

    const short = admin.createPasswordReset({ userId: ADA, lifetimeSeconds: 60, now });
    const long = admin.createPasswordReset({ userId: ADA, lifetimeSeconds: HOUR, now });

    const later = new Date('2026-09-04T12:30:00Z');
    assert.equal(admin.prunePasswordResets(later), 1);
    assert.equal(admin.getPasswordReset(short.token, later), undefined);
    assert.equal(admin.getPasswordReset(long.token, later)?.userId, ADA);
  });
});

describe('spent one-click tokens (TASK-55)', () => {
  it('lets a token be spent once and refuses it after that', async () => {
    const admin = await store();
    const expires = new Date('2026-09-11T12:00:00Z').toISOString();

    assert.equal(admin.spendToken('a-signed-token', expires), true);
    assert.equal(admin.spendToken('a-signed-token', expires), false);
  });

  it('keeps one token clear of another', async () => {
    const admin = await store();
    const expires = new Date('2026-09-11T12:00:00Z').toISOString();

    assert.equal(admin.spendToken('approve-this', expires), true);

    assert.equal(admin.spendToken('delete-this', expires), true);
  });

  it('sweeps the tokens that could not be used again anyway', async () => {
    const admin = await store();
    const now = new Date('2026-09-04T12:00:00Z');

    admin.spendToken('short', new Date(now.getTime() + 60_000).toISOString());
    admin.spendToken('long', new Date(now.getTime() + 3_600_000).toISOString());

    const later = new Date(now.getTime() + 1_800_000);
    assert.equal(admin.pruneSpentTokens(later), 1);
    // The swept one is spendable again, which costs nothing: the action it
    // names has already happened and doing it twice is doing it once.
    assert.equal(admin.spendToken('short', new Date(later.getTime() + 60_000).toISOString()), true);
    assert.equal(admin.spendToken('long', new Date(later.getTime() + 60_000).toISOString()), false);
  });
});

describe('flash messages', () => {
  it('hands a queued message back once and then forgets it', async () => {
    const admin = await store();
    const session = admin.createSession({ userId: null, lifetimeSeconds: HOUR });

    admin.pushFlash(session.id, { kind: 'notice', message: 'Draft saved.' });

    assert.deepEqual(admin.takeFlash(session.id), [{ kind: 'notice', message: 'Draft saved.' }]);
    assert.deepEqual(admin.takeFlash(session.id), [], 'reading a flash clears it');
  });

  it('keeps queued messages in the order they were added', async () => {
    const admin = await store();
    const session = admin.createSession({ userId: null, lifetimeSeconds: HOUR });

    admin.pushFlash(session.id, { kind: 'notice', message: 'first' });
    admin.pushFlash(session.id, { kind: 'error', message: 'second' });

    assert.deepEqual(admin.takeFlash(session.id), [
      { kind: 'notice', message: 'first' },
      { kind: 'error', message: 'second' },
    ]);
  });

  it('says nothing about a session that does not exist', async () => {
    const admin = await store();

    admin.pushFlash('nonexistent', { kind: 'notice', message: 'lost' });
    assert.deepEqual(admin.takeFlash('nonexistent'), []);
  });
});

describe('the settings table an older version wrote', () => {
  it('is readable once and then droppable, and is not there on a second boot', async () => {
    const dataDir = await temporaryDir();
    const database = new DatabaseSync(path.join(dataDir, 'geekity.db'));
    // Migration 3 as it shipped, with the ledger row that stops it running
    // again, which is the schema every upgrading site opens with.
    database.exec(`
      CREATE TABLE admin_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO admin_migrations (version, applied_at) VALUES (3, '2026-09-01T00:00:00.000Z');
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO settings (key, value, updated_at)
      VALUES ('title', 'From the rows', '2026-09-01T00:00:00.000Z');
    `);
    database.close();

    const admin = openAdminStore({ dataDir });
    assert.deepEqual(admin.legacySettings(), [
      { key: 'title', value: 'From the rows', updatedAt: '2026-09-01T00:00:00.000Z' },
    ]);

    admin.dropLegacyTable('settings');
    assert.equal(admin.legacySettings(), undefined, 'the table is gone');
    admin.dropLegacyTable('settings');
    admin.close();

    const reopened = openAdminStore({ dataDir });
    assert.equal(reopened.legacySettings(), undefined, 'and stays gone across a boot');
    reopened.close();
  });

  it('is dropped on a database this version created, where it was never used', async () => {
    const admin = await store();
    assert.deepEqual(admin.legacySettings(), [], 'migration 3 still creates it, empty');

    admin.dropLegacyTable('settings');
    assert.equal(admin.legacySettings(), undefined);
  });
});

describe('the actor key table an older version wrote', () => {
  it('reads its rows out and then goes, for good', async () => {
    const dataDir = await temporaryDir();
    const database = new DatabaseSync(path.join(dataDir, 'geekity.db'));

    // Exactly migration 4, with the ledger rows that stop the migrations this
    // version ships from running, so the store under test opens the schema a
    // site upgrading from TASK-16 actually has.
    database.exec(`
      CREATE TABLE admin_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO admin_migrations (version, applied_at) VALUES (4, '2026-09-01T00:00:00.000Z');
      CREATE TABLE actor_keys (
        identifier  TEXT NOT NULL,
        algorithm   TEXT NOT NULL,
        private_jwk TEXT NOT NULL,
        public_jwk  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (identifier, algorithm)
      );
      INSERT INTO actor_keys (identifier, algorithm, private_jwk, public_jwk, created_at)
      VALUES ('actor', 'Ed25519', '{"d":"private"}', '{"x":"public"}', '2026-09-01T00:00:00.000Z');
    `);
    database.close();

    const admin = openAdminStore({ dataDir });
    assert.deepEqual(admin.legacyActorKeys(), [
      { identifier: 'actor', algorithm: 'Ed25519', privateJwk: '{"d":"private"}' },
    ]);

    admin.dropLegacyTable('actor_keys');
    assert.equal(admin.legacyActorKeys(), undefined, 'the table is gone');
    admin.dropLegacyTable('actor_keys');
    admin.close();

    const reopened = openAdminStore({ dataDir });
    assert.equal(reopened.legacyActorKeys(), undefined, 'and stays gone across a boot');
    reopened.close();
  });

  it('is dropped on a database this version created, where it was never used', async () => {
    const admin = await store();
    assert.deepEqual(admin.legacyActorKeys(), [], 'migration 4 still creates it, empty');

    admin.dropLegacyTable('actor_keys');
    assert.equal(admin.legacyActorKeys(), undefined);
  });
});

describe('the users table an older version wrote', () => {
  it('reads its rows out, ids and hashes and all, and then goes for good', async () => {
    const dataDir = await temporaryDir();
    const database = new DatabaseSync(path.join(dataDir, 'geekity.db'));

    // Exactly migration 1, with the ledger row that stops the migrations this
    // version ships from running, so the store under test opens the schema a
    // site upgrading from TASK-9 actually has.
    database.exec(`
      CREATE TABLE admin_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO admin_migrations (version, applied_at) VALUES (1, '2026-09-01T00:00:00.000Z');
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id         TEXT PRIMARY KEY,
        user_id    INTEGER REFERENCES users (id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      INSERT INTO users (id, username, password_hash, created_at)
      VALUES (7, 'ada', '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', '2026-09-01T00:00:00.000Z');
    `);
    database.close();

    const admin = openAdminStore({ dataDir });
    assert.deepEqual(admin.legacyUsers(), [
      {
        id: 7,
        username: 'ada',
        passwordHash: '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);

    admin.dropLegacyTable('users');
    assert.equal(admin.legacyUsers(), undefined, 'the table is gone');
    admin.dropLegacyTable('users');
    admin.close();

    const reopened = openAdminStore({ dataDir });
    assert.equal(reopened.legacyUsers(), undefined, 'and stays gone across a boot');
    reopened.close();
  });

  it('is dropped on a database this version created, where it was never used', async () => {
    const admin = await store();
    assert.deepEqual(admin.legacyUsers(), [], 'migration 1 still creates it, empty');

    admin.dropLegacyTable('users');
    assert.equal(admin.legacyUsers(), undefined);
  });

  it('does not take the sessions with it, because they no longer reference it', async () => {
    const admin = await store();
    const session = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });

    admin.dropLegacyTable('users');

    assert.equal(admin.getSession(session.id)?.userId, ADA, 'the login survived the drop');
    const after = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });
    assert.equal(admin.getSession(after.id)?.userId, ADA, 'and another can still be made');
  });
});

describe('followers', () => {
  /** The user every follower here follows: decision-14 makes followers a user's. */
  const BLOG = 'blog';

  /** A follower with every optional column filled, so nothing is left untested. */
  function ada(overrides: Partial<NewFollower> = {}): NewFollower {
    return {
      username: BLOG,
      actorId: 'https://remote.example/users/ada',
      inboxId: 'https://remote.example/users/ada/inbox',
      sharedInboxId: 'https://remote.example/inbox',
      handle: '@ada@remote.example',
      name: 'Ada Lovelace',
      iconUrl: 'https://remote.example/avatars/ada.png',
      url: 'https://remote.example/@ada',
      ...overrides,
    };
  }

  it('starts empty, which is what a site that has never federated looks like', async () => {
    const admin = await store();

    assert.equal(admin.countFollowers(), 0);
    assert.deepEqual(admin.listFollowers(), []);
  });

  it('stores a follower and reads it back whole', async () => {
    const admin = await store();

    const stored = admin.putFollower(ada());

    assert.equal(stored.actorId, 'https://remote.example/users/ada');
    assert.equal(stored.inboxId, 'https://remote.example/users/ada/inbox');
    assert.equal(stored.sharedInboxId, 'https://remote.example/inbox');
    assert.equal(stored.handle, '@ada@remote.example');
    assert.equal(stored.name, 'Ada Lovelace');
    assert.equal(stored.iconUrl, 'https://remote.example/avatars/ada.png');
    assert.equal(stored.url, 'https://remote.example/@ada');
    assert.ok(stored.followedAt !== '', 'the row records when the follow arrived');
    assert.deepEqual(admin.getFollower(BLOG, 'https://remote.example/users/ada'), stored);
    assert.equal(admin.countFollowers(), 1);
  });

  it('keeps the columns a bare actor has nothing for', async () => {
    const admin = await store();

    const stored = admin.putFollower({
      username: BLOG,
      actorId: 'https://remote.example/users/bare',
      inboxId: 'https://remote.example/users/bare/inbox',
      sharedInboxId: null,
      handle: null,
      name: null,
      iconUrl: null,
      url: null,
    });

    assert.equal(stored.sharedInboxId, null);
    assert.equal(stored.name, null);
  });

  it('is idempotent: a second Follow updates the row rather than adding one', async () => {
    const admin = await store();
    const first = admin.putFollower(ada());

    const second = admin.putFollower(ada({ name: 'Ada, renamed' }));

    assert.equal(admin.countFollowers(), 1);
    assert.equal(second.name, 'Ada, renamed');
    // The follow began when it began; a repeat delivery is not a new follow.
    assert.equal(second.followedAt, first.followedAt);
  });

  it('lists followers newest first, and pages with a limit and an offset', async () => {
    const admin = await store();
    for (const index of [0, 1, 2]) {
      admin.putFollower(
        ada({
          actorId: `https://remote.example/users/${index}`,
          inboxId: `https://remote.example/users/${index}/inbox`,
          followedAt: `2026-09-0${index + 1}T00:00:00.000Z`,
        }),
      );
    }

    assert.equal(admin.countFollowers(), 3);
    assert.deepEqual(
      admin.listFollowers().map((follower) => follower.actorId),
      [
        'https://remote.example/users/2',
        'https://remote.example/users/1',
        'https://remote.example/users/0',
      ],
    );
    assert.deepEqual(
      admin.listFollowers(BLOG, { limit: 2, offset: 1 }).map((follower) => follower.actorId),
      ['https://remote.example/users/1', 'https://remote.example/users/0'],
    );
  });

  it('keeps one user’s followers apart from another’s (decision-14)', async () => {
    const admin = await store();
    // The same actor follows two of this site's people, which is two follows
    // and two rows: unfollowing one must not unfollow the other.
    admin.putFollower(ada());
    admin.putFollower(ada({ username: 'grace' }));

    assert.equal(admin.countFollowers(), 2, 'the site has two follows');
    assert.equal(admin.countFollowers(BLOG), 1, 'and one of them is this user’s');
    assert.deepEqual(
      admin.listFollowers('grace').map((follower) => follower.username),
      ['grace'],
    );

    assert.equal(admin.deleteFollower(BLOG, 'https://remote.example/users/ada'), true);
    assert.equal(admin.countFollowers('grace'), 1, 'the other follow stands');
  });

  it('deletes a follower, and says so when there was none to delete', async () => {
    const admin = await store();
    admin.putFollower(ada());

    assert.equal(admin.deleteFollower(BLOG, 'https://remote.example/users/ada'), true);
    assert.equal(admin.deleteFollower(BLOG, 'https://remote.example/users/ada'), false);
    assert.equal(admin.countFollowers(), 0);
    assert.equal(admin.getFollower(BLOG, 'https://remote.example/users/ada'), undefined);
  });
});

describe('the inbound activity log', () => {
  /** One logged activity, with the columns doc-4 asks the log to keep. */
  function like(overrides: Partial<NewInboxActivity> = {}): NewInboxActivity {
    return {
      activityId: 'https://remote.example/likes/1',
      activityType: 'Like',
      actorId: 'https://remote.example/users/ada',
      objectId: 'https://blog.example/2026/03/hello/',
      json: '{"type":"Like"}',
      ...overrides,
    };
  }

  it('starts empty', async () => {
    const admin = await store();

    assert.equal(admin.countInboxActivities(), 0);
    assert.deepEqual(admin.listInboxActivities(), []);
  });

  it('logs an activity with its actor, type, object and arrival time', async () => {
    const admin = await store();

    const logged = admin.logInboxActivity(like());

    assert.ok(logged.id > 0, 'the row got an id');
    assert.equal(logged.activityId, 'https://remote.example/likes/1');
    assert.equal(logged.activityType, 'Like');
    assert.equal(logged.actorId, 'https://remote.example/users/ada');
    assert.equal(logged.objectId, 'https://blog.example/2026/03/hello/');
    assert.equal(logged.json, '{"type":"Like"}');
    assert.ok(logged.receivedAt !== '', 'the row records when it arrived');
    assert.deepEqual(admin.listInboxActivities(), [logged]);
  });

  it('keeps one row per activity id, so a redelivery is not a second like', async () => {
    const admin = await store();
    admin.logInboxActivity(like());

    admin.logInboxActivity(like({ json: '{"type":"Like","again":true}' }));

    assert.equal(admin.countInboxActivities(), 1);
    assert.equal(admin.listInboxActivities()[0]?.json, '{"type":"Like","again":true}');
  });

  it('keeps every anonymous activity, because an id is what makes two the same', async () => {
    const admin = await store();

    admin.logInboxActivity(like({ activityId: null }));
    admin.logInboxActivity(like({ activityId: null }));

    assert.equal(admin.countInboxActivities(), 2);
  });

  it('lists newest first, and pages with a limit and an offset', async () => {
    const admin = await store();
    for (const index of [0, 1, 2]) {
      admin.logInboxActivity(like({ activityId: `https://remote.example/likes/${index}` }));
    }

    assert.deepEqual(
      admin.listInboxActivities().map((entry) => entry.activityId),
      [
        'https://remote.example/likes/2',
        'https://remote.example/likes/1',
        'https://remote.example/likes/0',
      ],
    );
    assert.deepEqual(
      admin.listInboxActivities({ limit: 1, offset: 2 }).map((entry) => entry.activityId),
      ['https://remote.example/likes/0'],
    );
  });
});

describe('the reply index', () => {
  const POST = 'https://blog.example/2026/03/hello/';

  /** A `Create` of a `Note` replying to a post, as the inbox compacts one. */
  function reply(
    overrides: Partial<NewInboxActivity> = {},
    note: Record<string, unknown> = {},
  ): NewInboxActivity {
    return {
      activityId: 'https://remote.example/creates/1',
      activityType: 'Create',
      actorId: 'https://remote.example/users/ada',
      objectId: 'https://remote.example/notes/1',
      json: JSON.stringify({
        id: 'https://remote.example/creates/1',
        type: 'Create',
        actor: 'https://remote.example/users/ada',
        object: {
          id: 'https://remote.example/notes/1',
          type: 'Note',
          content: '<p>Good post.</p>',
          inReplyTo: POST,
          ...note,
        },
      }),
      ...overrides,
    };
  }

  it('derives what a reply replies to from the activity it stored', async () => {
    const admin = await store();

    const logged = admin.logInboxActivity(reply());

    assert.equal(logged.inReplyTo, POST);
    assert.equal(admin.countRepliesTo(POST), 1);
    assert.deepEqual(admin.listRepliesTo(POST), [logged]);
  });

  it('reads an inReplyTo that arrived as a list, which JSON-LD allows', async () => {
    const admin = await store();

    const logged = admin.logInboxActivity(reply({}, { inReplyTo: [POST] }));

    assert.equal(logged.inReplyTo, POST);
  });

  it('counts a like or a boost as no reply at all', async () => {
    const admin = await store();

    const like = admin.logInboxActivity({
      activityId: 'https://remote.example/likes/1',
      activityType: 'Like',
      actorId: 'https://remote.example/users/ada',
      objectId: POST,
      json: JSON.stringify({ type: 'Like', object: POST }),
    });

    assert.equal(like.inReplyTo, null);
    assert.equal(admin.countRepliesTo(POST), 0);
    assert.equal(admin.countReplies(), 0);
  });

  it('keeps a top-level note out of the index: it answers nothing', async () => {
    const admin = await store();

    const logged = admin.logInboxActivity(reply({}, { inReplyTo: undefined }));

    assert.equal(logged.inReplyTo, null);
    assert.equal(admin.countReplies(), 0);
  });

  it('lists every reply newest first, and one post’s on its own', async () => {
    const admin = await store();
    const elsewhere = 'https://blog.example/ap/posts/other';
    for (const [index, target] of [POST, elsewhere, POST].entries()) {
      admin.logInboxActivity(
        reply(
          {
            activityId: `https://remote.example/creates/${String(index)}`,
            objectId: `https://remote.example/notes/${String(index)}`,
          },
          { inReplyTo: target },
        ),
      );
    }

    assert.equal(admin.countReplies(), 3);
    assert.deepEqual(
      admin.listReplies().map((entry) => entry.activityId),
      [
        'https://remote.example/creates/2',
        'https://remote.example/creates/1',
        'https://remote.example/creates/0',
      ],
    );
    assert.deepEqual(
      admin.listRepliesTo(POST).map((entry) => entry.activityId),
      ['https://remote.example/creates/2', 'https://remote.example/creates/0'],
    );
    assert.deepEqual(
      admin.listReplies({ limit: 1, offset: 1 }).map((entry) => entry.activityId),
      ['https://remote.example/creates/1'],
    );
    assert.equal(admin.countRepliesTo(POST), 2);
  });

  it('lists everything that names one of a set of objects, oldest first', async () => {
    const admin = await store();
    const note = 'https://remote.example/notes/1';

    const created = admin.logInboxActivity(reply());
    const liked = admin.logInboxActivity({
      activityId: 'https://remote.example/likes/1',
      activityType: 'Like',
      actorId: 'https://remote.example/users/bob',
      objectId: POST,
      json: JSON.stringify({ type: 'Like', object: POST }),
    });
    const deleted = admin.logInboxActivity({
      activityId: 'https://remote.example/deletes/1',
      activityType: 'Delete',
      actorId: 'https://remote.example/users/ada',
      objectId: note,
      json: JSON.stringify({ type: 'Delete', object: note }),
    });
    // Somebody else's conversation, which names neither the post nor the note.
    admin.logInboxActivity({
      activityId: 'https://remote.example/likes/2',
      activityType: 'Like',
      actorId: 'https://remote.example/users/cal',
      objectId: 'https://blog.example/ap/posts/other',
      json: JSON.stringify({ type: 'Like', object: 'https://blog.example/ap/posts/other' }),
    });

    // The post is named by the like, and answered by the reply; the note is
    // named by the delete. Oldest first, because a conversation reads that way.
    assert.deepEqual(admin.listActivitiesAbout([POST, note]), [created, liked, deleted]);
    assert.deepEqual(admin.listActivitiesAbout([note]), [created, deleted]);
    assert.deepEqual(admin.listActivitiesAbout([]), []);
  });

  it('keeps the arrival time it is given, so a rebuild puts the log’s own times back', async () => {
    const admin = await store();

    const logged = admin.logInboxActivity(reply({ receivedAt: '2026-09-03T10:00:00.000Z' }));

    assert.equal(logged.receivedAt, '2026-09-03T10:00:00.000Z');
  });

  it('backfills the index for activities logged before the column existed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'geekity-admin-'));
    temporaryDirs.push(dir);

    const before = openAdminStore({ dataDir: dir });
    before.logInboxActivity(reply());
    before.close();

    // Put the database back the way version 7 left it: the column gone, and
    // the migration unrecorded, so opening it again has to fill the column
    // from the activity that was stored without it.
    const raw = new DatabaseSync(path.join(dir, 'geekity.db'));
    raw.exec('DROP INDEX ap_inbox_in_reply_to');
    raw.exec('ALTER TABLE ap_inbox DROP COLUMN in_reply_to');
    raw.exec('DELETE FROM admin_migrations WHERE version = 8');
    raw.close();

    const after = openAdminStore({ dataDir: dir });
    openStores.push(after);
    assert.equal(after.listInboxActivities()[0]?.inReplyTo, POST);
    assert.equal(after.countRepliesTo(POST), 1);
  });
});

describe('replacing an index from the files it is derived from', () => {
  const REPLY_TARGET = 'https://blog.example/2026/03/hello/';

  it('makes the followers exactly what it is handed, and nothing that was there before', async () => {
    const admin = await store();
    admin.putFollower({
      username: 'blog',
      actorId: 'https://remote.example/users/ghost',
      inboxId: 'https://remote.example/users/ghost/inbox',
      sharedInboxId: null,
      handle: null,
      name: null,
      iconUrl: null,
      url: null,
    });

    admin.replaceFollowers([
      {
        username: 'blog',
        actorId: 'https://remote.example/users/ada',
        inboxId: 'https://remote.example/users/ada/inbox',
        sharedInboxId: null,
        handle: '@ada@remote.example',
        name: 'Ada Lovelace',
        iconUrl: null,
        url: null,
        followedAt: '2026-09-01T10:00:00.000Z',
      },
    ]);

    assert.deepEqual(
      admin.listFollowers().map((follower) => follower.actorId),
      ['https://remote.example/users/ada'],
    );
    assert.equal(admin.countFollowers(), 1);
  });

  it('makes the inbox log exactly what it is handed, with the ids starting again at one', async () => {
    const admin = await store();
    for (const index of [0, 1, 2]) {
      admin.logInboxActivity({
        activityId: `https://remote.example/likes/old-${String(index)}`,
        activityType: 'Like',
        actorId: 'https://remote.example/users/ada',
        objectId: 'https://blog.example/2026/03/hello/',
        json: '{"type":"Like"}',
      });
    }

    admin.replaceInboxActivities([
      {
        activityId: 'https://remote.example/likes/1',
        activityType: 'Like',
        actorId: 'https://remote.example/users/ada',
        objectId: 'https://blog.example/2026/03/hello/',
        receivedAt: '2026-09-03T10:00:00.000Z',
        json: '{"type":"Like"}',
      },
    ]);

    const held = admin.listInboxActivities();
    assert.equal(held.length, 1);
    assert.equal(held[0]?.id, 1, 'the row ids are a function of the file, not of history');
    assert.equal(held[0]?.activityId, 'https://remote.example/likes/1');
    assert.equal(held[0]?.receivedAt, '2026-09-03T10:00:00.000Z');
  });

  it('derives what a rebuilt reply answers, exactly as the live write does', async () => {
    const admin = await store();

    admin.replaceInboxActivities([
      {
        activityId: 'https://remote.example/creates/1',
        activityType: 'Create',
        actorId: 'https://remote.example/users/ada',
        objectId: 'https://remote.example/notes/1',
        receivedAt: '2026-09-04T10:00:00.000Z',
        json: JSON.stringify({
          type: 'Create',
          object: { id: 'https://remote.example/notes/1', inReplyTo: REPLY_TARGET },
        }),
      },
    ]);

    assert.equal(admin.listInboxActivities()[0]?.inReplyTo, REPLY_TARGET);
    assert.equal(admin.countRepliesTo(REPLY_TARGET), 1);
  });
});

describe('the delivery outcome cache', () => {
  const OBJECT_ID = 'https://blog.example/2026/03/hello/';
  const ACTIVITY_ID = `${OBJECT_ID}#create`;

  /** One follower's outcome for one activity about `hello`. */
  function outcome(overrides: Partial<NewDelivery> = {}): NewDelivery {
    return {
      activityId: ACTIVITY_ID,
      activityType: 'Create',
      objectId: OBJECT_ID,
      slug: 'hello',
      actorId: 'https://remote.example/users/ada',
      inboxId: 'https://remote.example/inbox',
      status: 'sent',
      error: null,
      ...overrides,
    };
  }

  it('starts empty', async () => {
    const admin = await store();

    assert.deepEqual(admin.listDeliveries(ACTIVITY_ID), []);
    assert.equal(admin.lastDeliveryToObject(OBJECT_ID), undefined);
    assert.deepEqual(admin.countDeliveriesByStatus(ACTIVITY_ID), {
      sent: 0,
      queued: 0,
      failed: 0,
    });
  });

  it('records what the activity was as well as how it went, since nothing else holds it', async () => {
    const admin = await store();

    const recorded = admin.recordDelivery(outcome());

    assert.equal(recorded.activityId, ACTIVITY_ID);
    assert.equal(recorded.activityType, 'Create');
    assert.equal(recorded.objectId, OBJECT_ID);
    assert.equal(recorded.slug, 'hello');
    assert.equal(recorded.actorId, 'https://remote.example/users/ada');
    assert.equal(recorded.inboxId, 'https://remote.example/inbox');
    assert.equal(recorded.status, 'sent');
    assert.equal(recorded.error, null);
    assert.ok(recorded.attemptedAt !== '', 'the attempt was timed');
  });

  it('records an activity about no post at all, which an actor update is', async () => {
    const admin = await store();

    const recorded = admin.recordDelivery(
      outcome({
        activityId: 'https://blog.example/author/ada/#update/2026-03-04T10:00:00.000Z',
        activityType: 'Update',
        objectId: 'https://blog.example/author/ada/',
        slug: null,
      }),
    );

    assert.equal(recorded.slug, null);
    assert.equal(
      admin.lastDeliveryToObject('https://blog.example/author/ada/')?.activityType,
      'Update',
    );
  });

  it('records one outcome per follower and counts them by status', async () => {
    const admin = await store();

    admin.recordDelivery(outcome());
    admin.recordDelivery(
      outcome({
        actorId: 'https://broken.example/users/nobody',
        inboxId: 'https://broken.example/users/nobody/inbox',
        status: 'failed',
        error: 'Their instance answered 500.',
      }),
    );

    const rows = admin.listDeliveries(ACTIVITY_ID);
    assert.deepEqual(
      rows.map((row) => [row.actorId, row.status, row.error]),
      [
        ['https://broken.example/users/nobody', 'failed', 'Their instance answered 500.'],
        ['https://remote.example/users/ada', 'sent', null],
      ],
    );
    assert.deepEqual(admin.countDeliveriesByStatus(ACTIVITY_ID), {
      sent: 1,
      queued: 0,
      failed: 1,
    });
  });

  it('moves a follower’s outcome rather than adding a second one', async () => {
    const admin = await store();
    admin.recordDelivery(outcome({ status: 'failed', error: 'Timed out.' }));

    admin.recordDelivery(outcome({ status: 'sent', error: null }));

    assert.deepEqual(admin.countDeliveriesByStatus(ACTIVITY_ID), {
      sent: 1,
      queued: 0,
      failed: 0,
    });
    assert.equal(admin.listDeliveries(ACTIVITY_ID)[0]?.error, null);
  });

  it('answers with the newest attempt about one post, whichever activity carried it', async () => {
    const admin = await store();
    admin.recordDelivery(outcome({ attemptedAt: '2026-03-04T10:00:00.000Z' }));
    admin.recordDelivery(
      outcome({
        activityId: `${OBJECT_ID}#update/2026-05-05T10:00:00.000Z`,
        activityType: 'Update',
        attemptedAt: '2026-05-05T10:00:00.000Z',
      }),
    );

    const last = admin.lastDeliveryToObject(OBJECT_ID);
    assert.equal(last?.activityType, 'Update');
    assert.equal(last?.attemptedAt, '2026-05-05T10:00:00.000Z');
    assert.equal(
      admin.lastDeliveryToObject('https://blog.example/ap/posts/elsewhere'),
      undefined,
      'and nothing about a post it was never asked about',
    );
  });
});

describe('the outbound activity table an older version wrote', () => {
  it('is rebuilt into the outcome cache and then goes, payloads and all', async () => {
    const dataDir = await temporaryDir();
    const database = new DatabaseSync(path.join(dataDir, 'geekity.db'));

    // Exactly migration 7, with the ledger row that stops it running again, so
    // the store under test opens the two tables a site upgrading from TASK-19
    // actually has: `ap_outbound` holding the JSON-LD decision-9 does away
    // with, and `ap_deliveries` pointing into it. Every other migration is
    // left to run, which is what puts the rest of the schema there.
    database.exec(`
      CREATE TABLE admin_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO admin_migrations (version, applied_at)
      VALUES (7, '2026-09-01T00:00:00.000Z');

      CREATE TABLE ap_outbound (
        activity_id   TEXT PRIMARY KEY,
        activity_type TEXT NOT NULL,
        object_id     TEXT NOT NULL,
        slug          TEXT,
        created_at    TEXT NOT NULL,
        json          TEXT NOT NULL
      );

      CREATE TABLE ap_deliveries (
        activity_id  TEXT NOT NULL REFERENCES ap_outbound (activity_id) ON DELETE CASCADE,
        actor_id     TEXT NOT NULL,
        inbox_id     TEXT NOT NULL,
        status       TEXT NOT NULL,
        error        TEXT,
        attempted_at TEXT NOT NULL,
        PRIMARY KEY (activity_id, actor_id)
      );

      INSERT INTO ap_outbound VALUES (
        'https://blog.example/2026/03/hello/#create', 'Create',
        'https://blog.example/2026/03/hello/', 'hello',
        '2026-09-01T10:00:00.000Z', '{"type":"Create"}'
      );
      INSERT INTO ap_deliveries VALUES (
        'https://blog.example/2026/03/hello/#create',
        'https://remote.example/users/ada', 'https://remote.example/inbox',
        'sent', NULL, '2026-09-01T10:00:01.000Z'
      );
    `);
    database.close();

    const admin = openAdminStore({ dataDir });
    openStores.push(admin);

    const last = admin.lastDeliveryToObject('https://blog.example/2026/03/hello/');
    assert.equal(last?.activityType, 'Create', 'the type moved onto the outcome row');
    assert.equal(last?.slug, 'hello', 'and so did the slug');
    assert.equal(last?.status, 'sent');
    assert.equal(last?.attemptedAt, '2026-09-01T10:00:01.000Z', 'with the time it was made');

    const opened = new DatabaseSync(path.join(dataDir, 'geekity.db'), { readOnly: true });
    try {
      assert.deepEqual(
        opened
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ap_outbound'")
          .all(),
        [],
        'no activity payload is stored anywhere any more',
      );
    } finally {
      opened.close();
    }
  });
});

describe('relay subscriptions', () => {
  const RELAY_INBOX = 'https://relay.example/user/_____relay_____/inbox';

  /** One relay subscription, as the relay service first writes it. */
  function subscription(overrides: Partial<NewRelay> = {}): NewRelay {
    return {
      inboxId: RELAY_INBOX,
      actorId: null,
      state: 'pending',
      reason: null,
      followId: 'https://blog.example/author/ada/#relay-follow/1',
      ...overrides,
    };
  }

  it('starts empty', async () => {
    const admin = await store();

    assert.deepEqual(admin.listRelays(), []);
    assert.equal(admin.getRelay(RELAY_INBOX), undefined);
  });

  it('keeps the follow it sent, so an Accept can be matched to it', async () => {
    const admin = await store();

    const stored = admin.putRelay(subscription());

    assert.equal(stored.inboxId, RELAY_INBOX);
    assert.equal(stored.state, 'pending');
    assert.equal(stored.actorId, null);
    assert.equal(stored.followId, 'https://blog.example/author/ada/#relay-follow/1');
    assert.ok(stored.createdAt !== '', 'the subscription was timed');
    assert.deepEqual(admin.getRelay(RELAY_INBOX), stored);
    assert.deepEqual(
      admin.getRelayByFollow('https://blog.example/author/ada/#relay-follow/1'),
      stored,
    );
  });

  it('moves a subscription rather than adding a second one, keeping when it began', async () => {
    const admin = await store();
    const first = admin.putRelay(subscription({ createdAt: '2026-03-04T10:00:00.000Z' }));

    const accepted = admin.putRelay(
      subscription({
        state: 'accepted',
        actorId: 'https://relay.example/user/_____relay_____',
        createdAt: '2026-09-09T10:00:00.000Z',
      }),
    );

    assert.equal(admin.listRelays().length, 1);
    assert.equal(accepted.createdAt, first.createdAt, 'a subscription began once');
    assert.equal(accepted.state, 'accepted');
    assert.equal(accepted.actorId, 'https://relay.example/user/_____relay_____');
    assert.ok(accepted.updatedAt >= first.updatedAt, 'the change was timed');
  });

  it('forgets a subscription when it is removed', async () => {
    const admin = await store();
    admin.putRelay(subscription());

    assert.equal(admin.deleteRelay(RELAY_INBOX), true);
    assert.equal(admin.deleteRelay(RELAY_INBOX), false);
    assert.deepEqual(admin.listRelays(), []);
  });

  it('answers with the last thing delivered to an inbox, whoever it belonged to', async () => {
    const admin = await store();

    assert.equal(admin.lastDeliveryToInbox(RELAY_INBOX), undefined);

    admin.recordDelivery({
      activityId: 'https://blog.example/2026/03/hello/#create',
      activityType: 'Create',
      objectId: 'https://blog.example/2026/03/hello/',
      slug: 'hello',
      actorId: 'https://relay.example/user/_____relay_____',
      inboxId: RELAY_INBOX,
      status: 'sent',
      error: null,
      attemptedAt: '2026-09-09T10:00:00.000Z',
    });

    const last = admin.lastDeliveryToInbox(RELAY_INBOX);
    assert.equal(last?.status, 'sent');
    assert.equal(last?.activityId, 'https://blog.example/2026/03/hello/#create');
  });
});
