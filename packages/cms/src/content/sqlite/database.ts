import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { Clock } from '../store.ts';

/** One row as `node:sqlite` hands it back. */
export type Row = Record<string, unknown>;

/**
 * The open index every query function is handed: the connection, its clock,
 * the base URL its keys and links are worked out against, and the tag
 * spellings it has worked out so far.
 */
export interface IndexDatabase {
  readonly db: DatabaseSync;
  readonly clock: Clock;
  readonly baseUrl: string | undefined;
  readonly spellings: SpellingCache;
  readonly prepared: Map<string, StatementSync>;
}

/** The site's spelling of each tag key, and the keys a write has made stale. */
export interface SpellingCache {
  current: CachedSpellings | undefined;
  readonly staleKeys: Set<string>;
}

export interface CachedSpellings {
  readonly byKey: Map<string, string>;
  readonly dataVersion: unknown;
  readonly workedOutAt: string;
  readonly nextScheduledAt: string | undefined;
}

/** The statement for a fixed piece of SQL, prepared the first time it is asked for. */
export function statement(index: IndexDatabase, sql: string): StatementSync {
  const cached = index.prepared.get(sql);
  if (cached !== undefined) return cached;
  const prepared = index.db.prepare(sql);
  index.prepared.set(sql, prepared);
  return prepared;
}

/** The clock as the index sorts dates, so the two compare as strings. */
export function nowKey(index: IndexDatabase): string {
  return index.clock().toISOString();
}

/** Run `work` in one transaction, rolled back if it throws. */
export function inTransaction(db: DatabaseSync, work: () => void): void {
  db.exec('BEGIN');
  try {
    work();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
