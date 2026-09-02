import type { Context, Hono } from 'hono';

import type { Document } from '../content/document.ts';
import { serializeDocument } from '../content/writer.ts';
import type { GeekityEnv } from '../env.ts';
import {
  findThemeAsset,
  matchesEtag,
  themeAssetNotModified,
  themeAssetResponse,
  themeSearchPath,
  THEME_ASSET_PREFIX,
} from './assets.ts';
import { isPublicDocument, publicDocumentAt } from './documents.ts';
import { feedResponse, feedSize, FEED_FILES } from './feeds.ts';
import type { FeedFormat, FeedSource } from './feeds.ts';
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

/** Where a paginated listing's later pages live, under any listing root. */
export const PAGE_SEGMENT = 'page';

/** Root of the tag archives. */
export const TAG_SEGMENT = 'tags';

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

  app.get('/', (c) => listing(c, { tag: undefined, pageNumber: 0 }));

  app.get(`/${PAGE_SEGMENT}/:page{[0-9]+}/`, (c) => {
    const requested = Number(c.req.param('page'));
    // Page one is the home page; it does not get a second URL.
    if (requested <= 1) return c.redirect('/', 301);
    return listing(c, { tag: undefined, pageNumber: requested - 1 });
  });

  // Feeds are routes rather than representations, so a reader's careless
  // `Accept` header cannot land it on the HTML (doc-3). They are registered
  // before the tag archive so the shape of the URL, not the negotiator,
  // decides what comes back.
  app.get(`/${FEED_FILES.atom}`, (c) => feed(c, 'atom', undefined));
  app.get(`/${FEED_FILES.json}`, (c) => feed(c, 'json', undefined));

  app.get(`/${TAG_SEGMENT}/:tag/${FEED_FILES.atom}`, (c) => feed(c, 'atom', c.req.param('tag')));
  app.get(`/${TAG_SEGMENT}/:tag/${FEED_FILES.json}`, (c) => feed(c, 'json', c.req.param('tag')));

  app.get(`/${TAG_SEGMENT}/:tag/`, (c) => listing(c, { tag: c.req.param('tag'), pageNumber: 0 }));

  app.get(`/${TAG_SEGMENT}/:tag/${PAGE_SEGMENT}/:page{[0-9]+}/`, (c) => {
    const tag = c.req.param('tag');
    const requested = Number(c.req.param('page'));
    if (requested <= 1) return c.redirect(tagHref(tag, 0), 301);
    return listing(c, { tag, pageNumber: requested - 1 });
  });

  app.notFound(resolveDocument);
}

/**
 * The last stop for a request: the document at this URL, the same document in
 * the representation a `.md` or `.json` suffix asked for, the canonical URL it
 * should have asked for, or the theme's 404.
 *
 * The suffix is stripped and the *same* {@link publicDocumentAt} lookup runs
 * again, so no representation can resolve to a document the others cannot see.
 */
