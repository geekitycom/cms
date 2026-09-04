import type { Context, Hono } from 'hono';

import { readSiteSettings } from '../admin/settings.ts';
import type { Document } from '../content/document.ts';
import type { ContentStore, ListOptions } from '../content/store.ts';
import { serializeDocument } from '../content/writer.ts';
import type { GeekityEnv } from '../env.ts';
import { findImageVariant, VARIANT_ASSET_PREFIX } from '../images/variants.ts';
import {
  assetNotModified,
  assetResponse,
  findThemeAsset,
  findUpload,
  matchesEtag,
  themeAssetNotModified,
  themeAssetResponse,
  themeSearchPath,
  THEME_ASSET_PREFIX,
  UPLOAD_ASSET_MAX_AGE,
  UPLOAD_ASSET_PREFIX,
} from './assets.ts';
import { COMMENT_NOTICE_PARAM, COMMENT_REPLY_PARAM } from '../comments/form.ts';
import { commentNoticeFor, commentReplyTarget, mountComments } from '../comments/routes.ts';
import { mountWebmentions, WEBMENTION_PATH } from '../webmention/routes.ts';
import { commentCounts, postComments, siteComments } from './comments.ts';
import { isPublicDocument, publicDocumentAt } from './documents.ts';
import {
  commentsFeedPath,
  commentsFeedResponse,
  feedPathUnder,
  feedResponse,
  feedSize,
  splitFeedPath,
  COMMENTS_ROOT,
  COMMENTS_TITLE_PREFIX,
  FEED_FORMATS,
  FEED_SEGMENTS,
} from './feeds.ts';
import type { CommentFeedSource, FeedComment, FeedFormat, FeedSource } from './feeds.ts';
import {
  DOCUMENT_REPRESENTATIONS,
  documentJson,
  LISTING_REPRESENTATIONS,
  lastModifiedOf,
  latestModified,
  notAcceptableResponse,
  representationEtag,
  representationResponse,
  selectRepresentation,
  splitRepresentationExtension,
} from './negotiate.ts';
import type { ConditionalHeaders, Representation } from './negotiate.ts';
import { offsetForPage, paginate } from './pagination.ts';
import type { Pagination } from './pagination.ts';
import { TEMPLATES } from './render.ts';
import {
  robotsResponse,
  sitemapResponse,
  ROBOTS_PATH,
  SITEMAP_CHILD_ROUTE,
  SITEMAP_PATH,
} from './sitemap.ts';
import type { SitemapUrl } from './sitemap.ts';
import { PAGE_SEGMENT, redirectedTerm, taxonomyForSegment, termHref } from './taxonomy.ts';
import type { TaxonomyBases, TaxonomyTerm } from './taxonomy.ts';

/**
 * Register the public site on a Hono app.
 *
 * The listings and the theme assets are routes; a document is resolved in the
 * not-found handler instead. That ordering is deliberate: admin and federation
 * routes registered after this one still win, and a permalink can never shadow
 * them, because the document lookup only runs once nothing else has matched.
 */
export function mountPublicSite(app: Hono<GeekityEnv>): void {
  app.get(`${THEME_ASSET_PREFIX}*`, themeAsset);
  // Derived images go on first: their prefix is inside the uploads one, so the
  // general route would otherwise swallow them and answer 404 for a file that
  // is not under `content/uploads/` at all.
  app.get(`${VARIANT_ASSET_PREFIX}*`, imageVariant);
  app.get(`${UPLOAD_ASSET_PREFIX}*`, upload);

  // Where the comment form under a post posts to (TASK-50). A POST at a fixed
  // path of the CMS's own, so no permalink can ever shadow it and the route
  // table does not grow with the site.
  mountComments(app);

  // And where a webmention is sent (TASK-51), for the same reason and under
  // the same prefix.
  mountWebmentions(app);

  app.get('/', (c) => listing(c, { term: undefined, pageNumber: 0 }));

  app.get(`/${PAGE_SEGMENT}/:page{[0-9]+}/`, (c) => {
    const requested = Number(c.req.param('page'));
    // Page one is the home page; it does not get a second URL.
    if (requested <= 1) return c.redirect('/', 301);
    return listing(c, { term: undefined, pageNumber: requested - 1 });
  });

  // The site's own feeds are routes rather than representations, so a reader's
  // careless `Accept` header cannot land it on the HTML (doc-3), and so a
  // document permalinked at `/feed/` cannot take the subscribers' URL. Their
  // paths are fixed — only the taxonomy feeds hang off a configurable base —
  // so the route table can hold them.
  for (const format of FEED_FORMATS) {
    app.get(feedPathUnder('/', format), (c) => feed(c, format, undefined));
  }

  // The site-wide comments feed, for the same reason and at WordPress's URL.
  app.get(commentsFeedHref(undefined), (c) => comments(c, undefined));

  // The sitemap, its children and the robots file: fixed paths at the root of
  // the site, which is the only place a crawler looks, and routes for the same
  // reason the feeds are — no document permalinked there can take the URL a
  // search engine polls.
  app.get(SITEMAP_PATH, (c) => sitemap(c, undefined));
  app.get(SITEMAP_CHILD_ROUTE, (c) => sitemap(c, Number(c.req.param('page'))));
  app.get(ROBOTS_PATH, (c) => robotsResponse(c.var.config.baseUrl, conditionalHeaders(c)));

  // The taxonomy archives are deliberately not routes. A route table is fixed
  // when the app is built and the bases are a setting, so an archive is
  // resolved per request in the not-found handler, from the base the site
  // holds at that moment (TASK-36).
  app.notFound(resolveRequest);
}

