import type { StatementSync } from 'node:sqlite';

import { databaseFile, openDatabase } from '../cache.ts';
import type { Migration } from '../cache.ts';
import type { ActivityPubMetadata, Document, DocumentType } from './document.ts';
import { featuredPosts, PINNED_FRONT_MATTER_KEY } from './pinned.ts';
import { searchExpression, searchText, SNIPPET_CLOSE, SNIPPET_OPEN } from './search.ts';
import { tagKey, uniqueTags } from './tags.ts';
import { VISIBILITIES, VISIBILITY_FRONT_MATTER_KEY } from './visibility.ts';

export { DATABASE_FILE } from '../cache.ts';

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
   * Throws {@link DuplicatePermalinkError} when another live path already
   * claims the same permalink.
   */
  upsert(document: Document): void;
  /** {@link ContentStore.upsert} for many documents, in one transaction. */
  upsertAll(documents: Iterable<Document>): void;
  /** Drop a document by path. Returns `false` when there was nothing to drop. */
  remove(path: string): boolean;
  /**
   * Empty the index: every document, its terms and its words.
   *
   * What a rebuild does before it reads the files again (TASK-95), and the
   * counterpart of the `DELETE FROM documents` three migrations run for the
   * same reason. The index is derived and the files are the source of truth
   * (decision-1), so this loses nothing a scan cannot work out again — and it
   * is the whole point: a row whose hash matches its file is a row a scan
   * leaves alone, so nothing short of emptying the index makes it read
   * everything.
   *
   * One transaction, so the four tables are never half cleared, and no wider
   * than that: the scan that fills the index again runs outside it. One
   * connection serves every request, so a transaction held open across a scan
   * would not isolate the rebuild from anybody — it would swallow their writes
   * into it.
   */
  clear(): void;
  /** The document at a content-relative path, or `undefined`. */
  getByPath(path: string): Document | undefined;
  /**
   * The document a URL resolves to, or `undefined`.
   *
   * Permalinks are unique among live documents only: a trashed document keeps
   * its URL so that it can answer 410 Gone (TASK-195), until a live one takes
   * the URL over. The live document wins; a trashed one answers only when
   * nothing live holds the URL.
   */
  getByPermalink(permalink: string): Document | undefined;
  /**
   * The post whose front matter names this ActivityStreams id, or `undefined`.
   *
   * Only a migrated post (decision-13) or one moved after it was published
   * (decision-20) has one: any other post is named by its permalink and
   * carries no `activitypub.id` at all. This is how
   * the id its followers already hold keeps answering — with the `Article` for
   * a peer and a redirect to the permalink for a browser — so the match is on
   * the whole URL, a `?p=813` query string included.
   */
  getByStoredObjectId(objectId: string): Document | undefined;
  /**
   * The published document whose `redirect_from` names this URL, or
   * `undefined`.
   *
   * What a URL a document used to live at resolves to (TASK-127). Only a
   * public document answers, so an old URL of something since drafted or
   * trashed 404s rather than redirecting to a 404. Should two claim one URL,
   * the one updated most recently wins.
   */
  getByFormerPermalink(permalink: string): Document | undefined;
  /**
   * The document with this slug, or `undefined`. Slugs are not unique across
   * years, so the newest match wins.
   */
  getBySlug(slug: string): Document | undefined;
  /** Published, untrashed, already-due, listed posts, newest first. */
  listPosts(options?: ListOptions): Document[];
  /**
   * The published posts either side of one by date: what a theme links as
   * previous and next under an entry.
   *
   * `previous` is the post before it and `next` the one after it, in the order
   * every listing is in — newest first, ties broken by path — so a reader
   * walking the links walks the archive. Either is absent at its end of the
   * archive rather than wrapping round to the other end.
   *
   * Only published posts are neighbours: a draft, a trashed post, a page and a
   * post whose date is still ahead are all things a reader cannot open, and a
   * link to one would be a link to a 404. A document that is not a post has no
   * neighbours at all, because an archive is what somebody wrote and a page is
   * furniture.
   */
  neighbours(document: Document): DocumentNeighbours;
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
  /**
   * Published, untrashed documents carrying a tag in any casing, newest first.
   *
   * Tags match without regard to case (TASK-308): a document hydrated from
   * the index carries each of its tags in the site's spelling, which
   * {@link ContentStore.tagSpelling} names.
   */
  listByTag(tag: string, options?: ListByTagOptions): Document[];
  /** Published, untrashed documents filed under a category, newest first. */
  listByCategory(category: string, options?: ListByTagOptions): Document[];
  /**
   * Published, untrashed, already-due posts whose `author` is one of `names`,
   * newest first: one user's archive (TASK-67).
   *
   * A list of names rather than one, because more than one string can read as
   * the same person: doc-2's `author` holds a username, and a file written
   * before decision-14 holds a display name that reads as the one user
   * answering to it. `web/authors.ts` decides which names those are and hands
   * them here, so the index matches strings and never has to know what a user
   * is. An empty list matches nothing, which is what a user whose name nothing
   * resolves to should get.
   *
   * Posts only: an author archive is what somebody wrote, and a page is part
   * of the furniture of the site rather than of anybody's body of work.
   */
  listByAuthor(names: readonly string[], options?: ListOptions): Document[];
  /**
   * The posts of one user's archive that carry a `pinned` key, most recently
   * pinned first and capped at `PINNED_POST_LIMIT`: their featured collection
   * (TASK-207). The same archive {@link ContentStore.listByAuthor} reads, so a
   * draft, a trashed post or a scheduled one is never featured.
   */
  listPinnedByAuthor(names: readonly string[]): Document[];
  /** Everything the admin may see, trash and drafts included unless filtered. */
  listAll(options?: ListAllOptions): Document[];
  /**
   * Posts the site has announced to the fediverse: the ones whose front matter
   * carries an `activitypub.published`, newest first, drafts, scheduled posts
   * and the trash included.
   *
   * The federation screen's row source, and the reason the filter is a query
   * rather than a walk of {@link ContentStore.listAll}: a draft and a trashed
   * post belong on that screen — they are what a `Delete` is sent for — so the
   * only thing that decides the list is whether the post was ever announced,
   * which is the same thing as whether a follower holds a copy.
   */
  listFederated(options?: ListOptions): Document[];
  /**
   * Served posts whose `in-reply-to` is exactly one of these URLs, unlisted
   * ones included, newest first (TASK-300): the reply posts a thread shows.
   * Naming nothing returns nothing.
   */
  listRepliesTo(targets: readonly string[]): Document[];
  /** Served posts with an `in-reply-to`, unlisted ones included, newest first. */
  listReplyPosts(options?: ListOptions): Document[];
  /** Every indexed path, sorted. What a sync compares the content tree against. */
  listPaths(): string[];
  /** How many documents there are of each kind. */
  counts(): ContentCounts;
  /** How many published, untrashed documents carry a tag. */
  countByTag(tag: string, options?: ListByTagOptions): number;
  /** Every tag in use on published, untrashed documents, once each in the site's spelling, with its count. */
  listTags(): TagCount[];
  /**
   * How the site spells the tag that matches `tag` ignoring case, or
   * `undefined` when no document carries it.
   *
   * The spelling most listed documents use, ties going to the one used
   * earliest; for a tag only drafts, scheduled posts or the trash carry, the
   * spelling most of those use. `excluding` leaves one document out of the
   * count, so a document being saved does not vote for its own spelling.
   */
  tagSpelling(tag: string, options?: { excluding?: string | undefined }): string | undefined;
  /** How many published, untrashed documents are filed under a category. */
  countByCategory(category: string, options?: ListByTagOptions): number;
  /** How many published posts one user's archive holds. See {@link ContentStore.listByAuthor}. */
  countByAuthor(names: readonly string[]): number;
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
  /**
   * Published, untrashed, already-due posts and pages matching a reader's
   * query, best match first (TASK-22).
   *
   * `query` is what somebody typed, not FTS5 syntax: see `searchExpression`
   * for what it understands. A query with nothing searchable in it finds
   * nothing rather than everything. Relevance is BM25 with a title match
   * counting for more than a match in the description or the taxonomy, and
   * those for more than one in the body; documents that tie are in the order
   * every listing is in, newest first.
   */
  search(query: string, options?: ListOptions): SearchHit[];
  /** How many documents {@link ContentStore.search} would find, for the pager. */
  countSearch(query: string): number;
  /**
   * Refuse every write on this connection while on, with SQLite's
   * `query_only`. A worker handing over to a new one under `geekity serve`
   * turns it on, so the new worker's boot migrations run alone (TASK-288).
   */
  setReadOnly(readOnly: boolean): void;
  /** Close the database. Safe to call twice. */
  close(): void;
}

