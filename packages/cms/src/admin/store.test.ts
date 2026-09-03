import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { DuplicateUsernameError, openAdminStore } from './store.ts';
import type { AdminStore } from './store.ts';

const temporaryDirs: string[] = [];
const openStores: AdminStore[] = [];

after(async () => {
  for (const opened of openStores) opened.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** An admin store on a data dir of its own, closed when the file finishes. */
async function store(): Promise<AdminStore> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-admin-'));
  temporaryDirs.push(dir);
  const opened = openAdminStore({ dataDir: dir });
  openStores.push(opened);
  return opened;
}

describe('users', () => {
  it('starts empty, which is what the first-run setup asks', async () => {
    const admin = await store();

    assert.equal(admin.countUsers(), 0);
    assert.deepEqual(admin.listUsers(), []);
  });

  it('creates a user and lists it without its password hash', async () => {
    const admin = await store();

    const created = admin.createUser({ username: 'ada', password: 'correct horse battery' });

    assert.equal(created.username, 'ada');
    assert.ok(created.id > 0, 'the user got a row id');
    assert.equal(admin.countUsers(), 1);
    assert.deepEqual(
      admin.listUsers().map((user) => user.username),
      ['ada'],
    );
    assert.ok(
      !Object.keys(created).includes('passwordHash'),
      'a listed user never carries the hash',
    );
  });

  it('refuses a second user with the same name', async () => {
    const admin = await store();
    admin.createUser({ username: 'ada', password: 'correct horse battery' });

    assert.throws(
      () => admin.createUser({ username: 'ada', password: 'another one entirely' }),
      DuplicateUsernameError,
    );
    assert.equal(admin.countUsers(), 1);
  });

  it('accepts the right password and refuses a wrong one', async () => {
    const admin = await store();
    admin.createUser({ username: 'ada', password: 'correct horse battery' });

    const ok = admin.verifyPassword('ada', 'correct horse battery');
    assert.equal(ok?.username, 'ada');

    assert.equal(admin.verifyPassword('ada', 'Correct horse battery'), undefined);
    assert.equal(admin.verifyPassword('nobody', 'correct horse battery'), undefined);
  });

  it('stores the password as an argon2id hash rather than the password', async () => {
    const admin = await store();
    admin.createUser({ username: 'ada', password: 'correct horse battery' });

    const stored = admin.getUser('ada');
    assert.ok(stored !== undefined, 'the user is there');
    assert.ok(stored.passwordHash.startsWith('$argon2id$'), stored.passwordHash);
    assert.ok(!stored.passwordHash.includes('correct horse battery'));
  });

  it('gives two users with the same password different hashes', async () => {
    const admin = await store();
    admin.createUser({ username: 'ada', password: 'a shared password' });
    admin.createUser({ username: 'grace', password: 'a shared password' });

    assert.notEqual(admin.getUser('ada')?.passwordHash, admin.getUser('grace')?.passwordHash);
  });

  it('replaces a password, so the old one stops working and the new one starts', async () => {
    const admin = await store();
    const ada = admin.createUser({ username: 'ada', password: 'correct horse battery' });

    assert.equal(admin.setPassword(ada.id, 'a different password'), true);

    assert.equal(admin.verifyPassword('ada', 'correct horse battery'), undefined);
    assert.equal(admin.verifyPassword('ada', 'a different password')?.id, ada.id);
  });

  it('says so when there is no user to give a password to', async () => {
    const admin = await store();

    assert.equal(admin.setPassword(404, 'a password nobody will use'), false);
  });

  it('deletes a user and says so when there was none to delete', async () => {
    const admin = await store();
    const ada = admin.createUser({ username: 'ada', password: 'correct horse battery' });

    assert.equal(admin.deleteUser(ada.id), true);
    assert.equal(admin.countUsers(), 0);
    assert.equal(admin.getUser('ada'), undefined);
    assert.equal(admin.deleteUser(ada.id), false);
  });
});

const HOUR = 3600;

describe('sessions', () => {
  it('hands back an unguessable id and a CSRF token of its own', async () => {
    const admin = await store();
    const user = admin.createUser({ username: 'ada', password: 'correct horse battery' });

    const session = admin.createSession({ userId: user.id, lifetimeSeconds: HOUR });

    // 256 bits, hex encoded.
    assert.match(session.id, /^[0-9a-f]{64}$/);
    assert.match(session.csrfToken, /^[0-9a-f]{64}$/);
    assert.notEqual(session.id, session.csrfToken);
    assert.equal(session.userId, user.id);

    const second = admin.createSession({ userId: user.id, lifetimeSeconds: HOUR });
    assert.notEqual(second.id, session.id, 'two sessions never share an id');
  });

  it('reads a live session back and drops one that is gone', async () => {
    const admin = await store();
    const user = admin.createUser({ username: 'ada', password: 'correct horse battery' });
    const session = admin.createSession({ userId: user.id, lifetimeSeconds: HOUR });

    const read = admin.getSession(session.id);
    assert.equal(read?.userId, user.id);
    assert.equal(read?.csrfToken, session.csrfToken);

    assert.equal(admin.deleteSession(session.id), true, 'the row was there to delete');
    assert.equal(admin.getSession(session.id), undefined, 'logout invalidates it server-side');
    assert.equal(admin.deleteSession(session.id), false, 'deleting twice is a no-op');
  });

  it('treats an expired session as absent and prunes the row', async () => {
    const admin = await store();
    const user = admin.createUser({ username: 'ada', password: 'correct horse battery' });

    const now = new Date('2026-09-02T12:00:00Z');
    const session = admin.createSession({ userId: user.id, lifetimeSeconds: HOUR, now });
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
    const user = admin.createUser({ username: 'ada', password: 'correct horse battery' });
    const now = new Date('2026-09-02T12:00:00Z');

    const short = admin.createSession({ userId: user.id, lifetimeSeconds: 60, now });
    const long = admin.createSession({ userId: user.id, lifetimeSeconds: HOUR, now });

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
    const ada = admin.createUser({ username: 'ada', password: 'correct horse battery' });
    const grace = admin.createUser({ username: 'grace', password: 'a password of her own' });
    const keep = admin.createSession({ userId: ada.id, lifetimeSeconds: HOUR });
    const elsewhere = admin.createSession({ userId: ada.id, lifetimeSeconds: HOUR });
    const somebodyElse = admin.createSession({ userId: grace.id, lifetimeSeconds: HOUR });

    assert.equal(admin.deleteSessionsForUser(ada.id, { except: keep.id }), 1);

    assert.ok(admin.getSession(keep.id) !== undefined, 'the asking session is still live');
    assert.equal(admin.getSession(elsewhere.id), undefined);
    assert.ok(
      admin.getSession(somebodyElse.id) !== undefined,
      "another user's session is not touched",
    );
  });

  it('drops every session a user has when nothing is spared', async () => {
    const admin = await store();
    const ada = admin.createUser({ username: 'ada', password: 'correct horse battery' });
    const one = admin.createSession({ userId: ada.id, lifetimeSeconds: HOUR });
    const two = admin.createSession({ userId: ada.id, lifetimeSeconds: HOUR });

    assert.equal(admin.deleteSessionsForUser(ada.id), 2);

    assert.equal(admin.getSession(one.id), undefined);
    assert.equal(admin.getSession(two.id), undefined);
  });

  it('takes a deleted user’s sessions with them, because the foreign key cascades', async () => {
    const admin = await store();
    const ada = admin.createUser({ username: 'ada', password: 'correct horse battery' });
    const session = admin.createSession({ userId: ada.id, lifetimeSeconds: HOUR });

    admin.deleteUser(ada.id);

    assert.equal(admin.getSession(session.id), undefined);
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

describe('settings', () => {
  it('starts empty, which is what puts a boot into seeding', async () => {
    const admin = await store();

    assert.equal(admin.countSettings(), 0);
    assert.deepEqual(admin.allSettings(), {});
  });

  it('writes, replaces and leaves untouched keys alone', async () => {
    const admin = await store();

    admin.setSettings({ title: 'First', tagline: 'A tagline' });
    admin.setSettings({ title: 'Second' });

    assert.deepEqual(admin.allSettings(), { title: 'Second', tagline: 'A tagline' });
    assert.equal(admin.countSettings(), 2);
  });
});