/**
 * The last stop for a request: a taxonomy archive or one of its feeds, the
 * document at this URL, the same document in the representation a `.md` or
 * `.json` suffix asked for, the canonical URL it should have asked for, or the
 * theme's 404.
 *
 * The archives come first, so an archive URL means the archive however a
 * document is permalinked; they are here rather than in the route table
 * because their bases are a setting, and a route table is fixed when the app
 * is built. The suffix is stripped and the *same* {@link publicDocumentAt}
 * lookup runs again, so no representation can resolve to a document the others
 * cannot see.
 */
function resolveRequest(c: Context<GeekityEnv>): Response {
  const { store, renderer } = c.var;
  const pathname = requestPath(c);
  const bases = renderer.taxonomyBases();

  const feedRequest = parseFeedPath(store, pathname, bases);
  if (feedRequest !== undefined) {
    const { target, format } = feedRequest;
    if (!feedRequest.canonical) return c.redirect(feedTargetHref(target, format, bases), 301);
    return target.kind === 'listing' ? feed(c, format, target.term) : comments(c, target.document);
  }

  const archive = taxonomyArchive(c, pathname, bases);
  if (archive !== undefined) return archive;

  const document = publicDocumentAt(store, pathname);
  if (document !== undefined) {
    // WordPress answered `?feed=rss2` on a permalink with that post's comments
    // feed, which is the only feed a post has here too. The other spellings
    // name a format a comments feed does not come in, so they are not a feed
    // request at all and the page is served.
    if (document.type === 'post' && queryFeedFormat(c) === 'rss') {
      return c.redirect(commentsFeedHref(document), 301);
    }
    return negotiateDocument(c, document, selectFromAccept(c, DOCUMENT_REPRESENTATIONS));
  }

  const extension = splitRepresentationExtension(pathname);
  if (extension !== undefined) {
    for (const candidate of extension.paths) {
      const found = publicDocumentAt(store, candidate);
      if (found !== undefined) return negotiateDocument(c, found, extension.representation);
    }

    // `/index.json`, `/page/2/index.json`, `/tag/x/index.json`,
    // `/category/x/index.json`: the same escape hatch over a listing, for the
    // representations a listing has.
    if (LISTING_REPRESENTATIONS.includes(extension.representation)) {
      for (const candidate of extension.paths) {
        const request = parseListingPath(candidate, bases);
        if (request !== undefined) return listing(c, request, extension.representation);
      }
    }
  }

  const canonical = canonicalPath(c, pathname, bases);
  if (canonical !== undefined) return c.redirect(canonical, 301);

  return notFound(c);
}

/**
 * One taxonomy archive, the redirect that puts it at its canonical URL, or
 * `undefined` when the path is not one.
 *
 * `/{base}/x/page/1/` collapses onto the archive root the way `/page/1/`
 * collapses onto the home page, and an archive nothing carries 404s rather
 * than redirecting first: a URL that leads nowhere should cost one 404, not a
 * redirect and then a 404.
 */
