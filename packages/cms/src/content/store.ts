import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';

import type { ActivityPubMetadata, Document, DocumentType } from './document.ts';

/** File name of the derived index inside a site's data directory. */
export const DATABASE_FILE = 'geekity.db';

/** Directory name that marks a document as thrown away but not yet deleted. */
export const TRASH_DIRECTORY = '_trash';

/**
 * What the index reads the time from.
 *
 * A post's date decides whether it is public yet, so the index has a clock;
 * this is the seam that lets a test move it without waiting.
 */
export type Clock = () => Date;

/** The clock an index uses when it is not given one. */
export const systemClock: Clock = () => new Date();

/** Where {@link openContentStore} puts the database. */
export interface OpenContentStoreOptions {
  /** Directory the database lives in. Created if it is missing. */
  dataDir: string;
  /**
   * What "now" means to the public queries, for the scheduling clause. Defaults
   * to {@link systemClock}; a test hands one it can move.
   */
  now?: Clock | undefined;
}

/**
 * The derived index over the Markdown files.
 *
 * Files are the source of truth (decision-1); this is a queryable copy that
 * answers the questions a directory walk cannot answer cheaply. Deleting the
 * database is safe because the next boot rebuilds it.
 */
export interface ContentStore {
  /** Absolute path of the SQLite file. */
  readonly file: string;
  /**
   * What the index thinks the time is: the instant every public query holds a
   * future-dated document against.
   *
   * It is here so that a caller applying the same rule outside SQL — the
   * public site deciding whether to serve a permalink, the admin deciding
   * whether to offer a View link — asks the same clock the listings did, and
   * so a test that moves the index's clock moves theirs with it.
   */
  now(): Date;
  /**
   * Insert or replace the row for `document.path`, tags and categories
   * included.
   *
   * Throws {@link DuplicatePermalinkError} when another path already claims
   * the same permalink.
   */
  upsert(document: Document): void;
  /** {@link ContentStore.upsert} for many documents, in one transaction. */
  upsertAll(documents: Iterable<Document>): void;
  /** Drop a document by path. Returns `false` when there was nothing to drop. */
  remove(path: string): boolean;
  /** The document at a content-relative path, or `undefined`. */
  getByPath(path: string): Document | undefined;
  /** The document a URL resolves to, or `undefined`. Permalinks are unique. */
  getByPermalink(permalink: string): Document | undefined;
  /**
   * The document with this slug, or `undefined`. Slugs are not unique across
   * years, so the newest match wins.
   */
  getBySlug(slug: string): Document | undefined;
  /** Published, untrashed, already-due posts, newest first. */
  listPosts(options?: ListOptions): Document[];
  /**
   * When the next scheduled document becomes public, as the UTC instant the
   * index sorts by, or `undefined` when nothing is waiting.
   *
   * What a scheduler sets its timer from: one indexed lookup rather than a
   * walk of the archive.
   */
  nextDue(): string | undefined;
  /**
   * Published, untrashed documents whose date falls in `(after, now]`, oldest
   * first: everything that has come due since a scheduler last looked.
   *
   * Oldest first because they are announced in the order they became public,
   * and a follower should be told about the older post first.
   */
  listDueSince(after: string): Document[];
  /** Published, untrashed documents carrying a tag, newest first. */
  listByTag(tag: string, options?: ListByTagOptions): Document[];
  /** Published, untrashed documents filed under a category, newest first. */
  listByCategory(category: string, options?: ListByTagOptions): Document[];
  /** Everything the admin may see, trash and drafts included unless filtered. */
  listAll(options?: ListAllOptions): Document[];
  /**
   * Posts the site has announced to the fediverse: the ones whose front matter
   * carries an `activitypub.id`, newest first, drafts, scheduled posts and the
   * trash included.
   *
   * The federation screen's row source, and the reason the filter is a query
   * rather than a walk of {@link ContentStore.listAll}: a draft and a trashed
   * post belong on that screen — they are what a `Delete` is sent for — so the
   * only thing that decides the list is whether an id was ever written into
   * the file, which is the same thing as whether a follower holds a copy.
   */
  listFederated(options?: ListOptions): Document[];
  /** Every indexed path, sorted. What a sync compares the content tree against. */
  listPaths(): string[];
  /** How many documents there are of each kind. */
  counts(): ContentCounts;
  /** How many published, untrashed documents carry a tag. */
  countByTag(tag: string, options?: ListByTagOptions): number;
  /** Every tag in use on published, untrashed documents, with its count. */
  listTags(): TagCount[];
  /** How many published, untrashed documents are filed under a category. */
  countByCategory(category: string, options?: ListByTagOptions): number;
  /** Every category in use on published, untrashed documents, with its count. */
  listCategories(): CategoryCount[];
  /**
   * Every term in use in one taxonomy, in alphabetical order, with the number
   * of documents the public site lists under it and the number of files
   * carrying it at all.
   *
   * The second count is the one the taxonomy screens act on: renaming a term
   * rewrites every file that carries it, drafts, scheduled posts and the trash
   * included, so a screen that only showed the public count would understate
   * what a rename is about to touch. Alphabetical because it is a list to find
   * a term in rather than a list of what a site writes about, which is what
   * {@link ContentStore.listTags} is for.
   */
  listTermUsage(taxonomy: TaxonomyName): TermUsage[];
  /** Close the database. Safe to call twice. */
  close(): void;
}

