import { ADMIN_PREFIX } from '../admin/session.ts';
import { escapeXml } from './feeds.ts';
import { absoluteUrl, contentEtag, isNotModified } from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';

/**
 * Where the sitemap and the robots file live, and what goes in them.
 *
 * Both are fixed paths at the root of the site, which is the only place a
 * crawler looks for them, so both are real routes rather than anything
 * resolved from the content index — a document permalinked at `/sitemap.xml`
 * cannot take the URL a search engine polls.
 *
 * This module writes the documents and answers the requests; the *contents* of
 * the sitemap — which URLs the site publishes — are assembled in
 * `routes.ts`, where the listings, the archives and the permalinks are already
 * spelled, so the sitemap cannot disagree with the site about where anything
 * is.
 */

/** The sitemap's URL. Fixed: it is the one a `robots.txt` names. */
export const SITEMAP_PATH = '/sitemap.xml';

/** The robots file's URL. Fixed by the standard; nothing else is looked at. */
export const ROBOTS_PATH = '/robots.txt';

/** The namespace both a `<urlset>` and a `<sitemapindex>` are written in. */
export const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';

/**
 * How many URLs one sitemap file may hold before the site serves an index of
 * several instead.
 *
 * The protocol's own ceiling. Its other ceiling is 50 MB uncompressed, which
 * this one reaches first by a wide margin: an entry is a `<loc>` and a
 * `<lastmod>`, on the order of 120 bytes, so a full file is nearer 6 MB than
 * 50. Splitting on the count alone keeps one number to reason about.
 */
export const SITEMAP_MAX_URLS = 50_000;

/**
 * The route pattern the child sitemaps are served under.
 *
 * How many children there are depends on how much the site has published, so
 * they cannot be a list of literal routes; the pattern is fixed even though
 * the set is not.
 */
export const SITEMAP_CHILD_ROUTE = '/sitemap-:page{[0-9]+}.xml';

/** The URL of the nth child sitemap, counting from one. */
export function sitemapChildPath(page: number): string {
  return `/sitemap-${String(page)}.xml`;
}

/** One entry: a URL the site publishes, and when it last changed. */
export interface SitemapUrl {
  /** The site-relative path, as the site itself spells it. */
  loc: string;
  /** When it last changed, or `undefined` when nothing dates it. */
  lastmod?: Date | undefined;
}

/**
 * A date as the sitemap protocol wants it: a W3C datetime.
 *
 * The milliseconds go, because nothing about a page changes within one and a
 * crawler reads the field to the second at best.
 */