function taxonomyArchive(
  c: Context<GeekityEnv>,
  pathname: string,
  bases: TaxonomyBases,
): Response | undefined {
  if (!pathname.endsWith('/')) return undefined;

  const request = parseListingPath(pathname, bases);
  if (request?.term === undefined) return undefined;

  // An archive that answers is served; only once nothing carries the term is
  // the record of renames consulted, so a term that comes back into use — or
  // one that was merged into and then recreated — beats what it used to be
  // called. One hop: the list is stored with its chains already collapsed.
  if (countListing(c.var.store, request.term) === 0) {
    const moved = movedTerm(c, request.term);
    if (moved !== undefined) return c.redirect(termHref(moved, request.pageNumber, bases), 301);
  }

  const canonical = termHref(request.term, request.pageNumber, bases);
  if (canonical !== encodePath(pathname)) {
    return countListing(c.var.store, request.term) === 0 ? notFound(c) : c.redirect(canonical, 301);
  }

  return listing(c, request);
}

/**
 * Where a term with nothing left under it went, or `undefined` when the site
 * records no such rename.
 */
function movedTerm(c: Context<GeekityEnv>, term: TaxonomyTerm): TaxonomyTerm | undefined {
  const moved = redirectedTerm(c.var.renderer.termRedirects(), term);
  return moved === undefined ? undefined : { taxonomy: term.taxonomy, term: moved };
}

/** What a feed URL syndicates. */
type FeedTarget =
  | { kind: 'listing'; term: TaxonomyTerm | undefined }
  | { kind: 'comments'; document: Document | undefined };

/** One feed, from the URL it was asked for at. */
interface FeedRequest {
  /** What the feed is over: a listing, or somebody's comments. */
  target: FeedTarget;
  /** Which format the URL asked for. */
  format: FeedFormat;
  /** Whether the URL is the canonical spelling; a WordPress alias is not. */
  canonical: boolean;
}

/**
 * A path as the feed it names: `/feed/`, `/feed/atom/`, `/{base}/x/feed/json/`,
 * the comments feeds at `/comments/feed/` and `{permalink}feed/`, and the
 * `/feed/rss/` spelling WordPress also answered at any of those roots.
 *
 * The site's own canonical feeds are real routes and never reach here; what
 * does reach here is every taxonomy feed — their bases are a setting, so they
 * cannot be in the route table — every post's comments feed, and every alias.
 */
function parseFeedPath(
  store: ContentStore,
  pathname: string,
  bases: TaxonomyBases,
): FeedRequest | undefined {
  const split = splitFeedPath(pathname);
  if (split === undefined) return undefined;
  const { format, canonical } = split;

  if (split.root === COMMENTS_ROOT) {
    return format === 'rss'
      ? { target: { kind: 'comments', document: undefined }, format, canonical }
      : undefined;
  }

  const root = parseListingPath(split.root, bases);
  // Only a listing root has a feed, and only its first page: a feed is not
  // paginated, so `/{base}/x/page/2/feed/` names nothing.
  if (root !== undefined) {
    return root.pageNumber === 0
      ? { target: { kind: 'listing', term: root.term }, format, canonical }
      : undefined;
  }

  // Otherwise it may be a post's comments feed. Only a published post has one:
  // a page never federates, so nothing in the fediverse can ever have replied
  // to it, and a comments feed for it would be empty for ever.
  if (format !== 'rss') return undefined;
  const document = publicDocumentAt(store, split.root);
  if (document?.type !== 'post') return undefined;

  return { target: { kind: 'comments', document }, format, canonical };
}

/** Where the canonical URL of one feed is. */
function feedTargetHref(target: FeedTarget, format: FeedFormat, bases: TaxonomyBases): string {
  return target.kind === 'listing'
    ? feedHref(target.term, format, bases)
    : commentsFeedHref(target.document);
}

/**
 * The format `?feed=` asked for, WordPress's pre-permalink spelling, or
 * `undefined` when the request did not ask for a feed at all.
 *
 * `rss2` is what WordPress calls RSS 2.0 and `rss` its RSS 0.92, which this
 * site does not serve and answers with the RSS 2.0 feed rather than a 404.
 */
function queryFeedFormat(c: Context<GeekityEnv>): FeedFormat | undefined {
  const asked = c.req.query('feed');
  if (asked === undefined) return undefined;
  if (asked === 'rss2' || asked === 'rss') return 'rss';
  return FEED_FORMATS.find((format) => FEED_SEGMENTS[format] === asked);
}

