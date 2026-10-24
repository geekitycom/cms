import type { Document, DocumentType } from './document.ts';
import type { RedirectTable } from './redirects.ts';
import type { Taxonomy } from './taxonomy.ts';
import type { Clock } from '../util/clock.ts';

/** Directory name that marks a document as thrown away but not yet deleted. */
export const TRASH_DIRECTORY = '_trash';

export interface OpenContentStoreOptions {
  /** Directory the database lives in. Created if it is missing. */
  dataDir: string;
  /**
   * What "now" means to the public queries, for the scheduling clause. Defaults
   * to {@link systemClock}; a test hands one it can move.
   */
  now?: Clock | undefined;
  /**
   * The site's base URL, which the `/replies/` keys of a document are worked
   * out against. Opening with a different one than last time works
   * every key out again; opening with none leaves new rows without keys.
   */
  baseUrl?: string | undefined;
}

/** What, beyond the index, decides which links land on a document. */
export interface BacklinkSite {
  /** The site's declared redirects, as they are now. */
  readonly redirects?: RedirectTable | undefined;
  /** Whether the document is the page the Reading setting shows at `/`. */
  readonly home?: boolean | undefined;
}

export interface IndexClock {
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
}

export interface DocumentLookup {
  /** The document at a content-relative path, or `undefined`. */
  getByPath(path: string): Document | undefined;
  /**
   * The document a URL resolves to, or `undefined`.
   *
   * Permalinks are unique among live documents only: a trashed document keeps
   * its URL so that it can answer 410 Gone, until a live one takes
   * the URL over. The live document wins; a trashed one answers only when
   * nothing live holds the URL.
   */
  getByPermalink(permalink: string): Document | undefined;
  /**
   * The post whose front matter names this ActivityStreams id, or `undefined`.
   *
   * Only a migrated post or one moved after it was published
   * has one: any other post is named by its permalink and
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
   * What a URL a document used to live at resolves to. Only a
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
}

export interface ArchiveReader {
  /** Published, untrashed, already-due, listed posts, newest first. */
  listPosts(options?: ListOptions): Document[];
  /**
   * Every post and page the public site lists, newest first, undated pages
   * last: what the sitemap and `llms.txt` publish, in one query.
   */
  listListed(): Document[];
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
   * Published, untrashed documents carrying a tag in any casing, newest first.
   *
   * Tags match without regard to case: a document hydrated from
   * the index carries each of its tags in the site's spelling, which
   * {@link TaxonomyReader.tagSpelling} names.
   */
  listByTag(tag: string, options?: ListByTagOptions): Document[];
  /** Published, untrashed documents filed under a category, newest first. */
  listByCategory(category: string, options?: ListByTagOptions): Document[];
  /**
   * Published, untrashed, already-due posts whose `author` is one of `names`,
   * newest first: one user's archive.
   *
   * A list of names rather than one, because more than one string can read as
   * the same person: a post's `author` holds a username, and a file written
   * before every user became an actor holds a display name that reads as the
   * one user answering to it. `content/authors.ts` decides which names those
   * are and hands them here, so the index matches strings and never has to know
   * what a user is. An empty list matches nothing, which is what a user whose
   * name nothing resolves to should get.
   *
   * Posts only: an author archive is what somebody wrote, and a page is part
   * of the furniture of the site rather than of anybody's body of work.
   */
  listByAuthor(names: readonly string[], options?: ListOptions): Document[];
  /**
   * The posts of one user's archive that carry a `pinned` key, most recently
   * pinned first and capped at `PINNED_POST_LIMIT`: their featured collection.
   * The same archive {@link ArchiveReader.listByAuthor} reads, so a
   * draft, a trashed post or a scheduled one is never featured.
   */
  listPinnedByAuthor(names: readonly string[]): Document[];
  /** How many published, untrashed documents carry a tag. */
  countByTag(tag: string, options?: ListByTagOptions): number;
  /** How many published, untrashed documents are filed under a category. */
  countByCategory(category: string, options?: ListByTagOptions): number;
  /** How many published posts one user's archive holds. See {@link ArchiveReader.listByAuthor}. */
  countByAuthor(names: readonly string[]): number;
}

export interface TaxonomyReader {
  /** Every tag in use on published, untrashed documents, once each in the site's spelling, with its count. */
  listTags(): TagCount[];
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
   * {@link TaxonomyReader.listTags} is for.
   */
  listTermUsage(taxonomy: Taxonomy): TermUsage[];
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
}

export interface ReplyReader {
  /**
   * Served posts whose `in-reply-to` is exactly one of these URLs, unlisted
   * ones included, newest first: the reply posts a thread shows.
   * Naming nothing returns nothing.
   */
  listRepliesTo(targets: readonly string[]): Document[];
  /** Served posts with an `in-reply-to`, unlisted ones included, newest first. */
  listReplyPosts(options?: ListOptions): Document[];
  /**
   * The served documents a `/replies/` key names: the ones whose
   * feed guid has that key, and the reply posts whose object id has it. One
   * indexed lookup, so a key that names nothing costs nothing else.
   */
  listByRepliesKey(key: string): Document[];
}