/**
 * The published posts either side of one, as {@link ContentStore.neighbours}
 * answers.
 *
 * Both keys are absent for a document with no neighbours at all, so a caller
 * reads the pair rather than asking twice.
 */
export interface DocumentNeighbours {
  /** The post before this one by date, absent at the end of the archive. */
  previous?: Document | undefined;
  /** The post after this one by date, absent at the front of it. */
  next?: Document | undefined;
}

/** One document a search found, and the passage it was found in. */
export interface SearchHit {
  /** The document. */
  document: Document;
  /**
   * A few words around the match, as plain text, with every matched word
   * between `SNIPPET_OPEN` and `SNIPPET_CLOSE`. Whoever prints it escapes it
   * first and turns the marks into markup second.
   */
  snippet: string;
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
  /** Published, untrashed, already-due, listed posts: the size of the public archive. */
  posts: number;
  /** Published, untrashed, already-due, listed pages. */
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
  /** The term itself: a tag in the site's spelling, a category as the files spell it. */
  term: string;
  /** Documents the public site lists under it: published, untrashed, due, listed. */
  published: number;
  /** Every file carrying it, drafts, scheduled posts and the trash included. */
  total: number;
}

/**
 * Thrown when two live files claim the same permalink. Two documents at one URL is
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

const VISIBILITY_SQL = `COALESCE(json_extract(extra, '$.${VISIBILITY_FRONT_MATTER_KEY}'), 'public')`;

const SERVED_CLAUSE = `(draft = 0 AND trashed = 0 AND ${DUE_CLAUSE} AND ${VISIBILITY_SQL} IN (${VISIBILITIES.map((visibility) => `'${visibility}'`).join(', ')}))`;

const LISTED_CLAUSE = `(${SERVED_CLAUSE} AND ${VISIBILITY_SQL} = 'public')`;

/**
 * A document whose front matter carries a `pinned` key that is not `false`.
 * Which moment it was pinned at, and whether it is readable at all, is
 * `content/pinned.ts`'s to decide; this only keeps the rest of an archive from
 * being hydrated to find out.
 */
