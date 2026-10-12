import type { Document } from '../content/document.ts';
import { parseAuthorPath } from './authors.ts';
import { publicDocumentAt } from './documents.ts';
import { commentsFeedPath, COMMENTS_ROOT, splitFeedPath } from './feeds.ts';
import type { FeedFormat } from './feeds.ts';
import { representationHref } from './negotiate.ts';
import type { Representation } from './negotiate.ts';
import { pageCount } from './pagination.ts';
import { decodedPath } from './redirects.ts';
import { encodePath } from './request.ts';
import { archiveOf, homeListing, SITE_POSTS } from './listing-subject.ts';
import type { ListingRequest, ListingSubject } from './listing-subject.ts';
import { servedPath } from './site-view.ts';
import type { SiteView } from './site-view.ts';
import { PAGE_SEGMENT, taxonomyForSegment } from './taxonomy.ts';
import type { TaxonomyTerm } from './taxonomy.ts';

/** What a feed URL syndicates. */
export type FeedTarget =
  | { kind: 'listing'; subject: ListingSubject }
  | { kind: 'comments'; document: Document | undefined };

/**
 * What a decoded path names on the public site: a feed, a page of a listing,
 * or a document. The one reading of the URL grammar that serving a request,
 * finding where a slashless URL belongs, the `.md` and `.json` spellings, the
 * Markdown's links and the oEmbed provider all share.
 */
export type PathMatch =
  | {
      kind: 'feed';
      target: FeedTarget;
      format: FeedFormat;
      /** Whether the URL is the canonical spelling; a WordPress alias is not. */
      canonical: boolean;
    }
  | ({ kind: 'listing' } & ListingRequest)
  | { kind: 'document'; document: Document };

/**
 * What lives at `pathname`, or `undefined` when nothing does.
 *
 * `/` is the homepage when the site has one. Then a feed, then a listing, and
 * only then a document: a listing's URL means the listing however a document
 * is permalinked, which is what lets the taxonomy bases be a setting without a
 * page ever taking an archive's URL. The posts page is the listing it carries
 * rather than the page it also is.
 */
export function classifyPath(view: SiteView, pathname: string): PathMatch | undefined {
  if (pathname === '/' && view.pages.home !== undefined) {
    return { kind: 'document', document: view.pages.home };
  }

  const feed = feedAt(view, pathname);
  if (feed !== undefined) return feed;

  const listing = listingAt(view, pathname);
  if (listing !== undefined) return { kind: 'listing', ...listing };

  const document = publicDocumentAt(view.store, pathname);
  return document === undefined ? undefined : { kind: 'document', document };
}

/**
 * The URL a match is served at, ready for a `Location` header: a listing's
 * page, a feed's canonical spelling, or where a document is served, which is
 * `/` for the homepage.
 */
export function canonicalHref(view: SiteView, match: PathMatch): string {
  switch (match.kind) {
    case 'listing':
      return encodePath(decodedPath(archiveOf(view, match.subject).href(match.pageNumber)));
    case 'feed':
      return match.target.kind === 'listing'
        ? archiveOf(view, match.target.subject).feedHref(match.format)
        : commentsFeedHref(match.target.document);
    case 'document':
      return encodePath(servedPath(match.document, view.pages.home));
  }
}

/** Whether a listing page exists: its number is short of the listing's last page. */
export function inRange(view: SiteView, request: ListingRequest, pageSize: number): boolean {
  return request.pageNumber < pageCount(archiveOf(view, request.subject).count(), pageSize);
}

/**
 * Where a path that arrived without its trailing slash canonically lives, or
 * `undefined` when adding one would not resolve either.
 *
 * Redirecting only to somewhere real means a genuinely missing URL costs one
 * 404 rather than a redirect and then a 404. The target is the canonical URL
 * itself rather than the path with a slash bolted on, so `/page/1` lands on
 * `/` in one hop instead of two, and `/feed/rss` on `/feed/`.
 */