/** Paging for the public listings. */
export interface ListOptions {
  /** How many documents to return. Defaults to everything. */
  limit?: number | undefined;
  /** How many to skip first. Defaults to 0. */
  offset?: number | undefined;
}

/** Paging plus the type filter the taxonomy archives need. */
export interface ListByTagOptions extends ListOptions {
  /** Restrict to posts or pages. Defaults to both. */
  type?: DocumentType | undefined;
}

/** Filters for the admin listing, which is the only view of the trash. */
export interface ListAllOptions extends ListOptions {
  /** Restrict to posts or pages. Defaults to both. */
  type?: DocumentType | undefined;
  /** `true` for drafts only, `false` for published only. Defaults to both. */
  draft?: boolean | undefined;
  /** `true` for trashed only, `false` for live only. Defaults to live only. */
  trashed?: boolean | undefined;
  /**
   * `true` for documents whose date has not arrived, `false` for those already
   * due. Defaults to both, which is what the admin's "All" view shows.
   */
  scheduled?: boolean | undefined;
  /** Restrict to documents carrying this tag. */
  tag?: string | undefined;
  /** Restrict to documents filed under this category. */
  category?: string | undefined;
}

/** What {@link ContentStore.counts} reports. */
export interface ContentCounts {
  /** Every indexed document, trash included. */
  total: number;
  /** Published, untrashed, already-due posts: the size of the public archive. */
  posts: number;
  /** Published, untrashed, already-due pages. */
  pages: number;
  /** Untrashed drafts of either type. */
  drafts: number;
  /** Untrashed non-drafts of either type whose date has not arrived yet. */
  scheduled: number;
  /** Documents under `_trash/`. */
  trashed: number;
}

/** One tag and how many published documents carry it. */
export interface TagCount {
  tag: string;
  count: number;
}

/** One category and how many published documents are filed under it. */
export interface CategoryCount {
  category: string;
  count: number;
}

/**
 * Which of the two taxonomies a query is about.
 *
 * Spelled here rather than imported from `web/taxonomy.ts` because the index
 * is underneath the web layer and should not depend on it; the two types are
 * the same union, so they are assignable to each other.
 */
export type TaxonomyName = 'tag' | 'category';

/** One term, and how much of the site carries it. */
export interface TermUsage {
  /** The term itself, as the files spell it. */
  term: string;
  /** Documents the public site lists under it: published, untrashed, due. */
  published: number;
  /** Every file carrying it, drafts, scheduled posts and the trash included. */
  total: number;
}

/**
 * Thrown when two files claim the same permalink. Two documents at one URL is
 * a content mistake the site owner has to fix, so the index refuses it rather
 * than picking a winner.
 */
export class DuplicatePermalinkError extends Error {
  override readonly name = 'DuplicatePermalinkError';
  /** The permalink both documents claim. */
  readonly permalink: string;
  /** The path that was being indexed. */
  readonly path: string;
  /** The path that already held the permalink, when it could be looked up. */
  readonly conflictingPath: string | undefined;

