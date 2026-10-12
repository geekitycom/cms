import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { Clock } from '../../util/clock.ts';

export type Row = Record<string, unknown>;

export interface IndexDatabase {
  readonly db: DatabaseSync;
  readonly clock: Clock;
  readonly baseUrl: string | undefined;
  readonly spellings: SpellingCache;
  readonly prepared: Map<string, StatementSync>;
}

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

export function cachedStatement(index: IndexDatabase, sql: string): StatementSync {
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
