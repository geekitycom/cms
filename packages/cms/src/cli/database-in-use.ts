import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { databaseFile } from '../cache.ts';

/**
 * SQLite in WAL mode keeps a shared-memory file that every connection takes a
 * lock in, and `locking_mode = EXCLUSIVE` asks to be the only one there, so a
 * write transaction under it comes back {@link SQLITE_BUSY} exactly when
 * somebody else is attached. Closing the probe's connection releases the lock
 * it may have taken.
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

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