  constructor(permalink: string, path: string, conflictingPath: string | undefined) {
    const owner = conflictingPath === undefined ? 'another document' : `"${conflictingPath}"`;
    super(
      `Cannot index "${path}": its permalink ${permalink} is already used by ${owner}. ` +
        'Two documents cannot share a URL; change one of their permalinks.',
    );
    this.permalink = permalink;
    this.path = path;
    this.conflictingPath = conflictingPath;
  }
}

/**
 * Whether a content path is in the trash. Trashed documents stay indexed so
 * the admin can restore them, and stay out of every public listing.
 */
export function isTrashedPath(contentPath: string): boolean {
  return contentPath.split('/').includes(TRASH_DIRECTORY);
}

/**
 * The value a document sorts by: its date as a UTC instant, so
 * `2026-09-02T09:00:00-05:00` and `2026-09-02T14:00:00Z` compare equal.
 *
 * A document whose date is missing or unreadable sorts last, because SQLite
 * orders NULL below every string.
 */
export function dateSortKey(date: string | undefined): string | null {
  if (date === undefined) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * The clause every public query carries: a document is public only once its
 * date has arrived.
 *
 * A document with no date — or one nobody can read — has nothing to wait for
 * and is public straight away, which is what keeps an undated page out of the
 * scheduling rule without a second predicate. The value compared against is a
 * {@link dateSortKey} of the clock, so the comparison is between two UTC ISO
 * strings and lexicographic order is chronological order.
 */
const DUE_CLAUSE = '(date_sort IS NULL OR date_sort <= ?)';

/** The reverse: a document whose date is still ahead of the clock. */
const SCHEDULED_CLAUSE = '(date_sort IS NOT NULL AND date_sort > ?)';

/**
 * The clause that picks out a document some follower holds a copy of: one
 * whose `activitypub` block names an id.
 *
 * The block is stored as JSON rather than shredded into columns, so the id is
 * read back out of it here. An empty id is no id: the front matter is a file
 * somebody may have typed, and `activitypub: {id: ""}` is what a half-finished
 * hand edit looks like.
 */
const FEDERATED_CLAUSE = `COALESCE(json_extract(activitypub, '$.id'), '') <> ''`;

/**
 * Open (and if needed create) the index in `dataDir`, applying every migration
 * the package ships. Applying them is idempotent, so reopening an up-to-date
 * database does nothing.
 */
export function openContentStore(options: OpenContentStoreOptions): ContentStore {
  const file = path.join(options.dataDir, DATABASE_FILE);
  const clock = options.now ?? systemClock;
  mkdirSync(options.dataDir, { recursive: true });

  /** The clock as the index sorts dates, so the two compare as strings. */
  function nowKey(): string {
    return clock().toISOString();
  }

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);

  const statements = {
    insert: db.prepare(`
      INSERT INTO documents (
        path, type, slug, permalink, title, date, date_sort, updated, draft, trashed,
        description, author, activitypub, extra, body, html, hash
      ) VALUES (
        :path, :type, :slug, :permalink, :title, :date, :date_sort, :updated, :draft, :trashed,
        :description, :author, :activitypub, :extra, :body, :html, :hash
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
        activitypub = excluded.activitypub,
        extra = excluded.extra,
        body = excluded.body,
        html = excluded.html,
        hash = excluded.hash
    `),
    deleteTags: db.prepare('DELETE FROM document_tags WHERE path = ?'),
    insertTag: db.prepare('INSERT INTO document_tags (path, tag, position) VALUES (?, ?, ?)'),
    deleteCategories: db.prepare('DELETE FROM document_categories WHERE path = ?'),
    insertCategory: db.prepare(
      'INSERT INTO document_categories (path, category, position) VALUES (?, ?, ?)',
    ),
    pathForPermalink: db.prepare('SELECT path FROM documents WHERE permalink = ?'),
    remove: db.prepare('DELETE FROM documents WHERE path = ?'),
    byPath: db.prepare('SELECT * FROM documents WHERE path = ?'),
    byPermalink: db.prepare('SELECT * FROM documents WHERE permalink = ?'),
    bySlug: db.prepare(
      `SELECT * FROM documents WHERE slug = ? ORDER BY date_sort DESC, path DESC LIMIT 1`,
    ),
    tagsFor: db.prepare('SELECT tag FROM document_tags WHERE path = ? ORDER BY position'),
    categoriesFor: db.prepare(
      'SELECT category FROM document_categories WHERE path = ? ORDER BY position',
    ),
    paths: db.prepare('SELECT path FROM documents ORDER BY path'),
    counts: db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(type = 'post' AND draft = 0 AND trashed = 0 AND ${DUE_CLAUSE}), 0) AS posts,
        COALESCE(SUM(type = 'page' AND draft = 0 AND trashed = 0 AND ${DUE_CLAUSE}), 0) AS pages,
        COALESCE(SUM(draft = 1 AND trashed = 0), 0) AS drafts,
        COALESCE(SUM(draft = 0 AND trashed = 0 AND ${SCHEDULED_CLAUSE}), 0) AS scheduled,
        COALESCE(SUM(trashed = 1), 0) AS trashed
      FROM documents
    `),
    tagCounts: db.prepare(`
      SELECT document_tags.tag AS tag, COUNT(*) AS count
      FROM document_tags
      JOIN documents ON documents.path = document_tags.path
      WHERE documents.draft = 0 AND documents.trashed = 0
        AND (documents.date_sort IS NULL OR documents.date_sort <= ?)
      GROUP BY document_tags.tag
      ORDER BY count DESC, tag ASC
    `),
    categoryCounts: db.prepare(`
      SELECT document_categories.category AS category, COUNT(*) AS count
      FROM document_categories
      JOIN documents ON documents.path = document_categories.path
      WHERE documents.draft = 0 AND documents.trashed = 0
        AND (documents.date_sort IS NULL OR documents.date_sort <= ?)
      GROUP BY document_categories.category
      ORDER BY count DESC, category ASC
    `),
    tagUsage: db.prepare(termUsageSql('document_tags', 'tag')),
    categoryUsage: db.prepare(termUsageSql('document_categories', 'category')),
    nextDue: db.prepare(`
      SELECT MIN(date_sort) AS due FROM documents
      WHERE draft = 0 AND trashed = 0 AND ${SCHEDULED_CLAUSE}
    `),
    dueSince: db.prepare(`
      SELECT * FROM documents
      WHERE draft = 0 AND trashed = 0
        AND date_sort IS NOT NULL AND date_sort > ? AND date_sort <= ?
      ORDER BY date_sort ASC, path ASC
    `),
  };

  let open = true;

  function tagsOf(contentPath: string): string[] {
    return statements.tagsFor.all(contentPath).map((row) => String(row['tag']));
  }

  function categoriesOf(contentPath: string): string[] {
    return statements.categoriesFor.all(contentPath).map((row) => String(row['category']));
  }

  function hydrate(row: Record<string, unknown> | undefined): Document | undefined {
    if (row === undefined) return undefined;
    return hydrateOne(row);
  }

  function hydrateOne(row: Record<string, unknown>): Document {
    const contentPath = String(row['path']);
    return toDocument(row, tagsOf(contentPath), categoriesOf(contentPath));
  }

  function hydrateAll(rows: Record<string, unknown>[]): Document[] {
    return rows.map(hydrateOne);
  }

  function writeOne(document: Document): void {
    const contentPath = document.path;
    try {
      statements.insert.run(toRow(document));
    } catch (error) {
      throw translateWriteError(error, document, statements.pathForPermalink);
    }
    statements.deleteTags.run(contentPath);
    document.tags.forEach((tag, position) => {
      statements.insertTag.run(contentPath, tag, position);
    });
    statements.deleteCategories.run(contentPath);
    document.categories.forEach((category, position) => {
      statements.insertCategory.run(contentPath, category, position);
    });
  }

  /**
   * One taxonomy archive: the published, untrashed documents whose term list
   * holds `term`, newest first. Tags and categories are the same query over two
   * tables, so neither can drift from the other.
   */
  function selectByTerm(
    table: 'document_tags' | 'document_categories',
    column: 'tag' | 'category',
    term: string,
    options: ListByTagOptions,
  ): Document[] {
    const where = [
      'draft = 0',
      'trashed = 0',
      DUE_CLAUSE,
      `path IN (SELECT path FROM ${table} WHERE ${column} = ?)`,
    ];
    const params: unknown[] = [nowKey(), term];
    if (options.type !== undefined) {
      where.unshift('type = ?');
      params.unshift(options.type);
    }
    return select(where, params, options);
  }

  /** {@link selectByTerm}'s total, for the pager and the archive's existence. */
  function countByTerm(
    table: 'document_tags' | 'document_categories',
    column: 'tag' | 'category',
    term: string,
    options: ListByTagOptions,
  ): number {
    const where = [
      'documents.draft = 0',
      'documents.trashed = 0',
      '(documents.date_sort IS NULL OR documents.date_sort <= ?)',
      `${table}.${column} = ?`,
    ];
    const params: unknown[] = [nowKey(), term];
    if (options.type !== undefined) {
      where.push('documents.type = ?');
      params.push(options.type);
    }
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM ${table}
         JOIN documents ON documents.path = ${table}.path
         WHERE ${where.join(' AND ')}`,
      )
      .get(...(params as never[])) as Record<string, unknown>;
    return Number(row['count']);
  }

  function select(where: string[], params: unknown[], options: ListOptions): Document[] {
    const clause = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
    const rows = db
      .prepare(
        `SELECT * FROM documents ${clause} ORDER BY date_sort DESC, path DESC ${limitClause(options)}`,
      )
      .all(...(params as never[]), ...limitParams(options));
    return hydrateAll(rows as Record<string, unknown>[]);
  }

  return {
    file,

    now() {
      return clock();
    },

    upsert(document) {
      writeOne(document);
    },

    upsertAll(documents) {
      db.exec('BEGIN');
      try {
        for (const document of documents) writeOne(document);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    remove(contentPath) {
      return statements.remove.run(contentPath).changes > 0;
    },

    getByPath(contentPath) {
      return hydrate(statements.byPath.get(contentPath) as Record<string, unknown> | undefined);
    },

    getByPermalink(permalink) {
      return hydrate(statements.byPermalink.get(permalink) as Record<string, unknown> | undefined);
    },

    getBySlug(slug) {
      return hydrate(statements.bySlug.get(slug) as Record<string, unknown> | undefined);
    },

    listPosts(options = {}) {
      return select(["type = 'post'", 'draft = 0', 'trashed = 0', DUE_CLAUSE], [nowKey()], options);
    },

    nextDue() {
      const row = statements.nextDue.get(nowKey()) as Record<string, unknown>;
      return text(row['due']);
    },

    listDueSince(after) {
      const rows = statements.dueSince.all(after, nowKey()) as Record<string, unknown>[];
      return hydrateAll(rows);
    },

    listByTag(tag, options = {}) {
      return selectByTerm('document_tags', 'tag', tag, options);
    },

    listByCategory(category, options = {}) {
      return selectByTerm('document_categories', 'category', category, options);
    },

    listAll(options = {}) {
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
        params.push(nowKey());
      }

      if (options.tag !== undefined) {
        where.push('path IN (SELECT path FROM document_tags WHERE tag = ?)');
        params.push(options.tag);
      }
      if (options.category !== undefined) {
        where.push('path IN (SELECT path FROM document_categories WHERE category = ?)');
        params.push(options.category);
      }

      return select(where, params, options);
    },

    listFederated(options = {}) {
      return select([`type = 'post'`, FEDERATED_CLAUSE], [], options);
    },

    listPaths() {
      return statements.paths.all().map((row) => String(row['path']));
    },

    counts() {
      const now = nowKey();
      const row = statements.counts.get(now, now, now) as Record<string, unknown>;
      return {
        total: Number(row['total']),
        posts: Number(row['posts']),
        pages: Number(row['pages']),
        drafts: Number(row['drafts']),
        scheduled: Number(row['scheduled']),
        trashed: Number(row['trashed']),
      };
    },

    countByTag(tag, options = {}) {
      return countByTerm('document_tags', 'tag', tag, options);
    },

    countByCategory(category, options = {}) {
      return countByTerm('document_categories', 'category', category, options);
    },

    listTags() {
      return statements.tagCounts.all(nowKey()).map((row) => ({
        tag: String(row['tag']),
        count: Number(row['count']),
      }));
    },

    listCategories() {
      return statements.categoryCounts.all(nowKey()).map((row) => ({
        category: String(row['category']),
        count: Number(row['count']),
      }));
    },

    listTermUsage(taxonomy) {
      const query = taxonomy === 'tag' ? statements.tagUsage : statements.categoryUsage;
      return query.all(nowKey()).map((row) => ({
        term: String(row['term']),
        published: Number(row['published']),
        total: Number(row['total']),
      }));
    },

    close() {
      if (!open) return;
      open = false;
      db.close();
    },
  };
}

