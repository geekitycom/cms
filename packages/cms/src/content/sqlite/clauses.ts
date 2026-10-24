import { PINNED_FRONT_MATTER_KEY } from '../pinned.ts';
import type { ListOptions } from '../store.ts';
import { tagKey } from '../tags.ts';
import type { Taxonomy } from '../taxonomy.ts';
import { VISIBILITIES, VISIBILITY_FRONT_MATTER_KEY } from '../visibility.ts';

/**
 * The clause every public query carries: a document is public only once its
 * date has arrived.
 *
 * A document with no date — or one nobody can read — has nothing to wait for
 * and is public straight away, which is what keeps an undated page out of the
 * scheduling rule without a second predicate. The value compared against is a
 * `dateSortKey` of the clock, so the comparison is between two UTC ISO
 * strings and lexicographic order is chronological order.
 */
export const DUE_CLAUSE = '(date_sort IS NULL OR date_sort <= ?)';

/** The reverse: a document whose date is still ahead of the clock. */
export const SCHEDULED_CLAUSE = '(date_sort IS NOT NULL AND date_sort > ?)';

export const NEXT_DUE_SQL = `
  SELECT MIN(date_sort) AS due FROM documents
  WHERE draft = 0 AND trashed = 0 AND ${SCHEDULED_CLAUSE}
`;

const VISIBILITY_SQL = `COALESCE(json_extract(extra, '$.${VISIBILITY_FRONT_MATTER_KEY}'), 'public')`;

export const SERVED_CLAUSE = `(draft = 0 AND trashed = 0 AND ${DUE_CLAUSE} AND ${VISIBILITY_SQL} IN (${VISIBILITIES.map((visibility) => `'${visibility}'`).join(', ')}))`;

export const LISTED_CLAUSE = `(${SERVED_CLAUSE} AND ${VISIBILITY_SQL} = 'public')`;

/**
 * A document whose front matter carries a `pinned` key that is not `false`.
 * Which moment it was pinned at, and whether it is readable at all, is
 * `content/pinned.ts`'s to decide; this only keeps the rest of an archive from
 * being hydrated to find out.
 */
export const PINNED_CLAUSE = `COALESCE(json_extract(extra, '$.${PINNED_FRONT_MATTER_KEY}'), 0) NOT IN (0, '')`;

/**
 * The clause that picks out a document some follower holds a copy of: one
 * whose `activitypub` block records when it was announced.
 *
 * `published` rather than `id`, because a post's id is its
 * permalink and is never written into the file: the announcement date is the
 * only mark a delivery leaves, and it is the one thing that says a follower
 * was ever told. The block is stored as JSON rather than shredded into
 * columns, so the date is read back out of it here. An empty value is no
 * value: the front matter is a file somebody may have typed, and
 * `activitypub: {published: ""}` is what a half-finished hand edit looks like.
 */
export const FEDERATED_CLAUSE = `COALESCE(json_extract(activitypub, '$.published'), '') <> ''`;

export interface TermTable {
  readonly table: 'document_tags' | 'document_categories';
  readonly matchColumn: 'key' | 'category';
  readonly column: 'tag' | 'category';
  readonly match: (term: string) => string;
}

export const TERM_TABLES: Readonly<Record<Taxonomy, TermTable>> = {
  tag: { table: 'document_tags', matchColumn: 'key', column: 'tag', match: tagKey },
  category: {
    table: 'document_categories',
    matchColumn: 'category',
    column: 'category',
    match: (category) => category,
  },
};

export function termFilter({ table, matchColumn }: TermTable): string {
  return `path IN (SELECT path FROM ${table} WHERE ${matchColumn} = ?)`;
}

/**
 * `author IN (?, ?, …)`, with one placeholder per name.
 *
 * Only the count of the names is interpolated; every name itself is a bound
 * parameter, so a display name holding a quote is a string to match rather
 * than anything SQLite reads as syntax.
 */
export function authorClause(names: readonly string[]): string {
  return `author IN (${names.map(() => '?').join(', ')})`;
}

export function limitClause(options: ListOptions): string {
  if (options.limit === undefined && options.offset === undefined) return '';
  return 'LIMIT ? OFFSET ?';
}

export function limitParams(options: ListOptions): never[] {
  if (options.limit === undefined && options.offset === undefined) return [];
  return [options.limit ?? -1, options.offset ?? 0] as never[];
}
