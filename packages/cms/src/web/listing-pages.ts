import type { Context } from 'hono';

import type { Document } from '../content/document.ts';
import type { ListOptions } from '../content/store.ts';
import { devModeOn } from '../dev-mode.ts';
import type { GeekityEnv } from '../env.ts';
import { archiveOf } from './listing-subject.ts';
import type { ListingRequest } from './listing-subject.ts';
import { listingMarkdown } from './markdown-representation.ts';
import {
  documentJson,
  latestModified,
  LISTING_REPRESENTATIONS,
  MEDIA_TYPES,
  notAcceptableResponse,
  representationEtag,
  representationResponse,
  SEARCH_REPRESENTATIONS,
} from './negotiate.ts';
import type { Representation } from './negotiate.ts';
import { offsetForPage, paginate } from './pagination.ts';
import type { Pagination } from './pagination.ts';
import {
  conditionalHeaders,
  drawnForSomebody,
  notFound,
  queryFeedFormat,
  selectFromAccept,
  wantsFullDocuments,
} from './request.ts';
import {
  searchHref,
  searchJson,
  searchPageIndex,
  searchQuery,
  SEARCH_PAGE_PARAM,
  SEARCH_QUERY_PARAM,
} from './search.ts';
import { siteView } from './site-view.ts';

interface OpenPage {
  pagination: Pagination;
  href: string;
  representation: Representation;
  paging: ListOptions;
}

function openPage(
  c: Context<GeekityEnv>,
  options: {
    total: number;
    pageNumber: number;
    hrefForPage: (index: number) => string;
    representation: Representation | undefined;
    available: readonly Representation[];
  },
): OpenPage | Response {
  const { pageNumber, hrefForPage, representation } = options;
  const size = c.var.renderer.pageSize();
  const pagination = paginate({ total: options.total, size, pageNumber, hrefForPage });
  if (pageNumber >= pagination.totalPages) return notFound(c);

  const href = hrefForPage(pageNumber);
  if (representation === undefined) return notAcceptableResponse(href, options.available);
  return {
    pagination,
    href,
    representation,
    paging: { limit: size, offset: offsetForPage(pageNumber, size) },
  };
}

function pagedResponse(
  c: Context<GeekityEnv>,
  page: OpenPage,
  options: {
    body: unknown;
    documents: readonly Document[];
    available: readonly Representation[];
    links?: string[];
    full?: boolean;
    fingerprint?: string;
  },
): Response {
  const { representation, href, pagination } = page;
  const { documents } = options;
  const sendsValidators = representation !== 'html' || !c.var.config.watch;
  const fingerprint =
    options.fingerprint ??
    listingFingerprint(href, pagination, documents, options.full ?? false, devModeOn(c.var.config));

  return representationResponse({
    body: options.body,
    representation,
    href,
    available: options.available,
    ...(options.links === undefined ? {} : { links: options.links }),
    ...(drawnForSomebody(c, representation) ? { private: true } : {}),
    ...(sendsValidators
      ? {
          etag: representationEtag(representation, fingerprint),
          lastModified: latestModified(documents),
        }
      : {}),
    conditional: conditionalHeaders(c),
  });
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
  devMode: boolean,
): string {
  return [
    href,
    ...(devMode ? ['dev mode'] : []),
    `${String(pagination.pageNumber)}/${String(pagination.totalPages)}/${String(pagination.total)}`,
    full ? 'full' : 'summary',
    ...documents.map((document) => document.hash),
  ].join('\n');
}

/** One page of a listing, in whichever representation the request settled on. */
export function listing(
  c: Context<GeekityEnv>,
  request: ListingRequest,
  representation: Representation | undefined = selectFromAccept(c, LISTING_REPRESENTATIONS),
): Response {
  const { renderer, config } = c.var;
  const archive = archiveOf(siteView(c), request.subject);

  // WordPress served every feed as a query on the listing before it served one
  // at a path, and the links are still out there. `/?feed=rss2` and
  // `/{base}/x/?feed=atom` land on the feed the listing now has.
  const asked = queryFeedFormat(c);
  if (asked !== undefined) return c.redirect(archive.feedHref(asked), 301);

  const page = openPage(c, {
    total: archive.count(),
    pageNumber: request.pageNumber,
    hrefForPage: archive.href,
    representation,
    available: LISTING_REPRESENTATIONS,
  });
  if (page instanceof Response) return page;

  const documents = archive.list(page.paging);
  const title = archive.pageTitle(renderer.site());
  const available = LISTING_REPRESENTATIONS;

  if (page.representation === 'markdown' || page.representation === 'text') {
    const body = listingMarkdown(c, archive, { ...page, title, documents });
    return pagedResponse(c, page, { body, documents, available, fingerprint: body });
  }

  const full = wantsFullDocuments(c);
  const body =
    page.representation === 'json'
      ? documents.map((document) => documentJson(document, { baseUrl: config.baseUrl, body: full }))
      : renderer.renderListing({
          title,
          url: page.href,
          documents,
          pagination: page.pagination,
          ...archive.context,
        });

  return pagedResponse(c, page, { body, documents, available, full });
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
export function search(
  c: Context<GeekityEnv>,
  representation: Representation | undefined,
): Response {
  const { store, renderer, config } = c.var;
  const query = searchQuery(c.req.query(SEARCH_QUERY_PARAM));
  const pageNumber = searchPageIndex(c.req.query(SEARCH_PAGE_PARAM));
  if (pageNumber === undefined) return notFound(c);

  const page = openPage(c, {
    total: store.countSearch(query),
    pageNumber,
    hrefForPage: (index) => searchHref(query, index),
    representation,
    available: SEARCH_REPRESENTATIONS,
  });
  if (page instanceof Response) return page;

  const hits = store.search(query, page.paging);
  const full = wantsFullDocuments(c);
  const body =
    page.representation === 'json'
      ? searchJson({
          query,
          hits,
          pagination: page.pagination,
          baseUrl: config.baseUrl,
          body: full,
        })
      : renderer.renderSearch({ query, url: page.href, hits, pagination: page.pagination });

  return pagedResponse(c, page, {
    body,
    documents: hits.map((hit) => hit.document),
    // The alternates are spelled here rather than by the negotiator, because
    // they carry the query and a listing's never have one to carry.
    available: [page.representation],
    links: SEARCH_REPRESENTATIONS.filter((other) => other !== page.representation).map(
      (other) =>
        `<${searchHref(query, pageNumber, other)}>; rel="alternate"; type="${MEDIA_TYPES[other]}"`,
    ),
    full,
  });
}