export function slashedHref(
  view: SiteView,
  pathname: string,
  pageSize: number,
): string | undefined {
  if (pathname === '' || pathname.endsWith('/')) return undefined;
  const slashed = `${pathname}/`;

  const match = classifyPath(view, slashed);
  if (match === undefined) return movedHref(view, slashed, undefined);
  if (match.kind === 'listing' && !inRange(view, match, pageSize)) return undefined;
  return canonicalHref(view, match);
}

/**
 * Where the document that used to live at a URL lives now, in the
 * representation asked for, or `undefined` when no published document names
 * the URL in its `redirect_from` (TASK-127).
 */
export function movedHref(
  view: SiteView,
  pathname: string,
  representation: Representation | undefined,
): string | undefined {
  const document = view.store.getByFormerPermalink(pathname);
  if (document === undefined) return undefined;
  const href = encodePath(servedPath(document, view.pages.home));
  return representation === undefined ? href : representationHref(href, representation);
}

/**
 * Where the site's comments feed lives, and where one document's does.
 *
 * WordPress's URLs, so a site migrated from it keeps both: the whole site's
 * comments at `/comments/feed/`, and a document's under its own permalink. There
 * is one format, RSS 2.0, because that is what a comments feed is read in.
 */
export function commentsFeedHref(document: Document | undefined): string {
  return commentsFeedPath(document === undefined ? undefined : encodePath(document.permalink));
}

/**
 * A path as the feed it names: `/feed/`, `/feed/atom/`, `/{base}/x/feed/json/`,
 * the comments feeds at `/comments/feed/` and `{permalink}feed/`, and the
 * `/feed/rss/` spelling WordPress also answered at any of those roots.
 *
 * A listing's feeds hang off its root whatever the Reading setting says, and
 * only off its first page: a feed is not paginated, so `/{base}/x/page/2/feed/`
 * names nothing. Any other root may be a document whose page shows its
 * conversation, which is the only feed a document has.
 */
function feedAt(view: SiteView, pathname: string): PathMatch | undefined {
  const split = splitFeedPath(pathname);
  if (split === undefined) return undefined;
  const { format, canonical } = split;
  const feed = (target: FeedTarget): PathMatch => ({ kind: 'feed', target, format, canonical });

  if (split.root === COMMENTS_ROOT) {
    return format === 'rss' ? feed({ kind: 'comments', document: undefined }) : undefined;
  }

  const root = parsedListing(view, split.root);
  if (root !== undefined) {
    return root.pageNumber === 0 ? feed({ kind: 'listing', subject: root.subject }) : undefined;
  }

  if (format !== 'rss') return undefined;
  const document = publicDocumentAt(view.store, split.root);
  if (document === undefined || !view.showsConversation(document)) return undefined;
  return feed({ kind: 'comments', document });
}

/**
 * A path as the page of a listing it names, wherever the Reading setting has
 * put the listing.
 *
 * The posts page first, because its permalink is the listing's root on a site
 * that has one. Then the ordinary grammar, slashed paths only: `/page/N/` is a
 * page of the posts page's listing on a site with one, and nothing on a site
 * whose homepage is a page and which named no posts page.
 */
function listingAt(view: SiteView, pathname: string): ListingRequest | undefined {
  const { posts } = view.pages;
  const onPostsPage = posts === undefined ? undefined : postsPageRequest(posts, pathname);
  if (onPostsPage !== undefined) return onPostsPage;

  if (!pathname.endsWith('/')) return undefined;
  const request = parsedListing(view, pathname);
  if (request?.subject.kind !== 'home') return request;

  const home = homeListing(view.pages);
  return home === undefined ? undefined : { subject: home, pageNumber: request.pageNumber };
}

/**
 * `{permalink}` or `{permalink}page/N/` as a page of the listing the posts
 * page carries, or `undefined` when the path is neither.
 */
