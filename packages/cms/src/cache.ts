import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * The one SQLite file a site has, and the rules for opening it.
 *
 * Everything in it is derived (decision-9): the content index is a reading of
 * `content/`, the followers and the inbox indexes are a reading of
 * `content/_data/federation/`, and what is left — sessions, delivery outcomes,
 * the relay handshake, the scheduler's watermark — is a cache a site may lose.
 * So the file may be deleted at rest, and this module is where that promise is
 * kept: it owns the file's name, the migration ledger both stores keep inside
 * it, and what happens when the file that is there cannot be used.
 */

/** File name of the derived database inside a site's data directory. */
export const DATABASE_FILE = 'geekity.db';

/**
 * The suffixes SQLite hangs off the database in WAL mode.
 *
 * Deleting the database without them leaves a write-ahead log describing a
 * file that is no longer there, which the next connection would either replay
 * into a fresh database or refuse; all three go together or none do.
 */
export const DATABASE_SUFFIXES: readonly string[] = ['', '-wal', '-shm'];

/** Where the database lives under `dataDir`. */
export function databaseFile(dataDir: string): string {
  return path.join(dataDir, DATABASE_FILE);
}

/** Every file the database is spread across, whether or not it is there. */
export function databaseFiles(dataDir: string): string[] {
  return DATABASE_SUFFIXES.map((suffix) => `${databaseFile(dataDir)}${suffix}`);
}

/**
 * Throw the database away, log and all.
 *
 * Silent about files that are not there, because that is the ordinary case for
 * `-wal` and `-shm` after a clean shutdown, and because a site is entitled to
 * delete the database itself between two boots.
 *
 * Nothing may hold the file open across this. An open connection keeps the
 * inode it was given, so it would go on reading and writing a database nobody
 * can find while the next connection creates a different one under the same
 * name.
 */
export function discardDatabase(dataDir: string): void {
  for (const file of databaseFiles(dataDir)) rmSync(file, { force: true });
}

/**
 * A database this package cannot use and must not throw away on its own.
 *
 * Two things raise it. A ledger holding a version this package does not ship
 * is a downgrade: the file was written by a later `@geekity/cms`, whose schema
 * this one would misread. A file SQLite will not open at all is damaged. In
 * both cases the way out is a decision only a person can make, and the message
 * names it — which is what {@link discardDatabase} and `geekity rebuild` are.
 */
export class UnusableDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnusableDatabaseError';
  }
}

/**
 * A database older than the migrations this package still ships, so there is
 * no path forward from it.
 *
 * Unlike {@link UnusableDatabaseError} this one is recoverable without asking
 * anybody, and {@link withRebuiltDatabase} recovers from it: nothing in the
 * database is anything but a reading of the files, so a version of it too old
 * to carry forward is thrown away and read again.
 */
export class OutdatedDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutdatedDatabaseError';
  }
}

/** One schema version. */
export interface Migration {
  /** Its place in the order, and its entry in the ledger. */
  version: number;
  /** The schema change itself. */
  sql: string;
  /**
   * A backfill, run in the same transaction once {@link Migration.sql} has.
   *
   * For a column derived from something already stored: SQL can add the column
   * and JavaScript can then fill it with exactly what the writer will put
   * there, rather than with a second, subtly different expression of the same
   * rule.
   */
  run?: (db: DatabaseSync) => void;
}

/** One set of migrations and the table recording which of them have run. */
export interface MigrationLedger {
  /** The database file, so a refusal can name it. */
  file: string;
  /** The table the applied versions are recorded in. */
  ledger: string;
  /** Every version this package ships, in order. */
  migrations: readonly Migration[];
}

/**
 * Bring one ledger's schema up to date, or refuse to.
 *
 * There are two ledgers in the one file — `migrations` for the content index
 * and `admin_migrations` for everything else — because the two stores were
 * written apart and each ships its own versions. They share this loop, and so
 * share what happens when the versions in the file are not the versions in the
 * package:
 *
 * - **Ahead of us.** A version recorded that this package does not ship means
 *   a newer `@geekity/cms` wrote the file. Applying our own migrations over it
 *   would be reading somebody else's schema as if it were ours, so this
 *   refuses, names the file and says both ways out.
 * - **Behind what we can carry.** A newest version below the oldest migration
 *   still shipped means the steps in between have been pruned from the package
 *   and there is no path from that schema to this one. That is
 *   {@link OutdatedDatabaseError}, and the caller is expected to throw the
 *   database away rather than to stop.
 * - **Empty.** A new database, whatever the oldest shipped version is.
 *
 * Applying is idempotent, and each migration is its own transaction, so a
 * failure part-way leaves the ledger describing exactly the schema on disk.
 */
