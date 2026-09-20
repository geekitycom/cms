import type { Context, Hono } from 'hono';

import { listUsers } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
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
  THEME_ASSET_PREFIX,
  UPLOAD_ASSET_MAX_AGE,
  UPLOAD_ASSET_PREFIX,
} from './assets.ts';
import { COMMENT_NOTICE_PARAM, COMMENT_REPLY_PARAM } from '../comments/form.ts';
import { commentNoticeFor, commentReplyTarget, mountComments } from '../comments/routes.ts';
import { signedInCommenter } from '../comments/viewer.ts';
import { CONTACT_NOTICE_PARAM, contactNoticeFor } from '../contact/form.ts';
import { mountContact } from '../contact/routes.ts';
import { mountWebmentions, WEBMENTION_PATH } from '../webmention/routes.ts';
import { mountNotificationLinks } from '../notifications/routes.ts';
import {
  authorFeedHref,
  authorHref,
  authorNames,
  parseAuthorPath,
  profileContext,
} from './authors.ts';
import type { AuthorContext } from './authors.ts';
import { feedComments, spokenIn } from './conversation.ts';
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
  MEDIA_TYPES,
  notAcceptableResponse,
  representationHref,
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
import {
  searchHref,
  searchJson,
  searchPageIndex,
  searchQuery,
  SEARCH_PAGE_PARAM,
  SEARCH_PATH,
  SEARCH_QUERY_PARAM,
} from './search.ts';
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

  // And where a contact form's message is sent (TASK-56): the same prefix
  // again, so the page a form is on can be permalinked anywhere.
  mountContact(app);

  // And where a webmention is sent (TASK-51), for the same reason and under
  // the same prefix.
  mountWebmentions(app);

  // And where the one-click links in a notification land (TASK-55): the same
  // prefix again, and no session behind either of them.
  mountNotificationLinks(app);

  app.get('/', (c) => {
    // The site's latest posts, or the page the Reading setting names — the
    // whole of WordPress's "Your homepage displays", decided per request off
    // `site.json` so a save on the settings screen moves the front page on the
    // very next one.
    const home = frontPages(c).home;
    if (home === undefined) return listing(c, { term: undefined, pageNumber: 0 });
    return negotiateDocument(c, home, selectFromAccept(c, DOCUMENT_REPRESENTATIONS), '/');
  });

  app.get(`/${PAGE_SEGMENT}/:page{[0-9]+}/`, (c) => {
    const requested = Number(c.req.param('page'));
    // Page one is the home page; it does not get a second URL.
    if (requested <= 1) return c.redirect('/', 301);

    const pages = frontPages(c);
    // With a posts page, the listing's pages live under it and these are the
    // URLs they used to have; with a static homepage and no posts page, the
    // listing has no page of its own and neither have its pages.
    if (pages.posts !== undefined) {
      return c.redirect(listingPageHref(pages.posts.permalink, requested - 1), 301);
    }
    if (pages.home !== undefined) return notFound(c);

    return listing(c, { term: undefined, pageNumber: requested - 1 });
  });

  // The site's own feeds are routes rather than representations, so a reader's
  // careless `Accept` header cannot land it on the HTML (doc-3), and so a
  // document permalinked at `/feed/` cannot take the subscribers' URL. Their
  // paths are fixed — only the taxonomy feeds hang off a configurable base —
  // so the route table can hold them.
  for (const format of FEED_FORMATS) {
    app.get(feedPathUnder('/', format), (c) => feed(c, format, {}));
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

  // The site's search (TASK-22): a route at a fixed path for the reason the
  // feeds are, so the form in every theme's footer submits somewhere no
  // permalink can take. It negotiates HTML and JSON like a listing, and
  // `/search/index.json` is the same escape hatch a listing has. The path
  // without its slash is where a hand-typed URL lands, and keeps its query on
  // the way to the real one.
  app.get(SEARCH_PATH, (c) => search(c, selectFromAccept(c, LISTING_REPRESENTATIONS)));
  app.get(representationHref(SEARCH_PATH, 'json'), (c) => search(c, 'json'));
  app.get(SEARCH_PATH.slice(0, -1), (c) =>
    c.redirect(`${SEARCH_PATH}${new URL(c.req.url).search}`, 301),
  );

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
  const authors = authorsOf(c);
  const pages = frontPages(c);

  // The posts page carries the listing at its own URL, so it is answered
  // before the document lookup that would otherwise render it as the page it
  // also is. Its pagination hangs off it: `{permalink}page/2/`.
  if (pages.posts !== undefined) {
    const request = postsPageRequest(pages.posts, pathname);
    if (request !== undefined) {
      // `{permalink}page/1/` is the listing's own URL spelled twice, and
      // collapses onto it exactly as `/page/1/` collapses onto `/`.
      if (request.pageNumber === 0 && pathname !== pages.posts.permalink) {
        return c.redirect(encodePath(pages.posts.permalink), 301);
      }
      return listing(c, request);
    }
  }

  const feedRequest = parseFeedPath(store, pathname, bases, authors);
  if (feedRequest !== undefined) {
    const { target, format } = feedRequest;
    if (!feedRequest.canonical) return c.redirect(feedTargetHref(target, format, bases), 301);
    return target.kind === 'listing'
      ? feed(c, format, target.subject)
      : comments(c, target.document);
  }

  const archive = taxonomyArchive(c, pathname, bases, authors);
  if (archive !== undefined) return archive;

  // And one person's, which is the same kind of thing at a path the site
  // reserves: `author` is never a document's first segment, so this can be
  // answered before the permalink lookup without anything being shadowed.
  const byAuthor = authorArchive(c, pathname, bases, authors);
  if (byAuthor !== undefined) return byAuthor;

  const document = publicDocumentAt(store, pathname);
  if (document !== undefined) {
    // The front page has one URL. The page it is made of keeps its own
    // permalink in the file, so that a homepage put back to being an ordinary
    // page goes back to answering there, and that URL points at `/` while it
    // is the front page.
    if (document.path === pages.home?.path) return c.redirect('/', 301);

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
      // `/index.md` and `/index.json` are the front page's own
      // representations on a site whose `/` is a page: the document is at `/`
      // however it is asked for.
      const found = candidate === '/' ? pages.home : publicDocumentAt(store, candidate);
      if (found !== undefined) {
        return negotiateDocument(
          c,
          found,
          extension.representation,
          candidate === '/' ? '/' : undefined,
        );
      }
    }

    // `/index.json`, `/page/2/index.json`, `/tag/x/index.json`,
    // `/category/x/index.json`: the same escape hatch over a listing, for the
    // representations a listing has.
    if (LISTING_REPRESENTATIONS.includes(extension.representation)) {
      for (const candidate of extension.paths) {
        const request = listingRequestAt(pages, candidate, bases, authors);
        if (request !== undefined) return listing(c, request, extension.representation);
      }
    }
  }

  const canonical = canonicalPath(c, pathname, bases, authors);
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
  authors: AuthorLookup,
): Response | undefined {
  if (!pathname.endsWith('/')) return undefined;

  const request = parseListingPath(pathname, bases, authors);
  if (request?.term === undefined) return undefined;

  // An archive that answers is served; only once nothing carries the term is
  // the record of renames consulted, so a term that comes back into use — or
  // one that was merged into and then recreated — beats what it used to be
  // called. One hop: the list is stored with its chains already collapsed.
  if (countListing(c.var.store, request) === 0) {
    const moved = movedTerm(c, request.term);
    if (moved !== undefined) return c.redirect(termHref(moved, request.pageNumber, bases), 301);
  }

  const canonical = termHref(request.term, request.pageNumber, bases);
  if (canonical !== encodePath(pathname)) {
    return countListing(c.var.store, request) === 0 ? notFound(c) : c.redirect(canonical, 301);
  }

  return listing(c, request);
}