const PINNED_CLAUSE = `COALESCE(json_extract(extra, '$.${PINNED_FRONT_MATTER_KEY}'), 0) NOT IN (0, '')`;

/**
 * The clause that picks out a document some follower holds a copy of: one
 * whose `activitypub` block records when it was announced.
 *
 * `published` rather than `id`, because after decision-13 a post's id is its
 * permalink and is never written into the file: the announcement date is the
 * only mark a delivery leaves, and it is the one thing that says a follower
 * was ever told. The block is stored as JSON rather than shredded into
 * columns, so the date is read back out of it here. An empty value is no
 * value: the front matter is a file somebody may have typed, and
 * `activitypub: {published: ""}` is what a half-finished hand edit looks like.
 */
const FEDERATED_CLAUSE = `COALESCE(json_extract(activitypub, '$.published'), '') <> ''`;

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

/**
 * Open (and if needed create) the index in `dataDir`, applying every migration
 * the package ships. Applying them is idempotent, so reopening an up-to-date
 * database does nothing.
 */
export function openContentStore(options: OpenContentStoreOptions): ContentStore {
  const clock = options.now ?? systemClock;

  /** The clock as the index sorts dates, so the two compare as strings. */
  function nowKey(): string {
    return clock().toISOString();
  }

  const file = databaseFile(options.dataDir);
  const db = openDatabase({ dataDir: options.dataDir, ledger: LEDGER, migrations: MIGRATIONS });

  const statements = {
    insert: db.prepare(`
      INSERT INTO documents (
        path, type, slug, permalink, title, date, date_sort, updated, draft, trashed,
        description, author, in_reply_to, activitypub, extra, body, html, hash
      ) VALUES (
        :path, :type, :slug, :permalink, :title, :date, :date_sort, :updated, :draft, :trashed,
        :description, :author, :in_reply_to, :activitypub, :extra, :body, :html, :hash
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
        hash = excluded.hash
    `),
    deleteTags: db.prepare('DELETE FROM document_tags WHERE path = ?'),
    insertTag: db.prepare(
      'INSERT INTO document_tags (path, tag, key, position) VALUES (?, ?, ?, ?)',
    ),
    deleteCategories: db.prepare('DELETE FROM document_categories WHERE path = ?'),
    insertCategory: db.prepare(
      'INSERT INTO document_categories (path, category, position) VALUES (?, ?, ?)',
    ),
    pathForPermalink: db.prepare('SELECT path FROM documents WHERE permalink = ? AND trashed = 0'),
    remove: db.prepare('DELETE FROM documents WHERE path = ?'),
    byPath: db.prepare('SELECT * FROM documents WHERE path = ?'),
    byPermalink: db.prepare(
      'SELECT * FROM documents WHERE permalink = ? ORDER BY trashed, path DESC LIMIT 1',
    ),
    deleteRedirects: db.prepare('DELETE FROM document_redirects WHERE path = ?'),
    insertRedirect: db.prepare(
      'INSERT INTO document_redirects (path, url, position) VALUES (?, ?, ?)',
    ),
    redirectsFor: db.prepare('SELECT url FROM document_redirects WHERE path = ? ORDER BY position'),
    byFormerPermalink: db.prepare(`
      SELECT documents.* FROM documents
      JOIN document_redirects ON document_redirects.path = documents.path
      WHERE document_redirects.url = ?
        AND ${SERVED_CLAUSE}
      ORDER BY documents.updated DESC, documents.path DESC
      LIMIT 1
    `),
    byStoredObjectId: db.prepare(
      `SELECT * FROM documents WHERE json_extract(activitypub, '$.id') = ? ORDER BY trashed LIMIT 1`,
    ),
    bySlug: db.prepare(
      `SELECT * FROM documents WHERE slug = ? ORDER BY date_sort DESC, path DESC LIMIT 1`,
    ),
    tagsFor: db.prepare('SELECT tag, key FROM document_tags WHERE path = ? ORDER BY position'),
    keysFor: db.prepare('SELECT key FROM document_tags WHERE path = ?'),
    spellings: db.prepare(tagSpellingsSql('')),
    spellingsOfKeys: db.prepare(
      tagSpellingsSql('WHERE spelled.key IN (SELECT value FROM json_each(:keys))'),
    ),
    spellingExcluding: db.prepare(
      tagSpellingsSql('WHERE spelled.key = :key AND spelled.path <> :excluding'),
    ),
    dataVersion: db.prepare('PRAGMA data_version'),
    categoriesFor: db.prepare(
      'SELECT category FROM document_categories WHERE path = ? ORDER BY position',
    ),
    paths: db.prepare('SELECT path FROM documents ORDER BY path'),
    counts: db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(type = 'post' AND ${LISTED_CLAUSE}), 0) AS posts,
        COALESCE(SUM(type = 'page' AND ${LISTED_CLAUSE}), 0) AS pages,
        COALESCE(SUM(draft = 1 AND trashed = 0), 0) AS drafts,
        COALESCE(SUM(draft = 0 AND trashed = 0 AND ${SCHEDULED_CLAUSE}), 0) AS scheduled,
        COALESCE(SUM(trashed = 1), 0) AS trashed
      FROM documents
    `),
    tagCounts: db.prepare(`
      SELECT document_tags.key AS key, MIN(document_tags.tag) AS tag, COUNT(*) AS count
      FROM document_tags
      JOIN documents ON documents.path = document_tags.path
      WHERE ${LISTED_CLAUSE}
      GROUP BY document_tags.key
    `),
    categoryCounts: db.prepare(`
      SELECT document_categories.category AS category, COUNT(*) AS count
      FROM document_categories
      JOIN documents ON documents.path = document_categories.path
      WHERE ${LISTED_CLAUSE}
      GROUP BY document_categories.category
      ORDER BY count DESC, category ASC
    `),
    tagUsage: db.prepare(termUsageSql(TERM_TABLES.tag)),
    categoryUsage: db.prepare(termUsageSql(TERM_TABLES.category)),
    nextDue: db.prepare(`
      SELECT MIN(date_sort) AS due FROM documents
      WHERE draft = 0 AND trashed = 0 AND ${SCHEDULED_CLAUSE}
    `),
    deleteText: db.prepare('DELETE FROM documents_fts WHERE path = ?'),
    insertText: db.prepare(
      'INSERT INTO documents_fts (path, title, description, terms, body) VALUES (?, ?, ?, ?, ?)',
    ),
    search: db.prepare(`
      SELECT documents.*,
        snippet(documents_fts, -1, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '…', 24) AS snippet
      ${SEARCH_FROM}
      ORDER BY bm25(documents_fts, ${SEARCH_WEIGHTS}), documents.date_sort DESC, documents.path DESC
      LIMIT ? OFFSET ?
    `),
    countSearch: db.prepare(`SELECT COUNT(*) AS count ${SEARCH_FROM}`),
    dueSince: db.prepare(`
      SELECT * FROM documents
      WHERE draft = 0 AND trashed = 0
        AND date_sort IS NOT NULL AND date_sort > ? AND date_sort <= ?
      ORDER BY date_sort ASC, path ASC
    `),
  };

  let open = true;

  let cachedSpellings: CachedSpellings | undefined;
  const staleKeys = new Set<string>();

  const MOST_KEYS_REFRESHED = 500;

  function siteSpellings(): ReadonlyMap<string, string> {
    const now = nowKey();
    const dataVersion = statements.dataVersion.get()?.['data_version'];
    const current =
      cachedSpellings === undefined || outOfDate(cachedSpellings, dataVersion, now)
        ? undefined
        : cachedSpellings.byKey;

    if (current !== undefined && staleKeys.size === 0) return current;

    const refreshStaleOnly = current !== undefined && staleKeys.size <= MOST_KEYS_REFRESHED;
    const byKey = refreshStaleOnly ? current : new Map<string, string>();
    const rows = refreshStaleOnly
      ? refreshStaleSpellings(byKey, now)
      : (statements.spellings.all(now) as Record<string, unknown>[]);
    for (const row of rows) byKey.set(String(row['key']), String(row['tag']));
    staleKeys.clear();

    const nextScheduledAt = text((statements.nextDue.get(now) as Record<string, unknown>)['due']);
    cachedSpellings = { byKey, dataVersion, workedOutAt: now, nextScheduledAt };
    return byKey;
  }

  function refreshStaleSpellings(
    byKey: Map<string, string>,
    now: string,
  ): Record<string, unknown>[] {
    for (const key of staleKeys) byKey.delete(key);
    return statements.spellingsOfKeys.all({ keys: JSON.stringify([...staleKeys]) }, now) as Record<
      string,
      unknown
    >[];
  }

  function markTagsStaleBeforeWrite(contentPath: string): void {
    for (const row of statements.keysFor.all(contentPath)) staleKeys.add(String(row['key']));
  }

  function tagsOf(contentPath: string): string[] {
    const spellings = siteSpellings();
    return statements.tagsFor
      .all(contentPath)
      .map((row) => spellings.get(String(row['key'])) ?? String(row['tag']));
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
    const redirectFrom = statements.redirectsFor
      .all(contentPath)
      .map((redirect) => String(redirect['url']));
    return {
      ...toDocument(row, tagsOf(contentPath), categoriesOf(contentPath)),
      ...(redirectFrom.length === 0 ? {} : { redirectFrom }),
    };
  }

  function hydrateAll(rows: Record<string, unknown>[]): Document[] {
    return rows.map(hydrateOne);
  }

  function writeOne(document: Document): void {
    const contentPath = document.path;
    markTagsStaleBeforeWrite(contentPath);
    for (const tag of document.tags) staleKeys.add(tagKey(tag));
    try {
      statements.insert.run(toRow(document));
    } catch (error) {
      throw translateWriteError(error, document, statements.pathForPermalink);
    }
    statements.deleteTags.run(contentPath);
    uniqueTags(document.tags).forEach((tag, position) => {
      statements.insertTag.run(contentPath, tag, tagKey(tag), position);
    });
    statements.deleteCategories.run(contentPath);
    document.categories.forEach((category, position) => {
      statements.insertCategory.run(contentPath, category, position);
    });
    statements.deleteRedirects.run(contentPath);
    (document.redirectFrom ?? []).forEach((url, position) => {
      statements.insertRedirect.run(contentPath, url, position);
    });
    // The words it is found by. Replaced rather than updated, because an FTS5
    // table has no key to conflict on: the path is only a column in it.
    const words = searchText(document);
    statements.deleteText.run(contentPath);
    statements.insertText.run(contentPath, words.title, words.description, words.terms, words.body);
  }

  /**
   * One taxonomy archive: the published, untrashed documents whose term list
   * holds `term`, newest first. Tags and categories are the same query over two
   * tables, so neither can drift from the other.
   */
  function selectByTerm(terms: TermTable, term: string, options: ListByTagOptions): Document[] {
    const where = [LISTED_CLAUSE, termFilter(terms)];
    const params: unknown[] = [nowKey(), terms.match(term)];
    if (options.type !== undefined) {
      where.unshift('type = ?');
      params.unshift(options.type);
    }
    return select(where, params, options);
  }

  /** {@link selectByTerm}'s total, for the pager and the archive's existence. */
  function countByTerm(terms: TermTable, term: string, options: ListByTagOptions): number {
    const { table, matchColumn } = terms;
    const where = [LISTED_CLAUSE, `${table}.${matchColumn} = ?`];
    const params: unknown[] = [nowKey(), terms.match(term)];
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

  /**
   * The nearest published post on one side of a point in the archive.
   *
   * `direction` is which way to look — `<` for older, `>` for newer — and
   * `order` is the sort that puts the nearest one first, so one query serves
   * both ends of {@link ContentStore.neighbours}.
   */
  function neighbour(
    direction: '<' | '>',
    order: 'ASC' | 'DESC',
    key: string,
    contentPath: string,
  ): Document | undefined {
    const row = db
      .prepare(
        `SELECT * FROM documents
         WHERE type = 'post' AND ${LISTED_CLAUSE}
           AND date_sort IS NOT NULL
           AND (date_sort, path) ${direction} (?, ?)
         ORDER BY date_sort ${order}, path ${order}
         LIMIT 1`,
      )
      .get(...([nowKey(), key, contentPath] as never[])) as Record<string, unknown> | undefined;
    return hydrate(row);
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
      markTagsStaleBeforeWrite(contentPath);
      // Nothing cascades into a virtual table, so the words go by hand.
      statements.deleteText.run(contentPath);
      return statements.remove.run(contentPath).changes > 0;
    },

    clear() {
      cachedSpellings = undefined;
      staleKeys.clear();
      db.exec('BEGIN');
      try {
        // All four by name. The two term tables would go with the documents
        // through their foreign keys, but a virtual table has none to cascade
        // through — and a clear that depended on a pragma being on for half of
        // what it empties would be a clear that half worked.
        db.exec('DELETE FROM documents_fts');
        db.exec('DELETE FROM document_tags');
        db.exec('DELETE FROM document_categories');
        db.exec('DELETE FROM document_redirects');
        db.exec('DELETE FROM documents');
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    getByPath(contentPath) {
      return hydrate(statements.byPath.get(contentPath) as Record<string, unknown> | undefined);
    },

    getByPermalink(permalink) {
      return hydrate(statements.byPermalink.get(permalink) as Record<string, unknown> | undefined);
    },

    getByStoredObjectId(objectId) {
      if (objectId === '') return undefined;
      return hydrate(
        statements.byStoredObjectId.get(objectId) as Record<string, unknown> | undefined,
      );
    },

    getByFormerPermalink(permalink) {
      return hydrate(
        statements.byFormerPermalink.get(permalink, nowKey()) as
          Record<string, unknown> | undefined,
      );
    },

    getBySlug(slug) {
      return hydrate(statements.bySlug.get(slug) as Record<string, unknown> | undefined);
    },

    listPosts(options = {}) {
      return select(["type = 'post'", LISTED_CLAUSE], [nowKey()], options);
    },

    neighbours(document) {
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
      const previous = neighbour('<', 'DESC', key, document.path);
      const next = neighbour('>', 'ASC', key, document.path);

      return {
        ...(previous === undefined ? {} : { previous }),
        ...(next === undefined ? {} : { next }),
      };
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
      return selectByTerm(TERM_TABLES.tag, tag, options);
    },

    listByCategory(category, options = {}) {
      return selectByTerm(TERM_TABLES.category, category, options);
    },

    listByAuthor(names, options = {}) {
      if (names.length === 0) return [];
      return select(
        ["type = 'post'", LISTED_CLAUSE, authorClause(names)],
        [nowKey(), ...names],
        options,
      );
    },

    listPinnedByAuthor(names) {
      if (names.length === 0) return [];
      return featuredPosts(
        select(
          ["type = 'post'", LISTED_CLAUSE, authorClause(names), PINNED_CLAUSE],
          [nowKey(), ...names],
          {},
        ),
      );
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
        where.push(termFilter(TERM_TABLES.tag));
        params.push(TERM_TABLES.tag.match(options.tag));
      }
      if (options.category !== undefined) {
        where.push(termFilter(TERM_TABLES.category));
        params.push(TERM_TABLES.category.match(options.category));
      }

      return select(where, params, options);
    },

    listFederated(options = {}) {
      return select([`type = 'post'`, FEDERATED_CLAUSE], [], options);
    },

    listRepliesTo(targets) {
      const wanted = [...new Set(targets)];
      if (wanted.length === 0) return [];
      return select(
        ["type = 'post'", SERVED_CLAUSE, `in_reply_to IN (${wanted.map(() => '?').join(', ')})`],
        [nowKey(), ...wanted],
        {},
      );
    },

    listReplyPosts(options = {}) {
      return select(
        ["type = 'post'", SERVED_CLAUSE, 'in_reply_to IS NOT NULL'],
        [nowKey()],
        options,
      );
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
      return countByTerm(TERM_TABLES.tag, tag, options);
    },

    countByCategory(category, options = {}) {
      return countByTerm(TERM_TABLES.category, category, options);
    },

    countByAuthor(names) {
      if (names.length === 0) return 0;
      const row = db
        .prepare(
          `SELECT COUNT(*) AS count FROM documents
           WHERE type = 'post' AND ${LISTED_CLAUSE} AND ${authorClause(names)}`,
        )
        .get(...([nowKey(), ...names] as never[])) as Record<string, unknown>;
      return Number(row['count']);
    },

    listTags() {
      const spellings = siteSpellings();
      return statements.tagCounts
        .all(nowKey())
        .map((row) => ({
          tag: spellings.get(String(row['key'])) ?? String(row['tag']),
          count: Number(row['count']),
        }))
        .sort((a, b) => b.count - a.count || compareByUtf16CodeUnit(a.tag, b.tag));
    },

    tagSpelling(tag, options = {}) {
      if (options.excluding === undefined) return siteSpellings().get(tagKey(tag));
      const row = statements.spellingExcluding.get(
        { key: tagKey(tag), excluding: options.excluding },
        nowKey(),
      );
      return text(row?.['tag']);
    },

    listCategories() {
      return statements.categoryCounts.all(nowKey()).map((row) => ({
        category: String(row['category']),
        count: Number(row['count']),
      }));
    },

    listTermUsage(taxonomy) {
      const query = taxonomy === 'tag' ? statements.tagUsage : statements.categoryUsage;
      const spellings: ReadonlyMap<string, string> =
        taxonomy === 'tag' ? siteSpellings() : new Map();
      return query
        .all(nowKey())
        .map((row) => ({
          term: spellings.get(String(row['key'])) ?? String(row['term']),
          published: Number(row['published']),
          total: Number(row['total']),
        }))
        .sort((a, b) => compareByUtf16CodeUnit(a.term, b.term));
    },

    search(query, options = {}) {
      const expression = searchExpression(query);
      if (expression === undefined) return [];
      const rows = statements.search.all(
        expression,
        nowKey(),
        options.limit ?? -1,
        options.offset ?? 0,
      ) as Record<string, unknown>[];
      return rows.map((row) => ({ document: hydrateOne(row), snippet: String(row['snippet']) }));
    },

    countSearch(query) {
      const expression = searchExpression(query);
      if (expression === undefined) return 0;
      const row = statements.countSearch.get(expression, nowKey()) as Record<string, unknown>;
      return Number(row['count']);
    },

    setReadOnly(readOnly) {
      db.exec(`PRAGMA query_only = ${readOnly ? 'ON' : 'OFF'}`);
    },

    close() {
      if (!open) return;
      open = false;
      db.close();
    },
  };
}

interface TermTable {
  readonly table: 'document_tags' | 'document_categories';
  readonly matchColumn: 'key' | 'category';
  readonly column: 'tag' | 'category';
  readonly match: (term: string) => string;
}

const TERM_TABLES: Readonly<Record<TaxonomyName, TermTable>> = {
  tag: { table: 'document_tags', matchColumn: 'key', column: 'tag', match: tagKey },
  category: {
    table: 'document_categories',
    matchColumn: 'category',
    column: 'category',
    match: (category) => category,
  },
};

interface CachedSpellings {
  readonly byKey: Map<string, string>;
  readonly dataVersion: unknown;
  readonly workedOutAt: string;
  readonly nextScheduledAt: string | undefined;
}

function outOfDate(cache: CachedSpellings, dataVersion: unknown, now: string): boolean {
  return (
    anotherConnectionWrote(cache, dataVersion) ||
    scheduledPostCameDue(cache, now) ||
    clockWentBack(cache, now)
  );
}

function anotherConnectionWrote(cache: CachedSpellings, dataVersion: unknown): boolean {
  return cache.dataVersion !== dataVersion;
}

function scheduledPostCameDue(cache: CachedSpellings, now: string): boolean {
  return cache.nextScheduledAt !== undefined && now >= cache.nextScheduledAt;
}

function clockWentBack(cache: CachedSpellings, now: string): boolean {
  return now < cache.workedOutAt;
}

function compareByUtf16CodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function termFilter({ table, matchColumn }: TermTable): string {
  return `path IN (SELECT path FROM ${table} WHERE ${matchColumn} = ?)`;
}

function tagSpellingsSql(where: string): string {
  return `
    SELECT key, tag FROM (
      SELECT key, tag, ROW_NUMBER() OVER (
        PARTITION BY key
        ORDER BY SUM(listed) DESC,
          MIN(CASE WHEN listed THEN date_sort END) ASC NULLS LAST,
          COUNT(*) DESC,
          MIN(date_sort) ASC NULLS LAST,
          tag ASC
      ) AS rank
      FROM (
        SELECT spelled.key AS key, spelled.tag AS tag,
          ${LISTED_CLAUSE} AS listed, spelled_in.date_sort AS date_sort
        FROM document_tags AS spelled
        JOIN documents AS spelled_in ON spelled_in.path = spelled.path
        ${where}
      )
      GROUP BY key, tag
    )
    WHERE rank = 1
  `;
}

function termUsageSql({ table, matchColumn, column }: TermTable): string {
  return `
    SELECT ${table}.${matchColumn} AS key, MIN(${table}.${column}) AS term,
      COALESCE(SUM(${LISTED_CLAUSE}), 0) AS published,
      COUNT(*) AS total
    FROM ${table}
    JOIN documents ON documents.path = ${table}.path
    GROUP BY ${table}.${matchColumn}
  `;
}

/**
 * `author IN (?, ?, …)`, with one placeholder per name.
 *
 * Only the count of the names is interpolated; every name itself is a bound
 * parameter, so a display name holding a quote is a string to match rather
 * than anything SQLite reads as syntax.
 */
function authorClause(names: readonly string[]): string {
  return `author IN (${names.map(() => '?').join(', ')})`;
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
    in_reply_to: document.inReplyTo ?? null,
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
    ...optional('inReplyTo', text(row['in_reply_to'])),
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

/** The table this store's applied versions are recorded in. */
const LEDGER = 'migrations';

/**
 * Schema versions, applied in order. Never edit a migration that has shipped;
 * append a new one, so a site that upgrades lands on the same schema as a site
 * that starts fresh.
 */
const MIGRATIONS: readonly Migration[] = [
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
];
