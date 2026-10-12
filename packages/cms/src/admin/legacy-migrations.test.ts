import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { databaseFile } from '../cache.ts';
import {
  dropLegacyTable,
  legacyActorKeys,
  legacySettings,
  legacyUsers,
} from './legacy-migrations.ts';
import { adminStoreOwning, openAdminDatabase } from './store.ts';
import type { AdminStore } from './store.ts';

const temporaryDirs: string[] = [];
const openDatabases: DatabaseSync[] = [];
const openStores: AdminStore[] = [];

after(async () => {
  for (const opened of openStores) opened.close();
  for (const opened of openDatabases) if (opened.isOpen) opened.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-legacy-'));
  temporaryDirs.push(dir);
  return dir;
}

async function database(): Promise<DatabaseSync> {
  const opened = openAdminDatabase(await temporaryDir());
  openDatabases.push(opened);
  return opened;
}

const HOUR = 3600;
const ADA = 1;

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

    const db = openAdminDatabase(dataDir);
    assert.deepEqual(legacySettings(db), [
      { key: 'title', value: 'From the rows', updatedAt: '2026-09-01T00:00:00.000Z' },
    ]);

    dropLegacyTable(db, 'settings');
    assert.equal(legacySettings(db), undefined, 'the table is gone');
    dropLegacyTable(db, 'settings');
    db.close();

    const reopened = openAdminDatabase(dataDir);
    assert.equal(legacySettings(reopened), undefined, 'and stays gone across a boot');
    reopened.close();
  });

  it('is dropped on a database this version created, where it was never used', async () => {
    const db = await database();
    assert.deepEqual(legacySettings(db), [], 'migration 3 still creates it, empty');

    dropLegacyTable(db, 'settings');
    assert.equal(legacySettings(db), undefined);
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

    const db = openAdminDatabase(dataDir);
    assert.deepEqual(legacyActorKeys(db), [
      { identifier: 'actor', algorithm: 'Ed25519', privateJwk: '{"d":"private"}' },
    ]);

    dropLegacyTable(db, 'actor_keys');
    assert.equal(legacyActorKeys(db), undefined, 'the table is gone');
    dropLegacyTable(db, 'actor_keys');
    db.close();

    const reopened = openAdminDatabase(dataDir);
    assert.equal(legacyActorKeys(reopened), undefined, 'and stays gone across a boot');
    reopened.close();
  });

  it('is dropped on a database this version created, where it was never used', async () => {
    const db = await database();
    assert.deepEqual(legacyActorKeys(db), [], 'migration 4 still creates it, empty');

    dropLegacyTable(db, 'actor_keys');
    assert.equal(legacyActorKeys(db), undefined);
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

    const db = openAdminDatabase(dataDir);
    assert.deepEqual(legacyUsers(db), [
      {
        id: 7,
        username: 'ada',
        passwordHash: '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);

    dropLegacyTable(db, 'users');
    assert.equal(legacyUsers(db), undefined, 'the table is gone');
    dropLegacyTable(db, 'users');
    db.close();

    const reopened = openAdminDatabase(dataDir);
    assert.equal(legacyUsers(reopened), undefined, 'and stays gone across a boot');
    reopened.close();
  });

  it('is dropped on a database this version created, where it was never used', async () => {
    const db = await database();
    assert.deepEqual(legacyUsers(db), [], 'migration 1 still creates it, empty');

    dropLegacyTable(db, 'users');
    assert.equal(legacyUsers(db), undefined);
  });

  it('does not take the sessions with it, because they no longer reference it', async () => {
    const dataDir = await temporaryDir();
    const db = openAdminDatabase(dataDir);
    const admin = adminStoreOwning(db, databaseFile(dataDir));
    openStores.push(admin);
    const session = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });

    dropLegacyTable(db, 'users');

    assert.equal(admin.getSession(session.id)?.userId, ADA, 'the login survived the drop');
    const after = admin.createSession({ userId: ADA, lifetimeSeconds: HOUR });
    assert.equal(admin.getSession(after.id)?.userId, ADA, 'and another can still be made');
  });
});
