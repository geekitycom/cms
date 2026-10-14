import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { QUEUE, dataPath } from '../files/data-files.ts';

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
