import { searchExpression, SNIPPET_CLOSE, SNIPPET_OPEN } from '../search.ts';
import type { SearchReader } from '../store.ts';
import { LISTED_CLAUSE } from './clauses.ts';
import { nowKey, cachedStatement } from './database.ts';
import type { IndexDatabase, Row } from './database.ts';
import { hydrateAll } from './documents.ts';

/**
 * The public side of a search: the full-text match joined to the documents it
 * indexes, held to exactly what every public listing is held to.
 *
 * The draft, trash and due clauses are applied to the documents table rather
 * than indexed alongside the words, so a post that is drafted, trashed or
 * pushed into the future drops out of the results the moment the listings drop
 * it, with no second write to keep in step.
 */
const SEARCH_FROM = `
  FROM documents_fts
  JOIN documents ON documents.path = documents_fts.path
  WHERE documents_fts MATCH ?
    AND ${LISTED_CLAUSE}
`;

/**
 * How much a match in each column of the index counts, in the order the table
 * declares them: the path is not indexed, a title match counts for most, the
 * description and the taxonomy for half as much, and the body for least.
 */
const SEARCH_WEIGHTS = '0.0, 10.0, 5.0, 5.0, 1.0';

const SEARCH_SQL = `
  SELECT documents.*,
    snippet(documents_fts, -1, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '…', 24) AS snippet
  ${SEARCH_FROM}
  ORDER BY bm25(documents_fts, ${SEARCH_WEIGHTS}), documents.date_sort DESC, documents.path DESC
  LIMIT ? OFFSET ?
`;

export function searchReader(index: IndexDatabase): SearchReader {
  return {
    search(query, options = {}) {
      const expression = searchExpression(query);
      if (expression === undefined) return [];
      const rows = cachedStatement(index, SEARCH_SQL).all(
        expression,
        nowKey(index),
        options.limit ?? -1,
        options.offset ?? 0,
      ) as Row[];
      return hydrateAll(index, rows).map((document, position) => ({
        document,
        snippet: String(rows[position]?.['snippet']),
      }));
    },

    countSearch(query) {
      const expression = searchExpression(query);
      if (expression === undefined) return 0;
      const row = cachedStatement(index, `SELECT COUNT(*) AS count ${SEARCH_FROM}`).get(
        expression,
        nowKey(index),
      ) as Row;
      return Number(row['count']);
    },
  };
}
