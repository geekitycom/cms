import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { QUEUE, dataPath } from '../files/data-files.ts';

export const FEDERATION_QUEUE_TABLE = 'federation_messages';

const BUSY_TIMEOUT_MS = 5000;

export function queueFile(dataDir: string): string {
  return dataPath(dataDir, QUEUE);
}

/**
 * Open the queue file, creating it mode `0600`: a waiting delivery carries the
 * private key it is signed with. SQLite gives the `-wal` and `-shm` files the
 * mode of the database.
 */
export function openQueueDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const file = queueFile(dataDir);
  closeSync(openSync(file, 'a', 0o600));
  chmodSync(file, 0o600);
  return new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
}

/**
 * How many messages wait in the queue file, read over a read-only connection
 * so a running site's queue is not touched. No file, or a file the queue has
 * not yet set up, holds none.
 */
export function countWaitingMessages(dataDir: string): number {
  const file = queueFile(dataDir);
  if (!existsSync(file)) return 0;
  const db = new DatabaseSync(file, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(FEDERATION_QUEUE_TABLE);
    if (table === undefined) return 0;
    const row = db.prepare(`SELECT count(*) AS waiting FROM ${FEDERATION_QUEUE_TABLE}`).get();
    return Number(row?.['waiting'] ?? 0);
  } finally {
    db.close();
  }
}
