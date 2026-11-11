import type { DatabaseSync } from 'node:sqlite';

/** Where the waiting messages of one ordering key stand in the queue table. */
export interface QueueOrder {
  /** When the key's last waiting message is due, in epoch milliseconds. */
  lastDue(key: string): number | undefined;
  /**
   * Put the key's newest row ahead of its older ones, which keep their order
   * and their gaps behind it.
   */
  moveNewestAhead(key: string): void;
}

/**
 * Over the tables of `SqliteMessageQueue`, which takes the row with the lowest
 * `scheduled` first. A row added later has the higher `rowid`.
 */
export function queueOrder(db: DatabaseSync, tableName: string): QueueOrder {
  return {
    lastDue(key) {
      const last = db
        .prepare(`SELECT MAX(scheduled) AS due FROM "${tableName}" WHERE ordering_key = ?`)
        .get(key)?.['due'];
      return typeof last === 'number' ? last : undefined;
    },

    moveNewestAhead(key) {
      const newest = db
        .prepare(
          `SELECT rowid AS position, scheduled AS due FROM "${tableName}"
            WHERE ordering_key = ? ORDER BY rowid DESC LIMIT 1`,
        )
        .get(key);
      if (newest === undefined) return;
      const position = Number(newest['position']);
      const due = Number(newest['due']);
      const first = db
        .prepare(
          `SELECT MIN(scheduled) AS due FROM "${tableName}"
            WHERE ordering_key = ? AND rowid < ?`,
        )
        .get(key, position)?.['due'];
      if (typeof first !== 'number' || first > due) return;
      db.prepare(
        `UPDATE "${tableName}" SET scheduled = scheduled + ?
          WHERE ordering_key = ? AND rowid < ?`,
      ).run(due + 1 - first, key, position);
    },
  };
}