/**
 * What the query string puts on a rendered post, if anything.
 *
 * A reader has no session, so the message after a submission travels in the
 * URL and is read back here. An unknown value says nothing at all rather than
 * being printed, so the query cannot be used to put words on somebody's post.
 */
function commentNotice(c: Context<GeekityEnv>, document: Document): Record<string, unknown> {
  const notice = commentNoticeFor(c.req.query(COMMENT_NOTICE_PARAM));

  return {
    ...(notice === undefined ? {} : { commentNotice: notice }),
    // And who a Reply link says the form is answering, which travels the same
    // way and for the same reason: a reader has no session, and threading
    // should not need a line of JavaScript.
    ...commentReplyTarget({
      admin: c.var.admin,
      document,
      id: c.req.query(COMMENT_REPLY_PARAM),
    }),
  };
}

/** The representation an `Accept` header asked for, or `undefined` for a 406. */
function selectFromAccept(
  c: Context<GeekityEnv>,
  available: readonly Representation[],
): Representation | undefined {
  return selectRepresentation(c.req.header('accept'), available);
}

/** One document in one representation, or the 406 an impossible `Accept` earns. */
function negotiateDocument(
  c: Context<GeekityEnv>,
  document: Document,
  representation: Representation | undefined,
): Response {
  if (representation === undefined) {
    return notAcceptableResponse(encodePath(document.permalink), DOCUMENT_REPRESENTATIONS);
  }

  const body =
    representation === 'markdown'
      ? serializeDocument(document)
      : representation === 'json'
        ? documentJson(document, { baseUrl: c.var.config.baseUrl })
        : // The thank-you after a comment was posted, which the redirect
          // carried back as a query. It is the only thing about a document's
          // HTML that the URL rather than the file decides.
          c.var.renderer.renderDocument(document, commentNotice(c, document));

  // The theme can change without the document changing, and only the document
  // is hashed. While the watcher is on — a development server, where a template
  // edit lands mid-process — the HTML gets no validator rather than a stale one.
  const validated = representation !== 'html' || !c.var.config.watch;

  return representationResponse({
    body,
    representation,
    href: encodePath(document.permalink),
    available: DOCUMENT_REPRESENTATIONS,
    // Where a webmention about this page is sent. It is a header rather than
    // only a `<link>` because a sender is allowed to find the endpoint without
    // parsing the page, and because the JSON and Markdown representations of a
    // post have no head to put one in (TASK-51).
    links: webmentionLinks(c),
    ...(validated
      ? {
          etag: representationEtag(representation, document.hash),
          lastModified: lastModifiedOf(document),
        }
      : {}),
    conditional: conditionalHeaders(c),
  });
}

/**
 * The `Link` header advertising this site's webmention endpoint, or none when
 * the site does not take them.
 *
 * Read per request off the settings, so turning webmentions off on the
 * settings screen takes the advertisement off the very next page rather than
 * off the next restart.
 */
function webmentionLinks(c: Context<GeekityEnv>): string[] {
  if (!readSiteSettings(c.var.config.contentDir).webmentionsReceive) return [];
  return [`<${WEBMENTION_PATH}>; rel="webmention"`];
}

/** The conditional request headers, as the negotiator wants them. */
function conditionalHeaders(c: Context<GeekityEnv>): ConditionalHeaders {
  return {
    ifNoneMatch: c.req.header('if-none-match'),
    ifModifiedSince: c.req.header('if-modified-since'),
  };
}

/**
 * The canonical URL for a path that arrived without its trailing slash, or
 * `undefined` when adding one would not resolve either.
 *
 * Redirecting only to somewhere real means a genuinely missing URL costs one
 * 404 rather than a redirect and then a 404. The target is the canonical URL
 * itself rather than the path with a slash bolted on, so `/page/1` lands on
 * `/` in one hop instead of two.
 */
function canonicalPath(
  c: Context<GeekityEnv>,
  pathname: string,
  bases: TaxonomyBases,
): string | undefined {
  if (pathname === '' || pathname.endsWith('/')) return undefined;

  const target = canonicalTarget(c, `${pathname}/`, bases);
  if (target === undefined) return undefined;

  return `${target}${new URL(c.req.url).search}`;
}