/**
 * The query behind {@link ContentStore.listTermUsage} for one of the two join
 * tables: every term, the public count and the total, in one pass.
 *
 * The table and column names are the module's own literals rather than
 * anything a caller supplies, so there is nothing here to interpolate from
 * outside; the clock is the one bound parameter.
 */
function termUsageSql(table: 'document_tags' | 'document_categories', column: string): string {
  return `
    SELECT ${table}.${column} AS term,
      COALESCE(SUM(
        documents.draft = 0 AND documents.trashed = 0
          AND (documents.date_sort IS NULL OR documents.date_sort <= ?)
      ), 0) AS published,
      COUNT(*) AS total
    FROM ${table}
    JOIN documents ON documents.path = ${table}.path
    GROUP BY ${table}.${column}
    ORDER BY term ASC
  `;
}

function limitClause(options: ListOptions): string {
  if (options.limit === undefined && options.offset === undefined) return '';
  return 'LIMIT ? OFFSET ?';
}

function limitParams(options: ListOptions): never[] {
  if (options.limit === undefined && options.offset === undefined) return [];
  return [options.limit ?? -1, options.offset ?? 0] as never[];
}

/** A {@link Document} as the columns of the `documents` table. */
function toRow(document: Document): Record<string, string | number | null> {
  return {
    path: document.path,
    type: document.type,
    slug: document.slug,
    permalink: document.permalink,
    title: document.title,
    date: document.date ?? null,
    date_sort: dateSortKey(document.date),
    updated: document.updated ?? null,
    draft: document.draft ? 1 : 0,
    trashed: isTrashedPath(document.path) ? 1 : 0,
    description: document.description ?? null,
    author: document.author ?? null,
    activitypub: document.activitypub === undefined ? null : JSON.stringify(document.activitypub),
    extra: JSON.stringify(document.extra),
    body: document.body,
    html: document.html,
    hash: document.hash,
  };
}

