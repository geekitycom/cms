import type { DocumentLookup } from '../store.ts';
import { SERVED_CLAUSE } from './clauses.ts';
import { nowKey, cachedStatement } from './database.ts';
import type { IndexDatabase, Row } from './database.ts';
import { hydrate } from './documents.ts';

export const BY_PERMALINK_SQL =
  'SELECT * FROM documents WHERE permalink = ? ORDER BY trashed, path DESC LIMIT 1';

export const BY_FORMER_PERMALINK_SQL = `
  SELECT documents.* FROM documents
  JOIN document_redirects ON document_redirects.path = documents.path
  WHERE document_redirects.url = ?
    AND ${SERVED_CLAUSE}
  ORDER BY documents.updated DESC, documents.path DESC
  LIMIT 1
`;

const BY_STORED_OBJECT_ID_SQL = `SELECT * FROM documents WHERE json_extract(activitypub, '$.id') = ? ORDER BY trashed LIMIT 1`;

const BY_SLUG_SQL = `SELECT * FROM documents WHERE slug = ? ORDER BY date_sort DESC, path DESC LIMIT 1`;

export function documentLookup(index: IndexDatabase): DocumentLookup {
  const one = (sql: string, ...params: string[]) =>
    hydrate(index, cachedStatement(index, sql).get(...params) as Row | undefined);
  return {
    getByPath: (contentPath) => one('SELECT * FROM documents WHERE path = ?', contentPath),
    getByPermalink: (permalink) => one(BY_PERMALINK_SQL, permalink),
    getByStoredObjectId: (objectId) =>
      objectId === '' ? undefined : one(BY_STORED_OBJECT_ID_SQL, objectId),
    getByFormerPermalink: (permalink) => one(BY_FORMER_PERMALINK_SQL, permalink, nowKey(index)),
    getBySlug: (slug) => one(BY_SLUG_SQL, slug),
  };
}