/** Where a path with a trailing slash canonically lives, if anywhere. */
function canonicalTarget(
  c: Context<GeekityEnv>,
  pathname: string,
  bases: TaxonomyBases,
): string | undefined {
  const { store, renderer } = c.var;

  // A feed first: `/feed`, `/feed/atom`, `/{base}/x/feed`, `/comments/feed`
  // and a post's `{permalink}feed` all lead somewhere real, and `/feed/rss`
  // leads to `/feed/` in the same one hop rather than to a second redirect.
  const feedRequest = parseFeedPath(store, pathname, bases);
  if (feedRequest !== undefined) {
    const { target } = feedRequest;
    if (
      target.kind === 'listing' &&
      target.term !== undefined &&
      countListing(store, target.term) === 0
    ) {
      return undefined;
    }
    return feedTargetHref(target, feedRequest.format, bases);
  }

  const document = store.getByPermalink(pathname);
  if (document !== undefined) {
    return isPublicDocument(document) ? encodePath(pathname) : undefined;
  }

  const listing = parseListingPath(pathname, bases);
  if (listing === undefined) return undefined;

  // The home listing exists even with nothing on it; a taxonomy archive does not.
  const total = countListing(store, listing.term);
  if (listing.term !== undefined && total === 0) return undefined;

  const totalPages = Math.max(1, Math.ceil(total / renderer.pageSize()));
  if (listing.pageNumber >= totalPages) return undefined;

  return listingHref(listing.term, listing.pageNumber, bases);
}

/** Which page of which listing a request is for. */
interface ListingRequest {
  /** The archive this is, or `undefined` for the home listing. */
  term: TaxonomyTerm | undefined;
  /** Zero-based index of the page. */
  pageNumber: number;
}

/**
 * `/`, `/page/N/`, and either taxonomy's `/{base}/x/` and `/{base}/x/page/N/`,
 * as a listing to check.
 */
function parseListingPath(pathname: string, bases: TaxonomyBases): ListingRequest | undefined {
  const segments = pathname.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) return { term: undefined, pageNumber: 0 };

  if (segments[0] === PAGE_SEGMENT && segments.length === 2) {
    const page = pageIndex(segments[1]);
    return page === undefined ? undefined : { term: undefined, pageNumber: page };
  }

  const taxonomy = taxonomyForSegment(segments[0], bases);
  if (taxonomy === undefined || segments[1] === undefined) return undefined;
  const term: TaxonomyTerm = { taxonomy, term: segments[1] };

  if (segments.length === 2) return { term, pageNumber: 0 };
  if (segments.length === 4 && segments[2] === PAGE_SEGMENT) {
    const page = pageIndex(segments[3]);
    return page === undefined ? undefined : { term, pageNumber: page };
  }
  return undefined;
}

/** How many published documents a listing holds. */
function countListing(store: ContentStore, term: TaxonomyTerm | undefined): number {
  if (term === undefined) return store.counts().posts;
  return term.taxonomy === 'tag' ? store.countByTag(term.term) : store.countByCategory(term.term);
}

/** One page of a listing's documents, newest first. */
function listListing(
  store: ContentStore,
  term: TaxonomyTerm | undefined,
  paging: ListOptions,
): Document[] {
  if (term === undefined) return store.listPosts(paging);
  return term.taxonomy === 'tag'
    ? store.listByTag(term.term, paging)
    : store.listByCategory(term.term, paging);
}

