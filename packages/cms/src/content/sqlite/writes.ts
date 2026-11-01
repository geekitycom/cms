import { absoluteUrl } from '../../util/url.ts';
import type { Document } from '../document.ts';
import { searchText } from '../search.ts';
import { ownSiteLinks } from '../site-links.ts';
import { DuplicatePermalinkError } from '../store.ts';
import type { IndexWriter } from '../store.ts';
import { tagKey, uniqueTags } from '../tags.ts';
import { aliasPathsOf } from '../wiki-aliases.ts';
import { inTransaction, cachedStatement, stringOrUndefined } from './database.ts';
import type { IndexDatabase, Row } from './database.ts';
import { repliesKeysOf, toDocument, toRow } from './rows.ts';
import { forgetSpellings, markTagsStaleBeforeWrite } from './spellings.ts';

const UPSERT_SQL = `
  INSERT INTO documents (
    path, type, slug, permalink, title, date, date_sort, updated, draft, trashed,
    description, author, in_reply_to, activitypub, extra, body, html, hash,
    replies_key, reply_post_key, keys_base
  ) VALUES (
    :path, :type, :slug, :permalink, :title, :date, :date_sort, :updated, :draft, :trashed,
    :description, :author, :in_reply_to, :activitypub, :extra, :body, :html, :hash,
    :replies_key, :reply_post_key, :keys_base
  )
  ON CONFLICT (path) DO UPDATE SET
    type = excluded.type,
    slug = excluded.slug,
    permalink = excluded.permalink,
    title = excluded.title,
    date = excluded.date,
    date_sort = excluded.date_sort,
    updated = excluded.updated,
    draft = excluded.draft,
    trashed = excluded.trashed,
    description = excluded.description,
    author = excluded.author,
    in_reply_to = excluded.in_reply_to,
    activitypub = excluded.activitypub,
    extra = excluded.extra,
    body = excluded.body,
    html = excluded.html,
    hash = excluded.hash,
    replies_key = excluded.replies_key,
    reply_post_key = excluded.reply_post_key,
    keys_base = excluded.keys_base
`;

const WRITE_KEYS_SQL = `
  UPDATE documents
  SET replies_key = :replies_key, reply_post_key = :reply_post_key, keys_base = :keys_base
  WHERE path = :path
`;

export function indexWriter(index: IndexDatabase): IndexWriter {
  return {
    upsert: (document) => writeDocument(index, document),
    upsertAll: (documents) =>
      inTransaction(index.db, () => {
        for (const document of documents) writeDocument(index, document);
      }),
    remove: (contentPath) => removeDocument(index, contentPath),
    clear: () => clearIndex(index),
  };
}

/**
 * Work out again everything worked out against another base, or none: the
 * `/replies/` keys and the links to the site's own pages.
 */
export function refreshAgainstBase(index: IndexDatabase, baseUrl: string): void {
  inTransaction(index.db, () => {
    const rows = cachedStatement(index, 'SELECT * FROM documents WHERE keys_base IS NOT ?').all(
      baseUrl,
    ) as Row[];
    for (const row of rows) {
      const document = toDocument(row, [], []);
      cachedStatement(index, WRITE_KEYS_SQL).run({
        path: document.path,
        ...repliesKeysOf(document, baseUrl),
      });
      writeLinks(index, document, baseUrl);
    }
  });
}

function writeDocument(index: IndexDatabase, document: Document): void {
  const contentPath = document.path;
  markTagsStaleBeforeWrite(index, contentPath);
  for (const tag of document.tags) index.spellings.staleKeys.add(tagKey(tag));
  try {
    cachedStatement(index, UPSERT_SQL).run({
      ...toRow(document),
      ...repliesKeysOf(document, index.baseUrl),
    });
  } catch (error) {
    throw translateWriteError(index, error, document);
  }
  writeTerms(index, document);
  writeLinks(index, document, index.baseUrl);
  writeWords(index, document);
}

