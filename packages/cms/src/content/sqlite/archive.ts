import { featuredPosts } from '../pinned.ts';
import { dateSortKey } from '../store.ts';
import type { ArchiveReader, DocumentNeighbours, ListByTagOptions } from '../store.ts';
import type { Document } from '../document.ts';
import { authorClause, LISTED_CLAUSE, PINNED_CLAUSE, TERM_TABLES, termFilter } from './clauses.ts';
import type { TermTable } from './clauses.ts';
import { nowKey, cachedStatement } from './database.ts';
import type { IndexDatabase, Row } from './database.ts';
import { hydrate, selectNewestFirst } from './documents.ts';

export function archiveReader(index: IndexDatabase): ArchiveReader {
  return {
    listPosts: (options = {}) =>
      selectNewestFirst(index, ["type = 'post'", LISTED_CLAUSE], [nowKey(index)], options),
    listListed: () => selectNewestFirst(index, [LISTED_CLAUSE], [nowKey(index)], {}),
    listWiki: () => selectNewestFirst(index, ["type = 'wiki'", LISTED_CLAUSE], [nowKey(index)], {}),
    neighbours: (document) => neighbours(index, document),
    listByTag: (tag, options = {}) => selectByTerm(index, TERM_TABLES.tag, tag, options),
    listByCategory: (category, options = {}) =>
      selectByTerm(index, TERM_TABLES.category, category, options),
    listByAuthor: (names, options = {}) =>
      names.length === 0
        ? []
        : selectNewestFirst(
            index,
            ["type = 'post'", LISTED_CLAUSE, authorClause(names)],
            [nowKey(index), ...names],
            options,
          ),
    listPinnedByAuthor: (names) =>
      names.length === 0
        ? []
        : featuredPosts(
            selectNewestFirst(
              index,
              ["type = 'post'", LISTED_CLAUSE, authorClause(names), PINNED_CLAUSE],
              [nowKey(index), ...names],
              {},
            ),
          ),
    countByTag: (tag, options = {}) => countByTerm(index, TERM_TABLES.tag, tag, options),
    countByCategory: (category, options = {}) =>
      countByTerm(index, TERM_TABLES.category, category, options),
    countByAuthor: (names) => countByAuthor(index, names),
  };
}

function neighbours(index: IndexDatabase, document: Document): DocumentNeighbours {
  // A page is nobody's neighbour, and neither is a document the archive
  // does not order: without a date there is no place in the sequence to be
  // either side of.
  const key = dateSortKey(document.date);
  if (document.type !== 'post' || key === null) return {};

  // The listings are ordered by `date_sort DESC, path DESC`, so "before"
  // and "after" are that same pair compared as a row: two posts sharing an
  // instant are separated by their paths exactly as the listing separates
  // them, and the document itself is excluded by the comparison being
  // strict.
  const previous = neighbour(index, '<', 'DESC', key, document.path);
  const next = neighbour(index, '>', 'ASC', key, document.path);

  return {
    ...(previous === undefined ? {} : { previous }),
    ...(next === undefined ? {} : { next }),
  };
}

/**
 * The nearest published post on one side of a point in the archive.
 *
 * `direction` is which way to look — `<` for older, `>` for newer — and
 * `order` is the sort that puts the nearest one first, so one query serves
 * both ends of {@link ArchiveReader.neighbours}.
 */
function neighbour(
  index: IndexDatabase,
  direction: '<' | '>',
  order: 'ASC' | 'DESC',
  key: string,
  contentPath: string,
): Document | undefined {
  const row = cachedStatement(
    index,
    `SELECT * FROM documents
     WHERE type = 'post' AND ${LISTED_CLAUSE}
       AND date_sort IS NOT NULL
       AND (date_sort, path) ${direction} (?, ?)
     ORDER BY date_sort ${order}, path ${order}
     LIMIT 1`,
  ).get(nowKey(index), key, contentPath) as Row | undefined;
  return hydrate(index, row);
}

/**
 * One taxonomy archive: the published, untrashed documents whose term list
 * holds `term`, newest first. Tags and categories are the same query over two
 * tables, so neither can drift from the other.
 */
function selectByTerm(
  index: IndexDatabase,
  terms: TermTable,
  term: string,
  options: ListByTagOptions,
): Document[] {
  const where = [LISTED_CLAUSE, termFilter(terms)];
  const params: unknown[] = [nowKey(index), terms.match(term)];
  if (options.type !== undefined) {
    where.unshift('type = ?');
    params.unshift(options.type);
  }
  return selectNewestFirst(index, where, params, options);
}

/** {@link selectByTerm}'s total, for the pager and the archive's existence. */
function countByTerm(
  index: IndexDatabase,
  terms: TermTable,
  term: string,
  options: ListByTagOptions,
): number {
  const { table, matchColumn } = terms;
  const where = [LISTED_CLAUSE, `${table}.${matchColumn} = ?`];
  const params: unknown[] = [nowKey(index), terms.match(term)];
  if (options.type !== undefined) {
    where.push('documents.type = ?');
    params.push(options.type);
  }
  const row = cachedStatement(
    index,
    `SELECT COUNT(*) AS count FROM ${table}
     JOIN documents ON documents.path = ${table}.path
     WHERE ${where.join(' AND ')}`,
  ).get(...(params as never[])) as Row;
  return Number(row['count']);
}

function countByAuthor(index: IndexDatabase, names: readonly string[]): number {
  if (names.length === 0) return 0;
  const row = index.db
    .prepare(
      `SELECT COUNT(*) AS count FROM documents
       WHERE type = 'post' AND ${LISTED_CLAUSE} AND ${authorClause(names)}`,
    )
    .get(...([nowKey(index), ...names] as never[])) as Row;
  return Number(row['count']);
}