function postsPageRequest(postsPage: Document, pathname: string): ListingRequest | undefined {
  const { permalink } = postsPage;
  const subject: ListingSubject = { kind: 'home', postsPage };
  if (pathname === permalink) return { subject, pageNumber: 0 };
  if (!pathname.startsWith(permalink) || !pathname.endsWith('/')) return undefined;

  const segments = pathname
    .slice(permalink.length)
    .split('/')
    .filter((segment) => segment !== '');
  if (segments.length !== 2 || segments[0] !== PAGE_SEGMENT) return undefined;

  const page = pageIndex(segments[1]);
  return page === undefined ? undefined : { subject, pageNumber: page };
}

/**
 * `/`, `/page/N/`, `/author/{username}/` and `/author/{username}/page/N/`, and
 * either taxonomy's `/{base}/x/` and `/{base}/x/page/N/`, as the listing they
 * spell, whatever the Reading setting says about where the site's posts are.
 */
function parsedListing(view: SiteView, pathname: string): ListingRequest | undefined {
  const segments = pathname.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) return { subject: SITE_POSTS, pageNumber: 0 };

  if (segments[0] === PAGE_SEGMENT && segments.length === 2) {
    const page = pageIndex(segments[1]);
    return page === undefined ? undefined : { subject: SITE_POSTS, pageNumber: page };
  }

  // A username nobody has is not a listing at all, which is what turns it into
  // one 404 rather than an empty archive.
  const byAuthor = parseAuthorPath(pathname);
  if (byAuthor !== undefined) {
    const author = view.author(byAuthor.username);
    return author === undefined
      ? undefined
      : { subject: { kind: 'author', author }, pageNumber: byAuthor.pageNumber };
  }

  // A taxonomy archive exists only while a published post carries the term,
  // so a term nothing carries is not a listing, whatever its path says.
  const asked = parseTermPath(view, pathname);
  if (asked === undefined) return undefined;
  const spelled = carriedSpelling(view, asked.term);
  return spelled === undefined
    ? undefined
    : {
        subject: { kind: 'term', term: { ...asked.term, term: spelled } },
        pageNumber: asked.pageNumber,
      };
}

/**
 * `/{base}/x/` and `/{base}/x/page/N/` as the term and page they name, as the
 * path spells them, whether or not anything carries the term.
 */
export function parseTermPath(
  view: Pick<SiteView, 'bases'>,
  pathname: string,
): { term: TaxonomyTerm; pageNumber: number } | undefined {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  const taxonomy = taxonomyForSegment(segments[0], view.bases);
  const named = segments[1];
  if (taxonomy === undefined || named === undefined) return undefined;
  const term: TaxonomyTerm = { taxonomy, term: named };

  if (segments.length === 2) return { term, pageNumber: 0 };
  if (segments.length === 4 && segments[2] === PAGE_SEGMENT) {
    const page = pageIndex(segments[3]);
    return page === undefined ? undefined : { term, pageNumber: page };
  }
  return undefined;
}

/**
 * How the site spells a term some published post carries, matched without
 * regard to case, or `undefined` when none carries it (TASK-339).
 *
 * A tag's casings are one term (TASK-308). A category stays as spelled, so a
 * category carried in exactly the asked spelling wins, and otherwise the most
 * used one that differs only in case: WordPress lower-cased every slug, so an
 * imported `/category/rsscloud/` names the category spelled `rssCloud`.
 */
function carriedSpelling(view: SiteView, term: TaxonomyTerm): string | undefined {
  const { store } = view;
  if (term.taxonomy === 'tag') {
    return store.countByTag(term.term) > 0 ? store.tagSpelling(term.term) : undefined;
  }
  if (store.countByCategory(term.term) > 0) return term.term;
  const key = term.term.toLowerCase();
  return store.listCategories().find(({ category }) => category.toLowerCase() === key)?.category;
}

/**
 * A `/page/N/` segment as a zero-based index. `page/1` parses to the first
 * page, which lives at the listing root, so canonicalisation collapses it.
 */
function pageIndex(segment: string | undefined): number | undefined {
  if (segment === undefined || !/^[0-9]+$/.test(segment)) return undefined;
  const requested = Number(segment);
  return requested < 1 ? undefined : requested - 1;
}
