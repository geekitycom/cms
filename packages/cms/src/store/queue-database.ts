import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { QUEUE, dataPath } from '../files/data-files.ts';
import type { WaitingDelivery } from './deliveries.ts';

export const FEDERATION_QUEUE_TABLE = 'federation_messages';

const BUSY_TIMEOUT_MS = 5000;

export function queueFile(dataDir: string): string {
  return dataPath(dataDir, QUEUE);
}

/**
 * Open the queue file, creating it mode `0600`: a waiting delivery carries the
 * private key it is signed with. SQLite creates the `-wal` and `-shm` files
 * with the database's mode but leaves the mode of ones that already exist, so
 * those are narrowed too. `secure_delete` zeroes a taken message's bytes
 * rather than leaving them in a free page.
 */
export function openQueueDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const file = queueFile(dataDir);
  closeSync(openSync(file, 'a', 0o600));
  for (const owned of [file, `${file}-wal`, `${file}-shm`]) {
    if (existsSync(owned)) chmodSync(owned, 0o600);
  }
  const db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
  db.exec('PRAGMA secure_delete=ON');
  return db;
}

/**
 * Remove each waiting message signed with a private key that is not in
 * `held`, the `d` of every key file the site has now. A key file replaced or
 * removed by hand is a key the site has stopped trusting, and Fedify would go
 * on signing with the copy in the message through days of retries.
 */
export function dropMessagesSignedByRetiredKeys(dataDir: string, held: ReadonlySet<string>): void {
  if (!existsSync(queueFile(dataDir))) return;
  const db = openQueueDatabase(dataDir);
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(FEDERATION_QUEUE_TABLE);
    if (table === undefined) return;
    const rows = db
      .prepare(
        `SELECT id, json_extract(message, '$.keys') AS keys FROM ${FEDERATION_QUEUE_TABLE}
          WHERE json_extract(message, '$.keys') IS NOT NULL`,
      )
      .all();
    const remove = db.prepare(`DELETE FROM ${FEDERATION_QUEUE_TABLE} WHERE id = ?`);
    for (const row of rows) {
      const keys = JSON.parse(String(row['keys'])) as { privateKey?: { d?: unknown } }[];
      const retired = keys.some((key) => {
        const d = key.privateKey?.d;
        return typeof d !== 'string' || !held.has(d);
      });
      if (retired) remove.run(row['id'] as string);
    }
  } finally {
    db.close();
  }
}

/**
 * Drop the ordering locks a worker left behind. `SqliteMessageQueue` holds a
 * lock row while a handler runs and deletes it when the handler ends, so a
 * worker killed mid-send leaves its key locked and every message on that key
 * is skipped for good. Only safe before this process's queue listens and once
 * the previous worker has stopped taking messages.
 */
export function releaseOrderingLocks(dataDir: string): void {
  if (!existsSync(queueFile(dataDir))) return;
  const db = openQueueDatabase(dataDir);
  try {
    const locks = `${FEDERATION_QUEUE_TABLE}_locks`;
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(locks);
    if (table !== undefined) db.exec(`DELETE FROM "${locks}"`);
  } finally {
    db.close();
  }
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

/**
 * Each delivery a message in the queue still carries: an outbox message's
 * inbox, and every inbox a fanout has yet to split into outbox messages.
 */
export function listWaitingDeliveries(dataDir: string): WaitingDelivery[] {
  return readQueue(dataDir, [], (db) =>
    db
      .prepare(
        `SELECT json_extract(message, '$.activityId') AS activity_id,
                json_extract(message, '$.inbox') AS inbox
           FROM ${FEDERATION_QUEUE_TABLE}
          WHERE json_extract(message, '$.type') = 'outbox'
         UNION ALL
         SELECT json_extract(queued.message, '$.activityId'), inboxes.key
           FROM ${FEDERATION_QUEUE_TABLE} AS queued,
                json_each(queued.message, '$.inboxes') AS inboxes
          WHERE json_extract(queued.message, '$.type') = 'fanout'`,
      )
      .all()
      .flatMap((row) => {
        const activityId = row['activity_id'];
        const inbox = row['inbox'];
        return typeof activityId === 'string' && typeof inbox === 'string'
          ? [{ activityId, inbox }]
          : [];
      }),
  );
}

function countMessages(dataDir: string, where: string, values: readonly string[]): number {
  return readQueue(dataDir, 0, (db) => {
    const row = db
      .prepare(`SELECT count(*) AS waiting FROM ${FEDERATION_QUEUE_TABLE} ${where}`)
      .get(...values);
    return Number(row?.['waiting'] ?? 0);
  });
}

function readQueue<T>(dataDir: string, empty: T, read: (db: DatabaseSync) => T): T {
  const file = queueFile(dataDir);
  if (!existsSync(file)) return empty;
  const db = new DatabaseSync(file, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(FEDERATION_QUEUE_TABLE);
    return table === undefined ? empty : read(db);
  } finally {
    db.close();
  }
}
