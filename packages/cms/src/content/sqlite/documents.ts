import type { Document } from '../document.ts';
import type { ListOptions } from '../store.ts';
import { limitClause, limitParams } from './clauses.ts';
import { cachedStatement } from './database.ts';
import type { IndexDatabase, Row } from './database.ts';
import { groupByPath, toDocument } from './rows.ts';
import { siteSpellings } from './spellings.ts';

const TAGS_FOR_PATHS_SQL =
  'SELECT path, tag, key FROM document_tags WHERE path IN (SELECT value FROM json_each(?)) ORDER BY path, position';
const CATEGORIES_FOR_PATHS_SQL =
  'SELECT path, category FROM document_categories WHERE path IN (SELECT value FROM json_each(?)) ORDER BY path, position';
const REDIRECTS_FOR_PATHS_SQL =
  'SELECT path, url FROM document_redirects WHERE path IN (SELECT value FROM json_each(?)) ORDER BY path, position';

export function hydrate(index: IndexDatabase, row: Row | undefined): Document | undefined {
  return row === undefined ? undefined : hydrateAll(index, [row])[0];
}

/**
 * Rows as documents, their tags, categories and former permalinks read in
 * one query each for the whole list: a listing of the entire site costs
 * four queries, not three more per document.
 */
export function hydrateAll(index: IndexDatabase, rows: Row[]): Document[] {
  if (rows.length === 0) return [];
  const paths = JSON.stringify(rows.map((row) => String(row['path'])));
  const spellings = siteSpellings(index);
  const tags = groupByPath(
    cachedStatement(index, TAGS_FOR_PATHS_SQL).all(paths),
    (row) => spellings.get(String(row['key'])) ?? String(row['tag']),
  );
  const categories = groupByPath(
    cachedStatement(index, CATEGORIES_FOR_PATHS_SQL).all(paths),
    (row) => String(row['category']),
  );
  const redirects = groupByPath(cachedStatement(index, REDIRECTS_FOR_PATHS_SQL).all(paths), (row) =>
    String(row['url']),
  );

  return rows.map((row) => {
    const contentPath = String(row['path']);
    const redirectFrom = redirects.get(contentPath);
    return {
      ...toDocument(row, tags.get(contentPath) ?? [], categories.get(contentPath) ?? []),
      ...(redirectFrom === undefined ? {} : { redirectFrom }),
    };
  });
}

export function selectNewestFirst(
  index: IndexDatabase,
  where: string[],
  params: unknown[],
  options: ListOptions,
): Document[] {
  const clause = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
  const rows = index.db
    .prepare(
      `SELECT * FROM documents ${clause} ORDER BY date_sort DESC, path DESC ${limitClause(options)}`,
    )
    .all(...(params as never[]), ...limitParams(options));
  return hydrateAll(index, rows as Row[]);
}
