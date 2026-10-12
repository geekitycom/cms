import type { CatalogReader, ListAllOptions } from '../store.ts';
import type { Document } from '../document.ts';
import {
  DUE_CLAUSE,
  FEDERATED_CLAUSE,
  LISTED_CLAUSE,
  SCHEDULED_CLAUSE,
  TERM_TABLES,
  termFilter,
} from './clauses.ts';
import { nowKey, cachedStatement } from './database.ts';
import type { IndexDatabase, Row } from './database.ts';
import { selectNewestFirst } from './documents.ts';

const COUNTS_SQL = `
  SELECT
    COUNT(*) AS total,
    COALESCE(SUM(type = 'post' AND ${LISTED_CLAUSE}), 0) AS posts,
    COALESCE(SUM(type = 'page' AND ${LISTED_CLAUSE}), 0) AS pages,
    COALESCE(SUM(draft = 1 AND trashed = 0), 0) AS drafts,
    COALESCE(SUM(draft = 0 AND trashed = 0 AND ${SCHEDULED_CLAUSE}), 0) AS scheduled,
    COALESCE(SUM(trashed = 1), 0) AS trashed
  FROM documents
`;

export function catalogReader(index: IndexDatabase): CatalogReader {
  return {
    listAll: (options = {}) => listAll(index, options),
    listFederated: (options = {}) =>
      selectNewestFirst(index, [`type = 'post'`, FEDERATED_CLAUSE], [], options),
    listPaths: () =>
      cachedStatement(index, 'SELECT path FROM documents ORDER BY path')
        .all()
        .map((row) => String(row['path'])),
    counts() {
      const now = nowKey(index);
      const row = cachedStatement(index, COUNTS_SQL).get(now, now, now) as Row;
      return {
        total: Number(row['total']),
        posts: Number(row['posts']),
        pages: Number(row['pages']),
        drafts: Number(row['drafts']),
        scheduled: Number(row['scheduled']),
        trashed: Number(row['trashed']),
      };
    },
  };
}

function listAll(index: IndexDatabase, options: ListAllOptions): Document[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.type !== undefined) {
    where.push('type = ?');
    params.push(options.type);
  }
  if (options.draft !== undefined) {
    where.push('draft = ?');
    params.push(options.draft ? 1 : 0);
  }
  where.push('trashed = ?');
  params.push(options.trashed === true ? 1 : 0);
  if (options.scheduled !== undefined) {
    where.push(options.scheduled ? SCHEDULED_CLAUSE : DUE_CLAUSE);
    params.push(nowKey(index));
  }

  if (options.tag !== undefined) {
    where.push(termFilter(TERM_TABLES.tag));
    params.push(TERM_TABLES.tag.match(options.tag));
  }
  if (options.category !== undefined) {
    where.push(termFilter(TERM_TABLES.category));
    params.push(TERM_TABLES.category.match(options.category));
  }

  return selectNewestFirst(index, where, params, options);
}