function writeTerms(index: IndexDatabase, document: Document): void {
  const contentPath = document.path;
  cachedStatement(index, 'DELETE FROM document_tags WHERE path = ?').run(contentPath);
  uniqueTags(document.tags).forEach((tag, position) => {
    cachedStatement(
      index,
      'INSERT INTO document_tags (path, tag, key, position) VALUES (?, ?, ?, ?)',
    ).run(contentPath, tag, tagKey(tag), position);
  });
  cachedStatement(index, 'DELETE FROM document_categories WHERE path = ?').run(contentPath);
  document.categories.forEach((category, position) => {
    cachedStatement(
      index,
      'INSERT INTO document_categories (path, category, position) VALUES (?, ?, ?)',
    ).run(contentPath, category, position);
  });
  cachedStatement(index, 'DELETE FROM document_redirects WHERE path = ?').run(contentPath);
  (document.redirectFrom ?? []).forEach((url, position) => {
    cachedStatement(
      index,
      'INSERT INTO document_redirects (path, url, position) VALUES (?, ?, ?)',
    ).run(contentPath, url, position);
  });
  cachedStatement(index, 'DELETE FROM document_aliases WHERE path = ?').run(contentPath);
  for (const url of aliasPathsOf(document)) {
    cachedStatement(index, 'INSERT INTO document_aliases (path, url) VALUES (?, ?)').run(
      contentPath,
      url,
    );
  }
}

/**
 * Replaced rather than updated, because an FTS5 table has no key to conflict
 * on: the path is only a column in it.
 */
function writeWords(index: IndexDatabase, document: Document): void {
  const words = searchText(document);
  cachedStatement(index, 'DELETE FROM documents_fts WHERE path = ?').run(document.path);
  cachedStatement(
    index,
    'INSERT INTO documents_fts (path, title, description, terms, body) VALUES (?, ?, ?, ?, ?)',
  ).run(document.path, words.title, words.description, words.terms, words.body);
}

function writeLinks(index: IndexDatabase, document: Document, baseUrl: string | undefined): void {
  cachedStatement(index, 'DELETE FROM document_links WHERE path = ?').run(document.path);
  if (baseUrl === undefined) return;
  const pageUrl = absoluteUrl(document.permalink, baseUrl);
  for (const { path, query } of ownSiteLinks(document.html, pageUrl, baseUrl)) {
    cachedStatement(index, 'INSERT INTO document_links (path, target, query) VALUES (?, ?, ?)').run(
      document.path,
      path,
      query,
    );
  }
}

function removeDocument(index: IndexDatabase, contentPath: string): boolean {
  markTagsStaleBeforeWrite(index, contentPath);
  // Nothing cascades into a virtual table, so the words go by hand.
  cachedStatement(index, 'DELETE FROM documents_fts WHERE path = ?').run(contentPath);
  return (
    cachedStatement(index, 'DELETE FROM documents WHERE path = ?').run(contentPath).changes > 0
  );
}

function clearIndex(index: IndexDatabase): void {
  forgetSpellings(index);
  inTransaction(index.db, () => {
    // All of them by name. The side tables would go with the documents
    // through their foreign keys, but a virtual table has none to cascade
    // through — and a clear that depended on a pragma being on for half of
    // what it empties would be a clear that half worked.
    index.db.exec('DELETE FROM documents_fts');
    index.db.exec('DELETE FROM document_tags');
    index.db.exec('DELETE FROM document_categories');
    index.db.exec('DELETE FROM document_redirects');
    index.db.exec('DELETE FROM document_aliases');
    index.db.exec('DELETE FROM document_links');
    index.db.exec('DELETE FROM documents');
  });
}

/**
 * Turn SQLite's unique-constraint message into something a site owner can act
 * on. Everything else is rethrown untouched.
 */
function translateWriteError(index: IndexDatabase, error: unknown, document: Document): unknown {
  if (!isUniqueViolation(error, 'documents.permalink')) return error;

  const row = cachedStatement(
    index,
    'SELECT path FROM documents WHERE permalink = ? AND trashed = 0',
  ).get(document.permalink) as Row | undefined;
  return new DuplicatePermalinkError(
    document.permalink,
    document.path,
    stringOrUndefined(row?.['path']),
  );
}

function isUniqueViolation(error: unknown, column: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== 'ERR_SQLITE_ERROR') return false;
  return error.message.includes('UNIQUE constraint failed') && error.message.includes(column);
}
