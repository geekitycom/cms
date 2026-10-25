import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';

export interface ListPageOptions {
  limit?: number | undefined;
  offset?: number | undefined;
}

/** One page of a search, and how many rows match it on every page. */
export interface Page<T> {
  readonly total: number;
  readonly items: T[];
}

/**
 * What a `LIMIT` means when the caller named none. SQLite reads a negative
 * limit as "every row", which is what an unpaged list asks for.
 */
export const NO_LIMIT = -1;

export type Row = Record<string, unknown>;

export function allRows<T>(
  statement: StatementSync,
  map: (row: Row) => T,
  ...parameters: SQLInputValue[]
): T[] {
  return statement.all(...parameters).map(map);
}

export function getRow<T>(
  statement: StatementSync,
  map: (row: Row) => T,
  ...parameters: SQLInputValue[]
): T | undefined {
  const row = statement.get(...parameters);
  return row === undefined ? undefined : map(row);
}

export function readCount(statement: StatementSync, ...parameters: SQLInputValue[]): number {
  return getRow(statement, (row) => Number(row['count'] ?? 0), ...parameters) ?? 0;
}

export function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function countByStatus<S extends string>(
  rows: readonly Row[],
  statuses: readonly S[],
  statusOf: (value: unknown) => S,
): Record<S, number> {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<S, number>;
  for (const row of rows) counts[statusOf(row['status'])] += Number(row['count'] ?? 0);
  return counts;
}

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
