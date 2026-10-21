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

export function countWaitingMessages(dataDir: string): number {
  return countMessages(dataDir, '', []);
}

/**
 * How many deliveries first tried at or after `since` wait in the queue for a
 * retry: Fedify puts an outbox message back with its attempt raised after a
 * failure, and takes it out for good once the inbox accepts it.
 */
export function countRetryingDeliveries(dataDir: string, since: string): number {
  return countMessages(
    dataDir,
    `WHERE json_extract(message, '$.type') = 'outbox'
       AND json_extract(message, '$.attempt') >= 1
       AND json_extract(message, '$.started') >= ?`,
    [since],
  );
}

function countMessages(dataDir: string, where: string, values: readonly string[]): number {
  const file = queueFile(dataDir);
  if (!existsSync(file)) return 0;
  const db = new DatabaseSync(file, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(FEDERATION_QUEUE_TABLE);
    if (table === undefined) return 0;
    const row = db
      .prepare(`SELECT count(*) AS waiting FROM ${FEDERATION_QUEUE_TABLE} ${where}`)
      .get(...values);
    return Number(row?.['waiting'] ?? 0);
  } finally {
    db.close();
  }
}