/** The URL of a page of a listing: the home archive's, or a taxonomy's. */
function listingHref(term: TaxonomyTerm | undefined, index: number, bases: TaxonomyBases): string {
  return term === undefined ? homeHref(index) : termHref(term, index, bases);
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

/** One page of a listing, in whichever representation the request settled on. */
function listing(
  c: Context<GeekityEnv>,
  request: ListingRequest,
  representation: Representation | undefined = selectFromAccept(c, LISTING_REPRESENTATIONS),
): Response {
  const { store, renderer } = c.var;
  const { term } = request;
  const size = renderer.pageSize();
  const bases = renderer.taxonomyBases();

  // WordPress served every feed as a query on the listing before it served one
  // at a path, and the links are still out there. `/?feed=rss2` and
  // `/{base}/x/?feed=atom` land on the feed the listing now has.
  const asked = queryFeedFormat(c);
  if (asked !== undefined) return c.redirect(feedHref(term, asked, bases), 301);

  // A taxonomy archive only exists while something carries the term; the home
  // listing exists even with nothing on it.
  const total = countListing(store, term);
  if (term !== undefined && total === 0) return notFound(c);

  const href = listingHref(term, request.pageNumber, bases);
  const pagination = paginate({
    total,
    size,
    pageNumber: request.pageNumber,
    hrefForPage: (index) => listingHref(term, index, bases),
  });

  if (request.pageNumber >= pagination.totalPages) return notFound(c);
  if (representation === undefined) return notAcceptableResponse(href, LISTING_REPRESENTATIONS);

  const paging = { limit: size, offset: offsetForPage(request.pageNumber, size) };
  const documents = listListing(store, term, paging);

  const full = wantsFullDocuments(c);
  const body =
    representation === 'json'
      ? documents.map((document) =>
          documentJson(document, { baseUrl: c.var.config.baseUrl, body: full }),
        )
      : renderer.renderListing({
          title: term?.term ?? renderer.site().title,
          url: href,
          documents,
          pagination,
          ...(term === undefined ? {} : taxonomyContext(term)),
        });

  const validated = representation !== 'html' || !c.var.config.watch;

  return representationResponse({
    body,
    representation,
    href,
    available: LISTING_REPRESENTATIONS,
    ...(validated
      ? {
          etag: representationEtag(
            representation,
            listingFingerprint(href, pagination, documents, full),
          ),
          lastModified: latestModified(documents),
        }
      : {}),
    conditional: conditionalHeaders(c),
  });
}

/**
 * Whether the request asked for whole documents rather than summaries.
 *
 * Anything but an explicit denial counts, so `?full`, `?full=1` and `?full=yes`
 * all mean the same thing to someone typing a URL by hand.
 */
function wantsFullDocuments(c: Context<GeekityEnv>): boolean {
  const value = c.req.query('full');
  return value !== undefined && value !== '0' && value.toLowerCase() !== 'false';
}

/**
 * What a listing page is made of, as one string to hash.
 *
 * The documents on the page are not the whole story: the same two posts on a
 * differently sized archive are a different page, and a summary is not the
 * body, so the pagination and the `full` flag are in the fingerprint too.
 */
function listingFingerprint(
  href: string,
  pagination: Pagination,
  documents: readonly Document[],
  full: boolean,
): string {
  return [
    href,
    `${String(pagination.pageNumber)}/${String(pagination.totalPages)}/${String(pagination.total)}`,
    full ? 'full' : 'summary',
    ...documents.map((document) => document.hash),
  ].join('\n');
}

/**
 * The site's feed, or one archive's, in one format.
 *
 * A term with nothing published under it 404s exactly as its archive does: a
 * feed reader should be told the URL is wrong rather than handed an empty feed
 * it will poll forever.
 */
function feed(
  c: Context<GeekityEnv>,
  format: FeedFormat,
  term: TaxonomyTerm | undefined,
): Response {
  const { store, renderer, config } = c.var;
  const site = renderer.site();
  const bases = renderer.taxonomyBases();

  if (term !== undefined && countListing(store, term) === 0) {
    // A subscriber to a renamed archive's feed follows it to the new one
    // rather than being dropped, exactly as a reader of the archive does.
    const moved = movedTerm(c, term);
    if (moved === undefined) return notFound(c);
    return c.redirect(feedHref(moved, format, bases), 301);
  }

  const documents = listListing(store, term, { limit: feedSize(site) });
  const href = listingHref(term, 0, bases);

  const source: FeedSource = {
    site,
    documents,
    title: term === undefined ? site.title : `${site.title}: ${term.term}`,
    href,
    feedHref: feedHref(term, format, bases),
    baseUrl: config.baseUrl,
    // Only RSS carries the comment pointers; the other two formats have no
    // vocabulary for them, and counting for a feed that cannot say the number
    // would be a query per item for nothing.
    ...(format === 'rss'
      ? {
          commentCounts: commentCounts(
            { admin: c.var.admin, store, baseUrl: config.baseUrl },
            documents,
          ),
        }
      : {}),
  };

  return feedResponse({ format, source, conditional: conditionalHeaders(c) });
}

/**
 * A post's comments, or the whole site's, as RSS 2.0.
 *
 * A post with no replies answers an empty feed rather than a 404: it exists,
 * and a reader that subscribed before anybody answered should keep polling.
 * Only a permalink that is no published post 404s, which is the ordinary
 * document lookup rather than anything this feed decides.
 */
function comments(c: Context<GeekityEnv>, document: Document | undefined): Response {
  const { store, admin, renderer, config } = c.var;
  const site = renderer.site();
  const context = { admin, store, baseUrl: config.baseUrl };
  const limit = feedSize(site);

  // A post's own feed hands the builder replies with no post attached, and so
  // its items name no post: there, every item answers the same one.
  const found: readonly FeedComment[] =
    document === undefined ? siteComments(context, limit) : postComments(context, document, limit);

  const source: CommentFeedSource = {
    site,
    comments: found,
    title:
      document === undefined
        ? `${site.title}: comments`
        : `${COMMENTS_TITLE_PREFIX}${document.title}`,
    href: document?.permalink ?? '/',
    feedHref: commentsFeedHref(document),
    baseUrl: config.baseUrl,
  };

  return commentsFeedResponse(source, conditionalHeaders(c));
}

/**
 * The sitemap, or one of its children once the site is too big for one file.
 *
 * A child that does not exist 404s through the theme like any other missing
 * URL: `/sitemap-1.xml` names nothing at all on a site whose whole sitemap
 * fits, and a crawler asking for one should be told so rather than handed an
 * empty file it would come back to.
 */
function sitemap(c: Context<GeekityEnv>, page: number | undefined): Response {
  const response = sitemapResponse({
    urls: sitemapUrls(c),
    baseUrl: c.var.config.baseUrl,
    page,
    conditional: conditionalHeaders(c),
  });
  return response ?? notFound(c);
}

/**
 * Every URL the public site publishes, in the order the sitemap lists them:
 * the home archive's pages, then every post and page, then every tag archive
 * and every category archive with their own pages.
 *
 * Everything here is spelled by the same functions the site's own links go
 * through — {@link homeHref}, the permalinks, {@link termHref} — and drawn
 * from the same queries the listings use, so a sitemap can never advertise a
 * URL the site does not serve. Nothing hidden reaches it either: the index's
 * public queries already exclude drafts, the trash and posts whose date has
 * not arrived, and {@link isPublicDocument} is asked again with the store's
 * own clock so the two answers cannot drift apart.
 */
function sitemapUrls(c: Context<GeekityEnv>): SitemapUrl[] {
  const { store, renderer } = c.var;
  const now = store.now();
  const size = renderer.pageSize();
  const bases = renderer.taxonomyBases();
  const urls: SitemapUrl[] = [];

  /** The pages of one listing, each dated by the newest document on it. */
  const listingPages = (
    documents: readonly Document[],
    hrefForPage: (index: number) => string,
  ): void => {
    const totalPages = Math.max(1, Math.ceil(documents.length / size));
    for (let index = 0; index < totalPages; index += 1) {
      const onPage = documents.slice(index * size, (index + 1) * size);
      urls.push({ loc: hrefForPage(index), lastmod: latestModified(onPage) });
    }
  };

  const posts = store.listPosts().filter((document) => isPublicDocument(document, now));
  listingPages(posts, homeHref);

  const pages = store
    .listAll({ type: 'page', draft: false, trashed: false, scheduled: false })
    .filter((document) => isPublicDocument(document, now));

  for (const document of [...posts, ...pages]) {
    urls.push({ loc: document.permalink, lastmod: lastModifiedOf(document) });
  }

  // A taxonomy archive exists only while something public carries the term,
  // which is exactly what these two queries report.
  for (const { tag } of store.listTags()) {
    const term: TaxonomyTerm = { taxonomy: 'tag', term: tag };
    listingPages(store.listByTag(tag), (index) => termHref(term, index, bases));
  }
  for (const { category } of store.listCategories()) {
    const term: TaxonomyTerm = { taxonomy: 'category', term: category };
    listingPages(store.listByCategory(category), (index) => termHref(term, index, bases));
  }

  return urls;
}

/**
 * A file from the theme's `static/` directory, the site's copy first.
 *
 * Assets are cacheable and validated, so a browser that already has one pays a
 * conditional request rather than a download.
 */
function themeAsset(c: Context<GeekityEnv>): Response {
  const relative = requestPath(c).slice(THEME_ASSET_PREFIX.length);
  const asset = findThemeAsset(relative, themeSearchPath(c.var.config.themeDir));
  if (asset === undefined) return notFound(c);

  if (matchesEtag(c.req.header('if-none-match'), asset.etag)) {
    return themeAssetNotModified(asset);
  }
  return themeAssetResponse(asset);
}

/**
 * One derived copy of an upload, generated on the spot if it is not there.
 *
 * The directory these live in is disposable (decision-9): deleting it costs
 * the next reader of each picture one encode and costs the site nothing else,
 * which is what this handler is for. A width or a format the site does not
 * offer is a 404 and encodes nothing, so the URL space cannot be used to make
 * the server work.
 *
 * The cache lifetime is the uploads' own, and it is honest for the same
 * reason: a derived URL names one width of one file, and the file it was
 * derived from is never overwritten.
 */
async function imageVariant(c: Context<GeekityEnv>): Promise<Response> {
  const relative = requestPath(c).slice(VARIANT_ASSET_PREFIX.length);
  const asset = await findImageVariant(c.var.config, decodeVariantPath(relative));
  if (asset === undefined) return notFound(c);

  const options = { maxAge: UPLOAD_ASSET_MAX_AGE };
  return matchesEtag(c.req.header('if-none-match'), asset.etag)
    ? assetNotModified(asset, options)
    : assetResponse(asset, options);
}

/** A request path as a path on disk: percent-encoding off, segment by segment. */
function decodeVariantPath(relative: string): string {
  try {
    return relative.split('/').map(decodeURIComponent).join('/');
  } catch {
    return relative;
  }
}

/**
 * A file from `content/uploads/`, at the URL Eleventy's passthrough copy puts
 * it at.
 *
 * Uploads are not documents — the index never sees them — so they are served
 * as files, with the same validators and the same traversal check the theme's
 * assets get. The cache lifetime is longer than a theme asset's because an
 * upload's URL names one set of bytes: the upload endpoint never overwrites,
 * it suffixes.
 */
function upload(c: Context<GeekityEnv>): Response {
  const relative = requestPath(c).slice(UPLOAD_ASSET_PREFIX.length);
  const asset = findUpload(relative, c.var.config.contentDir);
  if (asset === undefined) return notFound(c);

  const options = { maxAge: UPLOAD_ASSET_MAX_AGE };
  return matchesEtag(c.req.header('if-none-match'), asset.etag)
    ? assetNotModified(asset, options)
    : assetResponse(asset, options);
}

/** The URL of a page of the home listing, by zero-based index. */
export function homeHref(index: number): string {
  return index === 0 ? '/' : `/${PAGE_SEGMENT}/${String(index + 1)}/`;
}

/**
 * What the theme is told about a taxonomy archive: the term under the name of
 * its taxonomy, and the layout that taxonomy uses.
 */
function taxonomyContext(term: TaxonomyTerm): {
  tag?: string;
  category?: string;
  template: string;
} {
  return term.taxonomy === 'tag'
    ? { tag: term.term, template: TEMPLATES.tag }
    : { category: term.term, template: TEMPLATES.category };
}

/**
 * The URL of a feed: the whole site's, or one taxonomy archive's.
 *
 * WordPress's layout, so a subscriber of a migrated site keeps polling the URL
 * they already hold: `/feed/` is RSS 2.0, `/feed/atom/` and `/feed/json/` are
 * its siblings, and an archive's feeds hang off the archive.
 */
export function feedHref(
  term: TaxonomyTerm | undefined,
  format: FeedFormat,
  bases: TaxonomyBases,
): string {
  return feedPathUnder(listingHref(term, 0, bases), format);
}

/**
 * Where the site's comments feed lives, and where one post's does.
 *
 * WordPress's URLs, so a site migrated from it keeps both: the whole site's
 * comments at `/comments/feed/`, and a post's under its own permalink. There
 * is one format, RSS 2.0, because that is what a comments feed is read in.
 */
export function commentsFeedHref(document: Document | undefined): string {
  return commentsFeedPath(document === undefined ? undefined : encodePath(document.permalink));
}

/** The theme's 404 page. */
export function notFound(c: Context<GeekityEnv>): Response {
  return c.html(c.var.renderer.renderNotFound(requestPath(c)), 404);
}

/**
 * The requested path, percent-decoded, because permalinks are stored decoded.
 * A path whose escapes are malformed is used as it arrived, which resolves to
 * nothing and so 404s.
 */
export function requestPath(c: Context<GeekityEnv>): string {
  const { pathname } = new URL(c.req.url);
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** A decoded path back into one safe to put in a `Location` header. */
function encodePath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