/**
 * One person's archive, the redirect that puts it at its canonical URL, or
 * `undefined` when the path is not one.
 *
 * Unlike a taxonomy archive it does not depend on there being anything on it.
 * A tag exists only while something carries it; a person exists because they
 * have an account, and after decision-14 this URL is the id their followers
 * file them under — so an archive that 404'd until its owner published would
 * be an account that came into being with a post. What decides the 404 is
 * whether the username is somebody's, which {@link parseListingPath} has
 * already asked.
 *
 * `/author/{username}/page/1/` collapses onto the archive root the way
 * `/page/1/` collapses onto the home page.
 */
function authorArchive(
  c: Context<GeekityEnv>,
  pathname: string,
  bases: TaxonomyBases,
  authors: AuthorLookup,
): Response | undefined {
  if (!pathname.endsWith('/')) return undefined;

  const request = parseListingPath(pathname, bases, authors);
  if (request?.author === undefined) return undefined;

  const canonical = authorHref(request.author.user.username, request.pageNumber);
  if (canonical !== encodePath(pathname)) return c.redirect(canonical, 301);

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
  | { kind: 'listing'; subject: ListingSubject }
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
  authors: AuthorLookup,
): FeedRequest | undefined {
  const split = splitFeedPath(pathname);
  if (split === undefined) return undefined;
  const { format, canonical } = split;

  if (split.root === COMMENTS_ROOT) {
    return format === 'rss'
      ? { target: { kind: 'comments', document: undefined }, format, canonical }
      : undefined;
  }

  const root = parseListingPath(split.root, bases, authors);
  // Only a listing root has a feed, and only its first page: a feed is not
  // paginated, so `/{base}/x/page/2/feed/` names nothing.
  if (root !== undefined) {
    return root.pageNumber === 0
      ? { target: { kind: 'listing', subject: root }, format, canonical }
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
    ? listingFeedHref(target.subject, format, bases)
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
    // And the thank-you after a contact form was sent, which travels the same
    // way for the same reason (TASK-56).
    ...contactNotice(c),
  };
}