export interface BacklinkReader {
  /**
   * The listed posts and pages whose body links to `document`, newest first:
   * its backlinks.
   *
   * A link names a path rather than a document, and is matched to one here,
   * on read: a link to the document's permalink, or to a `redirect_from` of it
   * that still leads to it, whichever way the link was spelled; to `/` when
   * `home` says the document is the homepage; and to any URL the site answers
   * with a redirect that ends on one of those. So a link written
   * before its target existed counts once the target does, a post that
   * becomes public later counts from then, and an edited redirect file moves
   * a backlink, with nothing rewritten. A document linking to itself is not
   * its own backlink.
   */
  listBacklinks(document: Document, site?: BacklinkSite): Document[];
}

export interface SearchReader {
  /**
   * Published, untrashed, already-due posts and pages matching a reader's
   * query, best match first.
   *
   * `query` is what somebody typed, not FTS5 syntax: see `searchExpression`
   * for what it understands. A query with nothing searchable in it finds
   * nothing rather than everything. Relevance is BM25 with a title match
   * counting for more than a match in the description or the taxonomy, and
   * those for more than one in the body; documents that tie are in the order
   * every listing is in, newest first.
   */
  search(query: string, options?: ListOptions): SearchHit[];
  /** How many documents {@link SearchReader.search} would find, for the pager. */
  countSearch(query: string): number;
}

export interface CatalogReader {
  /** Everything the admin may see, trash and drafts included unless filtered. */
  listAll(options?: ListAllOptions): Document[];
  /**
   * Posts the site has announced to the fediverse: the ones whose front matter
   * carries an `activitypub.published`, newest first, drafts, scheduled posts
   * and the trash included.
   *
   * The federation screen's row source, and the reason the filter is a query
   * rather than a walk of {@link CatalogReader.listAll}: a draft and a trashed
   * post belong on that screen — they are what a `Delete` is sent for — so the
   * only thing that decides the list is whether the post was ever announced,
   * which is the same thing as whether a follower holds a copy.
   */
  listFederated(options?: ListOptions): Document[];
  /**
   * Posts a reader can open — not drafts, not trashed, already due, public or
   * unlisted — dated at or after `since`, a UTC instant, oldest first.
   */
  listPostsPublishedSince(since: string): Document[];
  /**
   * Posts waiting for their date — not drafts, not trashed, dated after the
   * index clock — soonest first, at most `limit` of them.
   */
  listScheduledPosts(limit: number): Document[];
  /** Every indexed path, sorted. What a sync compares the content tree against. */
  listPaths(): string[];
  /** How many documents there are of each kind. */
  counts(): ContentCounts;
}

export interface ScheduleReader {
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
}

export interface IndexWriter {
  /**
   * Insert or replace the row for `document.path`, tags and categories
   * included.
   *
   * Throws {@link DuplicatePermalinkError} when another live path already
   * claims the same permalink.
   */
  upsert(document: Document): void;
  /** {@link IndexWriter.upsert} for many documents, in one transaction. */
  upsertAll(documents: Iterable<Document>): void;
  /** Drop a document by path. Returns `false` when there was nothing to drop. */
  remove(path: string): boolean;
  /**
   * Empty the index: every document, its terms and its words.
   *
   * What a rebuild does before it reads the files again, and the
   * counterpart of the `DELETE FROM documents` three migrations run for the
   * same reason. The index is derived and the files are the source of truth,
   * so this loses nothing a scan cannot work out again — and it
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
}

export interface IndexConnection {
  /** Absolute path of the SQLite file. */
  readonly file: string;
  /**
   * Refuse every write on this connection while on, with SQLite's
   * `query_only`. A worker handing over to a new one under `geekity serve`
   * turns it on, so the new worker's boot migrations run alone.
   */
  setReadOnly(readOnly: boolean): void;
  /** Close the database. Safe to call twice. */
  close(): void;
}

/**
 * The derived index over the Markdown files.
 *
 * Files are the source of truth; this is a queryable copy that
 * answers the questions a directory walk cannot answer cheaply. Deleting the
 * database is safe because the next boot rebuilds it.
 */
export interface ContentStore
  extends
    IndexClock,
    DocumentLookup,
    ArchiveReader,
    TaxonomyReader,
    ReplyReader,
    BacklinkReader,
    SearchReader,
    CatalogReader,
    ScheduleReader,
    IndexWriter,
    IndexConnection {}

/**
 * The published posts either side of one, as {@link ArchiveReader.neighbours}
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

/** What {@link CatalogReader.counts} reports. */
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
