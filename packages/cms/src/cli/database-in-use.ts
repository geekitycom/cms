import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { databaseFile } from '../cache.ts';

/**
 * Whether something else has the database open.
 *
 * SQLite in WAL mode keeps a shared-memory file that every connection takes a
 * lock in, and asking for `locking_mode = EXCLUSIVE` means asking to be the
 * only one there — so a write transaction under it comes back
 * {@link SQLITE_BUSY} exactly when somebody else is attached. That is a cheap
 * and honest answer to "is the site running?", where a lock file of our own
 * would have to be cleaned up after a crash and a check of the `-wal` file
 * would say yes to a database nobody has open. The probe's own connection is
 * closed either way, which is what releases the lock it may have taken.
 *
 * Only busy is in use. A database that is not there, and one that will not
 * open or read at all, are both the case this command exists for, so they
 * answer no and let the rebuild get on with it.
 */
export function databaseInUse(dataDir: string): boolean {
  const file = databaseFile(dataDir);
  if (!existsSync(file)) return false;

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
  } catch {
    return false;
  }

  try {
    db.exec('PRAGMA locking_mode = EXCLUSIVE');
    db.exec('BEGIN IMMEDIATE');
    db.exec('COMMIT');
    return false;
  } catch (error) {
    const code = (error as { errcode?: unknown } | null)?.errcode;
    return code === SQLITE_BUSY || code === SQLITE_LOCKED;
  } finally {
    db.close();
  }
}

/** SQLite's result codes for "somebody else has it", the only ones that mean in use. */
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