export function applyMigrations(db: DatabaseSync, ledger: MigrationLedger): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${ledger.ledger} (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare(`SELECT version FROM ${ledger.ledger}`)
      .all()
      .map((row) => Number(row['version'])),
  );

  const shipped = new Set(ledger.migrations.map((migration) => migration.version));
  const latest = Math.max(...shipped);

  const ahead = [...applied].filter((version) => version > latest).sort((a, b) => a - b);
  if (ahead.length > 0) {
    throw new UnusableDatabaseError(
      `${ledger.file} was written by a newer version of @geekity/cms: its ${ledger.ledger} ` +
        `table records schema ${ahead.join(', ')}, which this version does not ship. Upgrade ` +
        '@geekity/cms to the version that wrote it, or delete the database with `geekity ' +
        'rebuild` — it holds nothing that is not read back from content/ and data/.',
    );
  }

  const oldest = Math.min(...shipped);
  const newest = applied.size === 0 ? undefined : Math.max(...applied);
  if (newest !== undefined && newest < oldest - 1) {
    throw new OutdatedDatabaseError(
      `${ledger.file} is at schema ${String(newest)}, and the oldest migration this version of ` +
        `@geekity/cms ships is ${String(oldest)}, so there is no path forward from it.`,
    );
  }

  const record = db.prepare(`INSERT INTO ${ledger.ledger} (version, applied_at) VALUES (?, ?)`);

  for (const migration of ledger.migrations) {
    if (applied.has(migration.version)) continue;

    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      migration.run?.(db);
      record.run(migration.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** What {@link openDatabase} needs: where the file is and which ledger to run. */
export interface OpenDatabaseOptions extends Omit<MigrationLedger, 'file'> {
  /** Directory the database lives in. Created if it is missing. */
  dataDir: string;
}

/**
 * Open the database under `dataDir`, creating it if it is not there, and bring
 * one ledger up to date.
 *
 * A database that will not open is turned into an {@link UnusableDatabaseError}
 * naming the file, because SQLite's own message for it ("file is not a
 * database") says nothing about which file or what to do about it, and this is
 * the failure a site is most likely to meet at three in the morning.
 * {@link OutdatedDatabaseError} passes through untouched: it is the one the
 * caller is meant to recover from.
 */
export function openDatabase(options: OpenDatabaseOptions): DatabaseSync {
  const file = databaseFile(options.dataDir);
  mkdirSync(options.dataDir, { recursive: true });

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  } catch (error) {
    throw unusable(file, error);
  }

  try {
    applyMigrations(db, { file, ledger: options.ledger, migrations: options.migrations });
  } catch (error) {
    db.close();
    if (error instanceof UnusableDatabaseError || error instanceof OutdatedDatabaseError)
      throw error;
    throw unusable(file, error);
  }

  return db;
}

/** A SQLite failure, said in terms of the file and the way out. */
function unusable(file: string, error: unknown): UnusableDatabaseError {
  const detail = error instanceof Error ? error.message : String(error);
  return new UnusableDatabaseError(
    `${file} could not be opened as a database (${detail}). It holds nothing that is not read ` +
      'back from content/ and data/, so the fix is to delete it: run `geekity rebuild`, or ' +
      'remove the file and its -wal and -shm siblings and start the site again.',
  );
}

/**
 * Open the cache, and if the only thing wrong with it is its age, throw it away
 * and open it again.
 *
 * `open` has to be able to run twice, and has to have closed whatever it
 * opened before it throws: the file cannot be deleted while a connection holds
 * it. It is a callback rather than a database because a site's boot opens two
 * connections against the one file, and both of them, or neither, must be over
 * the database that survives.
 */
export function withRebuiltDatabase<T>(dataDir: string, open: () => T): T {
  try {
    return open();
  } catch (error) {
    if (!(error instanceof OutdatedDatabaseError)) throw error;
    discardDatabase(dataDir);
    return open();
  }
}
