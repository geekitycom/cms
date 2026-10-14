import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const QUEUE_FILE = 'queue.sqlite';

const BUSY_TIMEOUT_MS = 5000;

export function queueFile(dataDir: string): string {
  return path.join(dataDir, QUEUE_FILE);
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