export function sitemapDate(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

/** One `<urlset>` document over the URLs it is given. */
export function sitemapXml(urls: readonly SitemapUrl[], baseUrl: string): string {
  return document('urlset', urls, baseUrl, 'url');
}

/**
 * One `<sitemapindex>` document naming the child sitemaps.
 *
 * Same shape as a `<urlset>` with a different element name around each entry,
 * which is exactly what the protocol says the two documents are.
 */
export function sitemapIndexXml(children: readonly SitemapUrl[], baseUrl: string): string {
  return document('sitemapindex', children, baseUrl, 'sitemap');
}

/** Either sitemap document: the same entries under a different pair of names. */
function document(
  root: string,
  entries: readonly SitemapUrl[],
  baseUrl: string,
  entryName: string,
): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${root} xmlns="${SITEMAP_NAMESPACE}">`,
  ];

  for (const entry of entries) {
    lines.push(`  <${entryName}>`);
    lines.push(`    <loc>${escapeXml(absoluteUrl(entry.loc, baseUrl))}</loc>`);
    if (entry.lastmod !== undefined) {
      lines.push(`    <lastmod>${sitemapDate(entry.lastmod)}</lastmod>`);
    }
    lines.push(`  </${entryName}>`);
  }

  lines.push(`</${root}>`, '');
  return lines.join('\n');
}

/** What a sitemap is served as. */
export const SITEMAP_CONTENT_TYPE = 'application/xml; charset=utf-8';

/** What a robots file is served as. */
export const ROBOTS_CONTENT_TYPE = 'text/plain; charset=utf-8';

/** Everything one sitemap response needs. */
export interface SitemapResponseOptions {
  /** Every URL the site publishes, in the order the sitemap should list them. */
  urls: readonly SitemapUrl[];
  /** The site's public origin, for the absolute `<loc>`s. */
  baseUrl: string;
  /**
   * Which child sitemap to serve, counting from one, or `undefined` for
   * `/sitemap.xml` itself.
   */
  page?: number | undefined;
  /** URLs per file. Defaults to {@link SITEMAP_MAX_URLS}. */
  maxUrls?: number | undefined;
  /** The request's conditional headers, for the 304. */
  conditional?: ConditionalHeaders | undefined;
}

/**
 * One sitemap as an HTTP response, or `undefined` when the URL names a child
 * that does not exist and the caller owes a 404.
 *
 * `/sitemap.xml` is the whole thing while it fits, and an index naming the
 * children once it does not — a crawler that holds the URL keeps it either
 * way, which is the point of the index living at the same address.
 *
 * The validators are built before the conditional is decided, exactly as the
 * feeds do it, so a crawler polling with `If-None-Match` still gets the ETag
 * and the `Last-Modified` on the 304 it mostly receives.
 */
export function sitemapResponse(options: SitemapResponseOptions): Response | undefined {
  const { urls, baseUrl, page } = options;
  const maxUrls = options.maxUrls ?? SITEMAP_MAX_URLS;
  const split = urls.length > maxUrls;

  if (page !== undefined && (!split || page < 1 || page > chunkCount(urls.length, maxUrls))) {
    return undefined;
  }

  const entries =
    page !== undefined
      ? urls.slice((page - 1) * maxUrls, page * maxUrls)
      : split
        ? childEntries(urls, maxUrls)
        : urls;

  const body =
    page === undefined && split ? sitemapIndexXml(entries, baseUrl) : sitemapXml(entries, baseUrl);

  const etag = contentEtag('sitemap', fingerprint(entries, baseUrl, page));
  const lastModified = newest(entries);

  const headers = new Headers({ etag, 'cache-control': 'no-cache' });
  if (lastModified !== undefined) headers.set('last-modified', lastModified.toUTCString());

  if (isNotModified(options.conditional, etag, lastModified)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', SITEMAP_CONTENT_TYPE);
  return new Response(body, { headers });
}

/** How many child sitemaps a URL count needs. */
function chunkCount(total: number, maxUrls: number): number {
  return Math.ceil(total / maxUrls);
}

/**
 * The children an index names: one per chunk, each dated by the newest thing
 * in it, so a crawler can skip a file whose contents it already has.
 */
function childEntries(urls: readonly SitemapUrl[], maxUrls: number): SitemapUrl[] {
  const children: SitemapUrl[] = [];
  for (let index = 0; index < chunkCount(urls.length, maxUrls); index += 1) {
    const chunk = urls.slice(index * maxUrls, (index + 1) * maxUrls);
    children.push({ loc: sitemapChildPath(index + 1), lastmod: newest(chunk) });
  }
  return children;
}

/** The most recent `lastmod` among some entries, if any has one. */
function newest(entries: readonly SitemapUrl[]): Date | undefined {
  let latest: Date | undefined;
  for (const entry of entries) {
    if (entry.lastmod === undefined) continue;
    if (latest === undefined || entry.lastmod > latest) latest = entry.lastmod;
  }
  return latest;
}

/** What a sitemap document is made of, as one string to hash. */
function fingerprint(
  entries: readonly SitemapUrl[],
  baseUrl: string,
  page: number | undefined,
): string {
  return [
    baseUrl,
    page === undefined ? 'index' : String(page),
    ...entries.map((entry) => `${entry.loc} ${entry.lastmod?.toISOString() ?? ''}`),
  ].join('\n');
}

/**
 * The robots file: everything public is crawlable, the admin is not, and the
 * sitemap is named absolutely because that is the only spelling the standard
 * allows for a `Sitemap:` line.
 *
 * Nothing else is disallowed. The ActivityPub routes under `/ap/` are left
 * open deliberately: an actor and an object are documents meant to be
 * fetched, they carry the same content as the pages that link to them, and a
 * crawler that follows one gets JSON it will ignore. Hiding them would only
 * make the fediverse's own view of the site depend on a file written for
 * search engines.
 */
export function robotsTxt(baseUrl: string): string {
  return [
    'User-agent: *',
    `Disallow: ${ADMIN_PREFIX}/`,
    '',
    `Sitemap: ${absoluteUrl(SITEMAP_PATH, baseUrl)}`,
    '',
  ].join('\n');
}

/**
 * The robots file as an HTTP response.
 *
 * It has a validator but no `Last-Modified`: nothing dates it. Its body is a
 * function of the site's origin alone, so the ETag moves when that does and
 * never otherwise, which is exactly what a crawler's `If-None-Match` should
 * be told.
 */
export function robotsResponse(baseUrl: string, conditional?: ConditionalHeaders): Response {
  const body = robotsTxt(baseUrl);
  const etag = contentEtag('robots', body);
  const headers = new Headers({ etag, 'cache-control': 'no-cache' });

  if (isNotModified(conditional, etag, undefined)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', ROBOTS_CONTENT_TYPE);
  return new Response(body, { headers });
}