/**
 * The thank-you a contact form's redirect landed on, if the query names one.
 *
 * On the context rather than in the form's own state because the redirect is
 * what makes a refresh harmless: the page is drawn fresh, and the query is the
 * only thing that says a message went.
 */
function contactNotice(c: Context<GeekityEnv>): Record<string, unknown> {
  const notice = contactNoticeFor(c.req.query(CONTACT_NOTICE_PARAM));
  return notice === undefined ? {} : { contactNotice: notice };
}

/** The representation an `Accept` header asked for, or `undefined` for a 406. */
function selectFromAccept(
  c: Context<GeekityEnv>,
  available: readonly Representation[],
): Representation | undefined {
  return selectRepresentation(c.req.header('accept'), available);
}

/**
 * One document in one representation, or the 406 an impossible `Accept` earns.
 *
 * `href` is where it is being served, which is its own permalink everywhere
 * but the front page: a page serving as the homepage is read at `/`, and the
 * canonical URL, the alternates and the theme's own links have to say so.
 */
function negotiateDocument(
  c: Context<GeekityEnv>,
  document: Document,
  representation: Representation | undefined,
  href: string = document.permalink,
): Response {
  if (representation === undefined) {
    return notAcceptableResponse(encodePath(href), DOCUMENT_REPRESENTATIONS);
  }

  // Who the request's session says is reading, when it says anybody
  // (TASK-103). Only the HTML has a form on it, so only the HTML asks; the
  // Markdown and JSON of a post are the same bytes for everybody.
  const viewer = representation === 'html' ? signedInCommenter(c) : undefined;

  const body =
    representation === 'markdown'
      ? serializeDocument(document)
      : representation === 'json'
        ? documentJson(document, { baseUrl: c.var.config.baseUrl })
        : // The thank-you after a comment was posted, which the redirect
          // carried back as a query. It is the only thing about a document's
          // HTML that the URL rather than the file decides.
          // A document served at `/` is the site's front page, and the front
          // page is the one place a theme may lay a page out differently.
          href === '/'
          ? c.var.renderer.renderFrontPage(document, commentNotice(c, document), viewer)
          : c.var.renderer.renderDocument(document, commentNotice(c, document), viewer);

  // The theme can change without the document changing, and only the document
  // is hashed. While the watcher is on — a development server, where a template
  // edit lands mid-process — the HTML gets no validator rather than a stale one.
  const validated = representation !== 'html' || !c.var.config.watch;

  return representationResponse({
    body,
    representation,
    href: encodePath(href),
    available: DOCUMENT_REPRESENTATIONS,
    // Where a webmention about this page is sent. It is a header rather than
    // only a `<link>` because a sender is allowed to find the endpoint without
    // parsing the page, and because the JSON and Markdown representations of a
    // post have no head to put one in (TASK-51).
    links: webmentionLinks(c),
    // A page drawn for one named reader is that reader's page rather than the
    // post, so nothing shared may hold it and it carries no validator. A page
    // drawn for everybody is exactly what it has always been.
    ...(viewer === undefined ? {} : { private: true }),
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
  authors: AuthorLookup,
): string | undefined {
  if (pathname === '' || pathname.endsWith('/')) return undefined;

  const target = canonicalTarget(c, `${pathname}/`, bases, authors);
  if (target === undefined) return undefined;

  return `${target}${new URL(c.req.url).search}`;
}

/** Where a path with a trailing slash canonically lives, if anywhere. */
function canonicalTarget(
  c: Context<GeekityEnv>,
  pathname: string,
  bases: TaxonomyBases,
  authors: AuthorLookup,
): string | undefined {
  const { store, renderer } = c.var;

  // A feed first: `/feed`, `/feed/atom`, `/{base}/x/feed`, `/comments/feed`
  // and a post's `{permalink}feed` all lead somewhere real, and `/feed/rss`
  // leads to `/feed/` in the same one hop rather than to a second redirect.
  const feedRequest = parseFeedPath(store, pathname, bases, authors);
  if (feedRequest !== undefined) {
    const { target } = feedRequest;
    if (
      target.kind === 'listing' &&
      target.subject.term !== undefined &&
      countListing(store, target.subject) === 0
    ) {
      return undefined;
    }
    return feedTargetHref(target, feedRequest.format, bases);
  }

  const pages = frontPages(c);

  const document = store.getByPermalink(pathname);
  if (document !== undefined) {
    if (!isPublicDocument(document)) return undefined;
    // The homepage's own URL leads to `/` rather than to the redirect that
    // leads to `/`: one hop, the way `/page/1` reaches `/` in one.
    return document.path === pages.home?.path ? '/' : encodePath(pathname);
  }

  const listing = listingRequestAt(pages, pathname, bases, authors);
  if (listing === undefined) return undefined;

  // The home listing and an author archive both exist with nothing on them; a
  // taxonomy archive does not.
  const total = countListing(store, listing);
  if (listing.term !== undefined && total === 0) return undefined;

  const totalPages = Math.max(1, Math.ceil(total / renderer.pageSize()));
  if (listing.pageNumber >= totalPages) return undefined;

  return listingHref(listing, listing.pageNumber, bases, listing.document?.permalink ?? '/');
}

/**
 * What a listing is over: the whole site, one taxonomy term, or one person.
 *
 * Three kinds of archive share one pager, one negotiator and one validator,
 * and this is the value that says which of them a request is about. Both keys
 * absent is the home listing — the site's own posts, wherever the Reading
 * setting has put them.
 */
interface ListingSubject {
  /** The taxonomy archive this is, when it is one. */
  term?: TaxonomyTerm | undefined;
  /** The person whose archive this is, when it is one. */
  author?: AuthorListing | undefined;
}

/**
 * One user's archive: the person, and every `author` string the index should
 * match for them.
 *
 * The names are resolved once, where the users file is read, rather than
 * inside each query: `web/authors.ts` decides which stored spellings read as
 * this person (a username, and the display name a file written before
 * decision-14 carries), and the index only ever matches strings.
 */
interface AuthorListing {
  /** Whose archive it is. */
  user: User;
  /** Every `author` value that reads as them. */
  names: readonly string[];
}

/**
 * The site's users, as the lookup the listing parser wants.
 *
 * Lazy, and read once per request rather than once per call: `users.json` is a
 * few hundred bytes, but a request that is nothing to do with an author should
 * not read it at all, and one that is should not read it four times on its way
 * through the parser, the canonicaliser and the renderer.
 */
type AuthorLookup = (username: string) => AuthorListing | undefined;

/** {@link AuthorLookup} over one request's site. */
function authorsOf(c: Context<GeekityEnv>): AuthorLookup {
  let users: readonly User[] | undefined;

  return (username) => {
    users ??= listUsers(c.var.config.dataDir);
    const user = users.find((candidate) => candidate.username === username);
    return user === undefined ? undefined : { user, names: authorNames(users, user) };
  };
}

/** Which page of which listing a request is for. */
interface ListingRequest extends ListingSubject {
  /** Zero-based index of the page. */
  pageNumber: number;
  /**
   * The posts page this listing is being served under, when the site has one.
   * It decides where the listing's pages live and puts the page's own title
   * and body above them.
   */
  document?: Document | undefined;
}

/** The pages the Reading setting names, as documents the site would serve. */
interface FrontPages {
  /** The page served at `/`, or `undefined` for the site's latest posts. */
  home: Document | undefined;
  /** The page whose permalink carries the listing, or `undefined` for none. */
  posts: Document | undefined;
}

/**
 * WordPress's Reading choice, resolved for this request.
 *
 * The setting holds slugs, and a slug is only a front page while it names a
 * page the public site would serve: one drafted, trashed or deleted since it
 * was picked resolves to nothing, and a site whose homepage resolves to
 * nothing is a site showing its latest posts again. That is the whole of the
 * fallback — there is no state to repair and nothing to write — and it is why
 * the pick is kept rather than cleared: publishing the page again puts the
 * front page back.
 */
function frontPages(c: Context<GeekityEnv>): FrontPages {
  const { homepage, postsPage } = c.var.renderer.frontPageSlugs();
  const home = publicPage(c, homepage);

  return {
    home,
    // Without a homepage there is no posts page: the listing is already at
    // `/`, and a second URL for it is exactly what this pair exists to avoid.
    posts: home === undefined ? undefined : publicPage(c, postsPage),
  };
}

/**
 * A path as the page of a listing it names, wherever the listing lives, or
 * `undefined` when it names none.
 *
 * The posts page first, because its permalink is the listing's root on a site
 * that has one; then the ordinary `/`, `/page/N/` and the taxonomy archives.
 * A site whose homepage is a page and which named no posts page has no home
 * listing at all, so nothing under the root is one either.
 */
function listingRequestAt(
  pages: FrontPages,
  pathname: string,
  bases: TaxonomyBases,
  authors: AuthorLookup,
): ListingRequest | undefined {
  const onPostsPage =
    pages.posts === undefined ? undefined : postsPageRequest(pages.posts, pathname);
  if (onPostsPage !== undefined) return onPostsPage;

  const request = parseListingPath(pathname, bases, authors);
  if (request === undefined) return undefined;
  // Only the home listing can be homeless. A tag archive and a person's
  // archive have URLs of their own, whatever the Reading setting says `/` is.
  if (request.term === undefined && request.author === undefined) {
    if (listingRoot(pages) === undefined) return undefined;
  }
  return request;
}

/**
 * Where the post listing lives, or `undefined` when it has no page at all.
 *
 * A site showing its latest posts has it at `/`; a site with a posts page has
 * it there; a site whose homepage is a page and which named no posts page has
 * nowhere for it, which is WordPress's own answer and the reason its Reading
 * screen offers the second pick. The feeds are unaffected either way.
 */
function listingRoot(pages: FrontPages): string | undefined {
  if (pages.posts !== undefined) return pages.posts.permalink;
  return pages.home === undefined ? '/' : undefined;
}

/** The published page one slug names, or `undefined`. */
function publicPage(c: Context<GeekityEnv>, slug: string): Document | undefined {
  if (slug === '') return undefined;
  const found = c.var.store.getBySlug(slug);
  if (found?.type !== 'page') return undefined;
  return isPublicDocument(found, c.var.store.now()) ? found : undefined;
}

/**
 * `{permalink}` or `{permalink}page/N/` as a page of the listing the posts
 * page carries, or `undefined` when the path is neither.
 *
 * `page/1/` is not one: the first page of a listing lives at the listing's own
 * URL, exactly as `/page/1/` collapses onto `/`, and the canonicalisation that
 * says so is the ordinary one.
 */
function postsPageRequest(document: Document, pathname: string): ListingRequest | undefined {
  const { permalink } = document;
  if (pathname === permalink) return { term: undefined, pageNumber: 0, document };
  if (!pathname.startsWith(permalink)) return undefined;

  const segments = pathname
    .slice(permalink.length)
    .split('/')
    .filter((segment) => segment !== '');
  if (segments.length !== 2 || segments[0] !== PAGE_SEGMENT || !pathname.endsWith('/')) {
    return undefined;
  }

  const page = pageIndex(segments[1]);
  return page === undefined ? undefined : { term: undefined, pageNumber: page, document };
}

/**
 * `/`, `/page/N/`, `/author/{username}/` and `/author/{username}/page/N/`, and
 * either taxonomy's `/{base}/x/` and `/{base}/x/page/N/`, as a listing to
 * check.
 */
function parseListingPath(
  pathname: string,
  bases: TaxonomyBases,
  authors: AuthorLookup,
): ListingRequest | undefined {
  const segments = pathname.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) return { term: undefined, pageNumber: 0 };

  if (segments[0] === PAGE_SEGMENT && segments.length === 2) {
    const page = pageIndex(segments[1]);
    return page === undefined ? undefined : { term: undefined, pageNumber: page };
  }

  // One person's archive, at the path decision-14 reserves. A username nobody
  // has is not a listing at all, which is what turns it into one 404 rather
  // than an empty archive.
  const byAuthor = parseAuthorPath(pathname);
  if (byAuthor !== undefined) {
    const found = authors(byAuthor.username);
    return found === undefined ? undefined : { author: found, pageNumber: byAuthor.pageNumber };
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
function countListing(store: ContentStore, subject: ListingSubject): number {
  const { term, author } = subject;
  if (author !== undefined) return store.countByAuthor(author.names);
  if (term === undefined) return store.counts().posts;
  return term.taxonomy === 'tag' ? store.countByTag(term.term) : store.countByCategory(term.term);
}

/** One page of a listing's documents, newest first. */
function listListing(
  store: ContentStore,
  subject: ListingSubject,
  paging: ListOptions,
): Document[] {
  const { term, author } = subject;
  if (author !== undefined) return store.listByAuthor(author.names, paging);
  if (term === undefined) return store.listPosts(paging);
  return term.taxonomy === 'tag'
    ? store.listByTag(term.term, paging)
    : store.listByCategory(term.term, paging);
}

/**
 * The URL of a page of a listing: the home archive's, or a taxonomy's.
 *
 * `root` is where the home listing lives — `/`, or the posts page's permalink
 * on a site that has one — so every link the listing draws, every canonical
 * redirect and the sitemap all spell its pages the same way.
 */
function listingHref(
  subject: ListingSubject,
  index: number,
  bases: TaxonomyBases,
  root = '/',
): string {
  const { term, author } = subject;
  if (author !== undefined) return authorHref(author.user.username, index);
  return term === undefined ? listingPageHref(root, index) : termHref(term, index, bases);
}

/**
 * The URL of one format of one listing's feed, whichever kind of listing it is.
 *
 * The site's and a taxonomy's hang off the listing root; a person's hangs off
 * their archive, which decision-14 keeps at WordPress's `/author/{username}/`
 * rather than under the listing machinery, because that root is also an actor
 * id.
 */
function listingFeedHref(
  subject: ListingSubject,
  format: FeedFormat,
  bases: TaxonomyBases,
): string {
  return subject.author === undefined
    ? feedHref(subject.term, format, bases)
    : authorFeedHref(subject.author.user.username, format);
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
  const { term, author } = request;
  const size = renderer.pageSize();
  const bases = renderer.taxonomyBases();
  // Where this listing's pages live: the posts page's permalink when the site
  // has one, and the site root otherwise.
  const root = request.document?.permalink ?? '/';

  // WordPress served every feed as a query on the listing before it served one
  // at a path, and the links are still out there. `/?feed=rss2` and
  // `/{base}/x/?feed=atom` land on the feed the listing now has.
  const asked = queryFeedFormat(c);
  if (asked !== undefined) return c.redirect(listingFeedHref(request, asked, bases), 301);

  // A taxonomy archive only exists while something carries the term; the home
  // listing and a person's archive exist even with nothing on them.
  const total = countListing(store, request);
  if (term !== undefined && total === 0) return notFound(c);

  const href = listingHref(request, request.pageNumber, bases, root);
  const pagination = paginate({
    total,
    size,
    pageNumber: request.pageNumber,
    hrefForPage: (index) => listingHref(request, index, bases, root),
  });

  if (request.pageNumber >= pagination.totalPages) return notFound(c);
  if (representation === undefined) return notAcceptableResponse(href, LISTING_REPRESENTATIONS);

  const paging = { limit: size, offset: offsetForPage(request.pageNumber, size) };
  const documents = listListing(store, request, paging);

  const full = wantsFullDocuments(c);
  const body =
    representation === 'json'
      ? documents.map((document) =>
          documentJson(document, { baseUrl: c.var.config.baseUrl, body: full }),
        )
      : renderer.renderListing({
          // An author archive is headed by the person, a taxonomy archive by
          // the term, the posts page by its own title the way any page is, and
          // the home listing by the site's.
          title:
            term?.term ??
            author?.user.profile?.displayName ??
            author?.user.username ??
            request.document?.title ??
            renderer.site().title,
          url: href,
          documents,
          pagination,
          // And its words go above the posts, which is what a posts page is
          // for: a theme prints `{{ content | safe }}` over the list.
          ...(request.document === undefined ? {} : { document: request.document }),
          ...(term === undefined ? {} : taxonomyContext(term)),
          ...(author === undefined ? {} : authorArchiveContext(author)),
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
 * One page of search results, in whichever representation the request settled
 * on.
 *
 * What it finds is what the listings would show: the index holds the search to
 * published, untrashed, already-due documents, so a draft cannot be found by
 * its words any more than it can be found by its URL. A search with no query
 * is the page with the form on it and nothing found, rather than an error,
 * because that is where a link to the search from a theme lands. A page past
 * the last one 404s, as it does on a listing.
 */
function search(c: Context<GeekityEnv>, representation: Representation | undefined): Response {
  const { store, renderer, config } = c.var;
  const query = searchQuery(c.req.query(SEARCH_QUERY_PARAM));
  const pageNumber = searchPageIndex(c.req.query(SEARCH_PAGE_PARAM));
  if (pageNumber === undefined) return notFound(c);

  const size = renderer.pageSize();
  const pagination = paginate({
    total: store.countSearch(query),
    size,
    pageNumber,
    hrefForPage: (index) => searchHref(query, index),
  });
  if (pageNumber >= pagination.totalPages) return notFound(c);

  const href = searchHref(query, pageNumber);
  if (representation === undefined) return notAcceptableResponse(href, LISTING_REPRESENTATIONS);

  const hits = store.search(query, { limit: size, offset: offsetForPage(pageNumber, size) });
  const documents = hits.map((hit) => hit.document);
  const full = wantsFullDocuments(c);
  const body =
    representation === 'json'
      ? searchJson({ query, hits, pagination, baseUrl: config.baseUrl, body: full })
      : renderer.renderSearch({ query, url: href, hits, pagination });

  const validated = representation !== 'html' || !config.watch;

  return representationResponse({
    body,
    representation,
    href,
    // The alternates are spelled here rather than by the negotiator, because
    // they carry the query and a listing's never have one to carry.
    available: [representation],
    links: LISTING_REPRESENTATIONS.filter((other) => other !== representation).map(
      (other) =>
        `<${searchHref(query, pageNumber, other)}>; rel="alternate"; type="${MEDIA_TYPES[other]}"`,
    ),
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
function feed(c: Context<GeekityEnv>, format: FeedFormat, subject: ListingSubject): Response {
  const { store, renderer, config } = c.var;
  const site = renderer.site();
  const bases = renderer.taxonomyBases();
  const { term, author } = subject;

  if (term !== undefined && countListing(store, subject) === 0) {
    // A subscriber to a renamed archive's feed follows it to the new one
    // rather than being dropped, exactly as a reader of the archive does.
    const moved = movedTerm(c, term);
    if (moved === undefined) return notFound(c);
    return c.redirect(feedHref(moved, format, bases), 301);
  }

  const documents = listListing(store, subject, { limit: feedSize(site) });
  const href = listingHref(subject, 0, bases);
  // What the feed calls itself: the site, and then the term or the person it
  // is about, so a reader subscribed to several of a site's feeds can tell
  // them apart in a list.
  const about = term?.term ?? author?.user.profile?.displayName ?? author?.user.username;

  const source: FeedSource = {
    site,
    documents,
    title: about === undefined ? site.title : `${site.title}: ${about}`,
    href,
    feedHref: listingFeedHref(subject, format, bases),
    baseUrl: config.baseUrl,
    // Only RSS carries the comment pointers; the other two formats have no
    // vocabulary for them, and counting for a feed that cannot say the number
    // would be a query per item for nothing.
    ...(format === 'rss' ? { commentCounts: c.var.conversation.counts(documents) } : {}),
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
  const { conversation, renderer, config } = c.var;
  const site = renderer.site();
  const limit = feedSize(site);

  // The same reading the page is drawn from, which is the point: a subscriber
  // to a post's comments and a reader who scrolls to the bottom of it are
  // looking at one conversation. A post's own feed hands the builder entries
  // with no post attached, and so its items name no post: there, every item
  // answers the same one.
  const found: readonly FeedComment[] = feedComments(
    document === undefined ? conversation.latest(limit) : spokenIn(conversation.thread(document)),
    { baseUrl: config.baseUrl, limit },
  );

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
  const pages = frontPages(c);
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

  // The listing's pages, wherever it lives: under `/`, under the posts page,
  // or nowhere at all on a site whose homepage is a page and which named no
  // posts page. Its first page is that root, which is why `/` and the posts
  // page's own URL are listed here rather than with the documents.
  const root = listingRoot(pages);
  if (root !== undefined) listingPages(posts, (index) => listingPageHref(root, index));

  // And `/` itself when it is a page rather than the listing: the front page
  // is published at one URL, and it is this one.
  if (pages.home !== undefined) urls.push({ loc: '/', lastmod: lastModifiedOf(pages.home) });

  const documents = store
    .listAll({ type: 'page', draft: false, trashed: false, scheduled: false })
    .filter((document) => isPublicDocument(document, now));

  for (const document of [...posts, ...documents]) {
    // The homepage answers at `/` and redirects from its own permalink, and
    // the posts page is the listing's first page, which is already listed:
    // neither is advertised twice.
    if (document.path === pages.home?.path || document.path === pages.posts?.path) continue;
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
  const asset = findThemeAsset(relative, c.var.renderer.themeDirs());
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
  return listingPageHref('/', index);
}

/**
 * The URL of a page of the listing that hangs off `root`, by zero-based index.
 *
 * The first page is the root itself: `/` or the posts page's own permalink,
 * which is what makes a posts page one URL rather than two.
 */
export function listingPageHref(root: string, index: number): string {
  return index === 0 ? root : `${root}${PAGE_SEGMENT}/${String(index + 1)}/`;
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
 * What the theme is told about an author archive: the person's profile under
 * `author`, the same shape a post's byline gets, and the layout an archive of
 * theirs uses.
 *
 * One shape for both places is the point. A theme that knows how to print a
 * byline already knows how to print the heading of the archive that byline
 * links to, and neither has to ask whether the site has users.
 */
function authorArchiveContext(author: AuthorListing): { author: AuthorContext; template: string } {
  return { author: profileContext(author.user), template: TEMPLATES.author };
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
  return feedPathUnder(listingHref({ term }, 0, bases), format);
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
