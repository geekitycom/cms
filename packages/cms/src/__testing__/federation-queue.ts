import { DatabaseSync } from 'node:sqlite';

import { FEDERATION_QUEUE_TABLE, queueFile } from '../store/queue-database.ts';

export function queuedMessages(dataDir: string): unknown[] {
  const db = new DatabaseSync(queueFile(dataDir));
  try {
    return db
      .prepare(`SELECT message FROM ${FEDERATION_QUEUE_TABLE} ORDER BY scheduled`)
      .all()
      .map((row) => JSON.parse(String(row['message'])) as unknown);
  } finally {
    db.close();
  }
}

/** Hold every queued message's ordering key, as a worker killed mid-send leaves it. */
export function lockQueuedOrderingKeys(dataDir: string): void {
  const db = new DatabaseSync(queueFile(dataDir));
  try {
    db.exec(
      `INSERT OR IGNORE INTO ${FEDERATION_QUEUE_TABLE}_locks (ordering_key)
         SELECT DISTINCT ordering_key FROM ${FEDERATION_QUEUE_TABLE} WHERE ordering_key IS NOT NULL`,
    );
  } finally {
    db.close();
  }
}
