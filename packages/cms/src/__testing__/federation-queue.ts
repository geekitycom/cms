import { DatabaseSync } from 'node:sqlite';

import { FEDERATION_QUEUE_TABLE } from '../federation/queue.ts';
import { queueFile } from '../store/queue-database.ts';

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
