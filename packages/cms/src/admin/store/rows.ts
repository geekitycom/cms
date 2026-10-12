import type { DatabaseSync } from 'node:sqlite';

/** How {@link FollowerStore.listFollowers} and its inbox-log sibling page. */
export interface ListPageOptions {
  /** Largest number of rows to return. Everything, when it is not given. */
  limit?: number | undefined;
  /** How many rows to skip first. Zero when it is not given. */
  offset?: number | undefined;
}

/**
 * What a `LIMIT` means when the caller named none. SQLite reads a negative
 * limit as "every row", which is what an unpaged list asks for.
 */
export const NO_LIMIT = -1;

/**
 * A `TEXT` column that may be `NULL`, as a string or `null`.
 *
 * Anything that is not text is read as `null` rather than stringified: every
 * column this is used on is declared `TEXT`, so a value of another shape is a
 * row somebody else wrote, and `[object Object]` is a worse answer than none.
 */
export function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A stored enumeration value, or the fallback for one this version does not know. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function countByStatus<S extends string>(
  rows: readonly Record<string, unknown>[],
  statuses: readonly S[],
  statusOf: (value: unknown) => S,
): Record<S, number> {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<S, number>;
  for (const row of rows) counts[statusOf(row['status'])] += Number(row['count'] ?? 0);
  return counts;
}

/**
 * Run a body with every write in it committed together, or none of them.
 *
 * The rebuilds are what need it: emptying an index and filling it again is
 * one step to everything reading it, and a half-emptied `followers` is a
 * site that has quietly stopped delivering to half its followers.
 */
export function inTransaction(db: DatabaseSync, body: () => void): void {
  db.exec('BEGIN');
  try {
    body();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
