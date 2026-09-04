import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import {
  applyMigrations,
  databaseFile,
  databaseFiles,
  discardDatabase,
  openDatabase,
  OutdatedDatabaseError,
  UnusableDatabaseError,
  withRebuiltDatabase,
} from './cache.ts';
import type { Migration } from './cache.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dataDir(): Promise<string> {
  const created = await mkdtemp(path.join(tmpdir(), 'geekity-cache-'));
  dirs.push(created);
  return created;
}

/** A ledger of two migrations, so a test can talk about "the ones we ship". */
const SHIPPED: readonly Migration[] = [
  { version: 1, sql: 'CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT)' },
  { version: 2, sql: 'ALTER TABLE things ADD COLUMN colour TEXT' },
];

/** The same ledger as a package that has since dropped its first migrations. */
const PRUNED: readonly Migration[] = [
  { version: 6, sql: 'CREATE TABLE things (id INTEGER PRIMARY KEY, colour TEXT)' },
];

/** Open one database and hand it to `use`, closing it however that ends. */
function withDatabase<T>(file: string, use: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file);
  try {
    return use(db);
  } finally {
    db.close();
  }
}

describe('applyMigrations', () => {
  it('applies what has not been applied, and applying twice does nothing', async () => {
    const file = databaseFile(await dataDir());

    withDatabase(file, (db) => {
      applyMigrations(db, { file, ledger: 'test_migrations', migrations: SHIPPED });
      db.prepare('INSERT INTO things (name, colour) VALUES (?, ?)').run('kettle', 'red');
    });

    const applied = withDatabase(file, (db) => {
      applyMigrations(db, { file, ledger: 'test_migrations', migrations: SHIPPED });
      return db
        .prepare('SELECT version FROM test_migrations ORDER BY version')
        .all()
        .map((row) => Number(row['version']));
    });

    assert.deepEqual(applied, [1, 2]);
  });

  it('refuses a ledger holding a version this package does not ship', async () => {
    const file = databaseFile(await dataDir());

    withDatabase(file, (db) => {
      applyMigrations(db, { file, ledger: 'test_migrations', migrations: SHIPPED });
      db.prepare('INSERT INTO test_migrations (version, applied_at) VALUES (?, ?)').run(
        3,
        new Date().toISOString(),
      );
    });

    assert.throws(
      () =>
        withDatabase(file, (db) => {
          applyMigrations(db, { file, ledger: 'test_migrations', migrations: SHIPPED });
        }),
      (error: unknown) => {
        assert.ok(error instanceof UnusableDatabaseError);
        assert.match(error.message, /geekity\.db/);
        assert.match(error.message, /\b3\b/);
        assert.match(error.message, /geekity rebuild/);
        return true;
      },
    );
  });

  it('refuses a database that is too old to carry forward', async () => {
    const file = databaseFile(await dataDir());

    withDatabase(file, (db) => {
      applyMigrations(db, { file, ledger: 'test_migrations', migrations: SHIPPED });
    });

    assert.throws(
      () =>
        withDatabase(file, (db) => {
          applyMigrations(db, { file, ledger: 'test_migrations', migrations: PRUNED });
        }),
      (error: unknown) => {
        assert.ok(error instanceof OutdatedDatabaseError);
        assert.match(error.message, /geekity\.db/);
        return true;
      },
    );
  });

  it('takes an empty ledger as a new database rather than an old one', async () => {
    const file = databaseFile(await dataDir());

    withDatabase(file, (db) => {
      applyMigrations(db, { file, ledger: 'test_migrations', migrations: PRUNED });
      db.prepare('INSERT INTO things (colour) VALUES (?)').run('green');
    });
  });
});

describe('openDatabase', () => {
  it('creates the data directory and the database under it', async () => {
    const dir = path.join(await dataDir(), 'nested', 'data');

    const db = openDatabase({ dataDir: dir, ledger: 'test_migrations', migrations: SHIPPED });
    try {
      assert.ok(existsSync(databaseFile(dir)));
      assert.equal(db.prepare('PRAGMA journal_mode').get()?.['journal_mode'], 'wal');
    } finally {
      db.close();
    }
  });

  it('refuses a file that is not a database, naming it and the way out', async () => {
    const dir = await dataDir();
    await writeFile(databaseFile(dir), 'this is not a database, it is a note\n');

    assert.throws(
      () => openDatabase({ dataDir: dir, ledger: 'test_migrations', migrations: SHIPPED }),
      (error: unknown) => {
        assert.ok(error instanceof UnusableDatabaseError);
        assert.match(error.message, /geekity\.db/);
        assert.match(error.message, /geekity rebuild/);
        return true;
      },
    );
  });
});

describe('discardDatabase', () => {
  it('takes the database and its write-ahead log with it', async () => {
    const dir = await dataDir();
    const db = openDatabase({ dataDir: dir, ledger: 'test_migrations', migrations: SHIPPED });
    db.close();
    for (const file of databaseFiles(dir)) await writeFile(file, '');

    discardDatabase(dir);

    for (const file of databaseFiles(dir)) assert.equal(existsSync(file), false);
  });

  it('is happy when there is nothing to discard', async () => {
    discardDatabase(await dataDir());
  });
});

describe('withRebuiltDatabase', () => {
  it('discards the database and opens again when one is too old to carry forward', async () => {
    const dir = await dataDir();
    const file = databaseFile(dir);
    withDatabase(file, (db) => {
      applyMigrations(db, { file, ledger: 'test_migrations', migrations: SHIPPED });
      db.prepare('INSERT INTO things (name) VALUES (?)').run('kettle');
    });

    let attempts = 0;
    const rows = withRebuiltDatabase(dir, () => {
      attempts += 1;
      const db = openDatabase({
        dataDir: dir,
        ledger: 'test_migrations',
        // The first attempt is the package that has dropped its early
        // migrations; the discard leaves a database it can build from nothing.
        migrations: PRUNED,
      });
      try {
        return db.prepare('SELECT * FROM things').all().length;
      } finally {
        db.close();
      }
    });

    assert.equal(attempts, 2);
    assert.equal(rows, 0);
  });

  it('lets a database it must not throw away refuse the boot', async () => {
    const dir = await dataDir();
    await writeFile(databaseFile(dir), 'not a database\n');

    assert.throws(
      () =>
        withRebuiltDatabase(dir, () =>
          openDatabase({ dataDir: dir, ledger: 'test_migrations', migrations: SHIPPED }),
        ),
      UnusableDatabaseError,
    );
    assert.ok(existsSync(databaseFile(dir)), 'the file it refused is still there to look at');
  });
});
