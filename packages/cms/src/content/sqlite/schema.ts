import type { Migration } from '../../cache.ts';

/** The table this store's applied versions are recorded in. */
export const LEDGER = 'migrations';

/**
 * Schema versions, applied in order. Never edit a migration that has shipped;
 * append a new one, so a site that upgrades lands on the same schema as a site
 * that starts fresh.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE documents (
        path         TEXT PRIMARY KEY,
        type         TEXT NOT NULL,
        slug         TEXT NOT NULL,
        permalink    TEXT NOT NULL,
        title        TEXT NOT NULL,
        date         TEXT,
        date_sort    TEXT,
        updated      TEXT,
        draft        INTEGER NOT NULL,
        trashed      INTEGER NOT NULL,
        description  TEXT,
        author       TEXT,
        activitypub  TEXT,
        extra        TEXT NOT NULL,
        body         TEXT NOT NULL,
        html         TEXT NOT NULL,
        hash         TEXT NOT NULL
      );

      CREATE UNIQUE INDEX documents_permalink ON documents (permalink);
      CREATE INDEX documents_slug ON documents (slug);
      CREATE INDEX documents_listing ON documents (type, draft, trashed, date_sort DESC);

      CREATE TABLE document_tags (
        path     TEXT NOT NULL REFERENCES documents (path) ON DELETE CASCADE,
        tag      TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (path, tag)
      );

      CREATE INDEX document_tags_tag ON document_tags (tag);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE document_categories (
        path     TEXT NOT NULL REFERENCES documents (path) ON DELETE CASCADE,
        category TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (path, category)
      );

      CREATE INDEX document_categories_category ON document_categories (category);

      -- A file that already carried categories hashes the same as it did
      -- before the key was modelled, so a sync would find every row up to date
      -- and never learn what those files are filed under. Emptying the index
      -- is what makes the next scan read them all again; the files are the
      -- source of truth, so nothing is lost (decision-1).
      DELETE FROM documents;
    `,
  },
  {
    version: 3,
    sql: `
      -- The renderer now puts \`tabindex="0"\` on every \`<pre>\` (TASK-86), so a
      -- wide block of code can be scrolled from the keyboard. The HTML in this
      -- table was rendered by the old one, and the hash covers the file rather
      -- than what was made of it, so a scan would find every row up to date and
      -- serve the old markup for as long as nobody edited the post. Emptying
      -- the index is what makes the next scan render them all again; the files
      -- are the source of truth, so nothing is lost (decision-1).
      DELETE FROM documents;
    `,
  },
  {
    version: 4,
    sql: `
      -- The full-text index (TASK-22): one row per document, keyed by path,
      -- holding the words it is found by. \`porter\` so "running" finds "run",
      -- \`remove_diacritics\` so "cafe" finds "café".
      CREATE VIRTUAL TABLE documents_fts USING fts5 (
        path UNINDEXED,
        title,
        description,
        terms,
        body,
        tokenize = 'porter unicode61 remove_diacritics 2'
      );

      -- The body is indexed as the text of its rendered HTML, which SQL cannot
      -- work out from the row, and the hash covers the file rather than the
      -- index, so a scan would find every row up to date and never fill the
      -- table. Emptying the index is what makes the next scan index them all;
      -- the files are the source of truth, so nothing is lost (decision-1).
      DELETE FROM documents;
    `,
  },
  {
    version: 5,
    sql: `
      -- \`in-reply-to\` is modelled now (TASK-121). A file that already had one
      -- kept it in \`extra\`, and may hash the same as it did, so a scan would
      -- leave the row alone and never learn the post is a reply. Emptying the
      -- index is what makes the next scan read them all again; the files are
      -- the source of truth, so nothing is lost (decision-1).
      ALTER TABLE documents ADD COLUMN in_reply_to TEXT;
      DELETE FROM documents;
    `,
  },
  {
    version: 6,
    sql: `
      -- The URLs a document used to live at, from its \`redirect_from\` (TASK-127),
      -- so an old URL is one indexed lookup. A file that already carried the
      -- key kept it in \`extra\` and hashes the same, so a scan would never
      -- index it; emptying the index makes the next scan read every file again,
      -- and the files are the source of truth, so nothing is lost (decision-1).
      CREATE TABLE document_redirects (
        path     TEXT NOT NULL REFERENCES documents (path) ON DELETE CASCADE,
        url      TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (path, url)
      );

      CREATE INDEX document_redirects_url ON document_redirects (url);
      DELETE FROM documents;
    `,
  },
  {
    version: 7,
    sql: `
      -- A trashed document gives its URL up to a live one (TASK-195), so the
      -- permalink is unique among untrashed rows only. The plain index stays
      -- for lookups, which ask about trashed rows too.
      DROP INDEX documents_permalink;
      CREATE UNIQUE INDEX documents_permalink_live ON documents (permalink) WHERE trashed = 0;
      CREATE INDEX documents_permalink ON documents (permalink);
    `,
  },
  {
    version: 8,
    sql: `
      -- Tags match without regard to case (TASK-308): each row carries its
      -- key, the tag in lower case, which JavaScript works out because
      -- SQLite's lower() folds ASCII only. A document carries a tag once
      -- whatever its casing. The rows already here have no key, and their
      -- files hash the same, so emptying the index is what makes the next
      -- scan write them again; the files are the source of truth (decision-1).
      DROP TABLE document_tags;
      CREATE TABLE document_tags (
        path     TEXT NOT NULL REFERENCES documents (path) ON DELETE CASCADE,
        tag      TEXT NOT NULL,
        key      TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (path, key)
      );
      CREATE INDEX document_tags_key ON document_tags (key);
      DELETE FROM documents;
    `,
  },
  {
    version: 9,
    sql: `
      -- A thread finds the reply posts answering it by their \`in-reply-to\`
      -- (TASK-300).
      CREATE INDEX documents_in_reply_to ON documents (in_reply_to);
    `,
  },
  {
    version: 10,
    sql: `
      -- What a \`/replies/\` key names (TASK-327), so resolving one is a lookup
      -- rather than a walk of the site. The keys hang off the base URL, which
      -- a migration does not know: the rows are filled when the store is
      -- opened with one, as they are whenever that base changes.
      ALTER TABLE documents ADD COLUMN replies_key TEXT;
      ALTER TABLE documents ADD COLUMN reply_post_key TEXT;
      ALTER TABLE documents ADD COLUMN keys_base TEXT;
      CREATE INDEX documents_replies_key ON documents (replies_key);
      CREATE INDEX documents_reply_post_key ON documents (reply_post_key);
    `,
  },
  {
    version: 11,
    sql: `
      -- The pages of the site each document links to (TASK-322), as the paths
      -- the links name rather than the documents they lead to, which are
      -- matched when a document's backlinks are read. A link keeps its query
      -- (TASK-330), sorted as a redirect source's is, because the site answers
      -- \`/?p=7\` with a redirect rather than with \`/\`. Like the \`/replies/\`
      -- keys they are read against the base URL, so forgetting every row's
      -- base is what makes the next open with one fill them from the stored
      -- HTML, with no scan of the files.
      CREATE TABLE document_links (
        path   TEXT NOT NULL REFERENCES documents (path) ON DELETE CASCADE,
        target TEXT NOT NULL,
        query  TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (path, target, query)
      );
      CREATE INDEX document_links_target ON document_links (target);
      UPDATE documents SET keys_base = NULL;
    `,
  },
];