/**
 * A row back into a {@link Document}.
 *
 * Optional fields are left off entirely when the column is NULL, so a document
 * that went through the index deep-equals the one that was parsed from the file.
 */
function toDocument(row: Record<string, unknown>, tags: string[], categories: string[]): Document {
  return {
    type: String(row['type']) as DocumentType,
    path: String(row['path']),
    slug: String(row['slug']),
    permalink: String(row['permalink']),
    title: String(row['title']),
    ...optional('date', text(row['date'])),
    ...optional('updated', text(row['updated'])),
    tags,
    categories,
    draft: row['draft'] === 1,
    ...optional('description', text(row['description'])),
    ...optional('author', text(row['author'])),
    ...optional('activitypub', json<ActivityPubMetadata>(row['activitypub'])),
    extra: json<Record<string, unknown>>(row['extra']) ?? {},
    body: String(row['body']),
    html: String(row['html']),
    hash: String(row['hash']),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function json<T>(value: unknown): T | undefined {
  if (typeof value !== 'string') return undefined;
  return JSON.parse(value) as T;
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * Turn SQLite's unique-constraint message into something a site owner can act
 * on. Everything else is rethrown untouched.
 */
function translateWriteError(
  error: unknown,
  document: Document,
  pathForPermalink: StatementSync,
): unknown {
  if (!isUniqueViolation(error, 'documents.permalink')) return error;

  const row = pathForPermalink.get(document.permalink) as Record<string, unknown> | undefined;
  return new DuplicatePermalinkError(document.permalink, document.path, text(row?.['path']));
}

function isUniqueViolation(error: unknown, column: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code !== 'ERR_SQLITE_ERROR') return false;
  return error.message.includes('UNIQUE constraint failed') && error.message.includes(column);
}

/**
 * Schema versions, applied in order. Never edit a migration that has shipped;
 * append a new one, so a site that upgrades lands on the same schema as a site
 * that starts fresh.
 */
const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
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
];

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT version FROM migrations')
      .all()
      .map((row) => Number(row['version'])),
  );

  const record = db.prepare('INSERT INTO migrations (version, applied_at) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      record.run(migration.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