function resolveDocument(c: Context<GeekityEnv>): Response {
  const { store } = c.var;
  const pathname = requestPath(c);

  const document = publicDocumentAt(store, pathname);
  if (document !== undefined) {
    return negotiateDocument(c, document, selectFromAccept(c, DOCUMENT_REPRESENTATIONS));
  }

  const extension = splitRepresentationExtension(pathname);
  if (extension !== undefined) {
    for (const candidate of extension.paths) {
      const found = publicDocumentAt(store, candidate);
      if (found !== undefined) return negotiateDocument(c, found, extension.representation);
    }

    // `/index.json`, `/page/2/index.json`, `/tags/x/index.json`: the same
    // escape hatch over a listing, for the representations a listing has.
    if (LISTING_REPRESENTATIONS.includes(extension.representation)) {
      for (const candidate of extension.paths) {
        const request = parseListingPath(candidate);
        if (request !== undefined) return listing(c, request, extension.representation);
      }
    }
  }

  const canonical = canonicalPath(c, pathname);
  if (canonical !== undefined) return c.redirect(canonical, 301);

  return notFound(c);
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
        : c.var.renderer.renderDocument(document);

  // The theme can change without the document changing, and only the document
  // is hashed. While the watcher is on — a development server, where a template
  // edit lands mid-process — the HTML gets no validator rather than a stale one.
  const validated = representation !== 'html' || !c.var.config.watch;

  return representationResponse({
    body,
    representation,
    href: encodePath(document.permalink),
    available: DOCUMENT_REPRESENTATIONS,
    ...(validated
      ? {
          etag: representationEtag(representation, document.hash),
          lastModified: lastModifiedOf(document),
        }
      : {}),
    conditional: conditionalHeaders(c),
  });
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
function canonicalPath(c: Context<GeekityEnv>, pathname: string): string | undefined {
  if (pathname === '' || pathname.endsWith('/')) return undefined;

  const target = canonicalTarget(c, `${pathname}/`);
  if (target === undefined) return undefined;

  return `${target}${new URL(c.req.url).search}`;
}

/** Where a path with a trailing slash canonically lives, if anywhere. */
function canonicalTarget(c: Context<GeekityEnv>, pathname: string): string | undefined {
  const { store, renderer } = c.var;

  const document = store.getByPermalink(pathname);
  if (document !== undefined) {
    return isPublicDocument(document) ? encodePath(pathname) : undefined;
  }

  const listing = parseListingPath(pathname);
  if (listing === undefined) return undefined;

  // The home listing exists even with nothing on it; a tag archive does not.
  const total = listing.tag === undefined ? store.counts().posts : store.countByTag(listing.tag);
  if (listing.tag !== undefined && total === 0) return undefined;

  const totalPages = Math.max(1, Math.ceil(total / renderer.pageSize()));
  if (listing.pageNumber >= totalPages) return undefined;

  return listing.tag === undefined
    ? homeHref(listing.pageNumber)
    : tagHref(listing.tag, listing.pageNumber);
}

/** Which page of which listing a request is for. */
interface ListingRequest {
  /** The tag whose archive this is, or `undefined` for the home listing. */
  tag: string | undefined;
  /** Zero-based index of the page. */
  pageNumber: number;
}

/** `/`, `/page/N/`, `/tags/x/` and `/tags/x/page/N/`, as a listing to check. */
function parseListingPath(pathname: string): ListingRequest | undefined {
  const segments = pathname.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) return { tag: undefined, pageNumber: 0 };

  if (segments[0] === PAGE_SEGMENT && segments.length === 2) {
    const page = pageIndex(segments[1]);
    return page === undefined ? undefined : { tag: undefined, pageNumber: page };
  }

  if (segments[0] !== TAG_SEGMENT || segments[1] === undefined) return undefined;
  const tag = segments[1];

  if (segments.length === 2) return { tag, pageNumber: 0 };
  if (segments.length === 4 && segments[2] === PAGE_SEGMENT) {
    const page = pageIndex(segments[3]);
    return page === undefined ? undefined : { tag, pageNumber: page };
  }
  return undefined;
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
  const { tag } = request;
  const size = renderer.pageSize();

  // A tag archive only exists while something carries the tag; the home
  // listing exists even with nothing on it.
  const total = tag === undefined ? store.counts().posts : store.countByTag(tag);
  if (tag !== undefined && total === 0) return notFound(c);

  const href = tag === undefined ? homeHref(request.pageNumber) : tagHref(tag, request.pageNumber);
  const pagination = paginate({
    total,
    size,
    pageNumber: request.pageNumber,
    hrefForPage: (index) => (tag === undefined ? homeHref(index) : tagHref(tag, index)),
  });

  if (request.pageNumber >= pagination.totalPages) return notFound(c);
  if (representation === undefined) return notAcceptableResponse(href, LISTING_REPRESENTATIONS);

  const paging = { limit: size, offset: offsetForPage(request.pageNumber, size) };
  const documents = tag === undefined ? store.listPosts(paging) : store.listByTag(tag, paging);

  const full = wantsFullDocuments(c);
  const body =
    representation === 'json'
      ? documents.map((document) =>
          documentJson(document, { baseUrl: c.var.config.baseUrl, body: full }),
        )
      : renderer.renderListing({
          title: tag ?? renderer.site().title,
          url: href,
          documents,
          pagination,
          ...(tag === undefined ? {} : { tag, template: TEMPLATES.tag }),
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
 * The site's feed, or one tag's, in one format.
 *
 * A tag with nothing published under it 404s exactly as its archive does: a
 * feed reader should be told the URL is wrong rather than handed an empty feed
 * it will poll forever.
 */
function feed(c: Context<GeekityEnv>, format: FeedFormat, tag: string | undefined): Response {
  const { store, renderer, config } = c.var;
  const site = renderer.site();

  if (tag !== undefined && store.countByTag(tag) === 0) return notFound(c);

  const documents =
    tag === undefined
      ? store.listPosts({ limit: feedSize(site) })
      : store.listByTag(tag, { limit: feedSize(site) });

  const href = tag === undefined ? homeHref(0) : tagHref(tag, 0);
  const source: FeedSource = {
    site,
    documents,
    title: tag === undefined ? site.title : `${site.title}: ${tag}`,
    href,
    feedHref: feedHref(tag, format),
    baseUrl: config.baseUrl,
  };

  return feedResponse({ format, source, conditional: conditionalHeaders(c) });
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

/** The URL of a page of the home listing, by zero-based index. */
export function homeHref(index: number): string {
  return index === 0 ? '/' : `/${PAGE_SEGMENT}/${String(index + 1)}/`;
}

/** The URL of a page of a tag archive, by zero-based index. */
export function tagHref(tag: string, index: number): string {
  const root = `/${TAG_SEGMENT}/${encodeURIComponent(tag)}/`;
  return index === 0 ? root : `${root}${PAGE_SEGMENT}/${String(index + 1)}/`;
}

/** The URL of a feed: the whole archive's, or one tag's. */
export function feedHref(tag: string | undefined, format: FeedFormat): string {
  return tag === undefined ? `/${FEED_FILES[format]}` : `${tagHref(tag, 0)}${FEED_FILES[format]}`;
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
