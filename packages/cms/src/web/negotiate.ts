import { createHash } from 'node:crypto';

import type { Document } from '../content/document.ts';
import { documentFrontMatter } from '../content/writer.ts';
import { matchesEtag } from './assets.ts';

/**
 * Which of a resource's representations a request asked for.
 *
 * Every public content URL is one resource with several bodies. The routes
 * decide *what* is at a URL; this module decides *which body* to hand back and
 * how to label it, so the two questions never get tangled together.
 */
export type Representation = 'html' | 'markdown' | 'json';

/** The media type each representation is served as. */
export const MEDIA_TYPES: Readonly<Record<Representation, string>> = {
  html: 'text/html',
  markdown: 'text/markdown',
  json: 'application/json',
};

/**
 * What a document offers, in preference order.
 *
 * Order is the tie-break when a request is indifferent — `Accept: *\/*`, or no
 * `Accept` at all — so HTML comes first: a browser that says nothing gets a
 * page.
 */
export const DOCUMENT_REPRESENTATIONS: readonly Representation[] = ['html', 'markdown', 'json'];

/** What a listing offers. Markdown is not a listing; there is no file to serve. */
export const LISTING_REPRESENTATIONS: readonly Representation[] = ['html', 'json'];

/**
 * The representation a request accepts, or `undefined` when it accepts none of
 * them and is owed a 406.
 *
 * A missing header means "anything", which is HTML. A present header is matched
 * by the usual rules: highest q wins, the more specific match wins a tie, and
 * our own preference order breaks what is left.
 */
export function selectRepresentation(
  accept: string | undefined,
  available: readonly Representation[],
): Representation | undefined {
  if (accept === undefined || accept.trim() === '') return available[0];

  const ranges = parseAccept(accept);
  if (ranges.length === 0) return available[0];

  let best: { representation: Representation; quality: number; specificity: number } | undefined;

  for (const representation of available) {
    const match = bestRange(ranges, MEDIA_TYPES[representation]);
    if (match === undefined || match.quality <= 0) continue;

    if (
      best === undefined ||
      match.quality > best.quality ||
      (match.quality === best.quality && match.specificity > best.specificity)
    ) {
      best = { representation, quality: match.quality, specificity: match.specificity };
    }
  }

  return best?.representation;
}

/**
 * The media types that ask for the ActivityStreams document rather than for
 * one of the representations this layer serves (doc-3).
 *
 * The `ld+json` spelling is listed without its
 * `profile="https://www.w3.org/ns/activitystreams"` parameter, because that is
 * how `Accept` matching works: a range's parameters other than `q` do not
 * narrow what it matches, and nothing else the CMS serves is `ld+json`.
 */
export const ACTIVITY_STREAMS_MEDIA_TYPES: readonly string[] = [
  'application/activity+json',
  'application/ld+json',
];

/**
 * Whether a request would rather have the ActivityStreams object than any
 * representation of the document.
 *
 * It is the same comparison {@link selectRepresentation} makes — highest q
 * wins, the more specific range wins a tie — with the ActivityStreams types on
 * one side and the document's own on the other. A tie goes to the document, so
 * `Accept: application/*` still gets JSON and a browser's
 * `text/html,…,*\/*;q=0.8` still gets a page.
 */
export function prefersActivityStreams(accept: string | undefined): boolean {
  if (accept === undefined || accept.trim() === '') return false;

  const ranges = parseAccept(accept);
  if (ranges.length === 0) return false;

  const wanted = bestOf(ranges, ACTIVITY_STREAMS_MEDIA_TYPES);
  if (wanted === undefined || wanted.quality <= 0) return false;

  const alternative = bestOf(
    ranges,
    DOCUMENT_REPRESENTATIONS.map((representation) => MEDIA_TYPES[representation]),
  );
  if (alternative === undefined || alternative.quality <= 0) return true;

  return (
    wanted.quality > alternative.quality ||
    (wanted.quality === alternative.quality && wanted.specificity > alternative.specificity)
  );
}

/** The best match among several media types, or `undefined` when none match. */
function bestOf(
  ranges: readonly AcceptRange[],
  mediaTypes: readonly string[],
): { quality: number; specificity: number } | undefined {
  let best: { quality: number; specificity: number } | undefined;

  for (const mediaType of mediaTypes) {
    const match = bestRange(ranges, mediaType);
    if (match === undefined) continue;
    if (
      best === undefined ||
      match.quality > best.quality ||
      (match.quality === best.quality && match.specificity > best.specificity)
    ) {
      best = match;
    }
  }

  return best;
}

/**
 * The extension that names a representation in a URL. HTML has none: it is
 * what the canonical URL itself serves.
 */
export const REPRESENTATION_EXTENSIONS: Readonly<Partial<Record<Representation, string>>> = {
  markdown: '.md',
  json: '.json',
};

/** A request that named its representation in the path rather than in a header. */
export interface RepresentationExtension {
  /** The representation the extension asked for. */
  representation: Representation;
  /** The paths to look the resource up under, likeliest first. */
  paths: readonly string[];
}

/**
 * A `.md` or `.json` suffix taken off a request path, or `undefined` when the
 * path carries neither.
 *
 * Both spellings work: `/2026/09/hello/index.md` — the one the `Link` header
 * advertises, and the one an Eleventy-style static build would produce — and
 * the shorter `/2026/09/hello.md` that people actually type. The result is a
 * list of candidate paths rather than one, because the trailing slash a
 * permalink carries is exactly what an extension has to displace.
 */
export function splitRepresentationExtension(
  pathname: string,
): RepresentationExtension | undefined {
  for (const [representation, extension] of Object.entries(REPRESENTATION_EXTENSIONS)) {
    if (extension === undefined || !pathname.endsWith(extension)) continue;

    let base = pathname.slice(0, -extension.length);
    const named = base.endsWith('/index');
    if (named) base = base.slice(0, -'index'.length);
    // `/.md` and `/x/.md` name no resource: the extension is the whole of the
    // last segment. Only the `index` spelling may leave a path ending in `/`.
    if (base === '' || (!named && base.endsWith('/'))) continue;

    const withSlash = base.endsWith('/') ? base : `${base}/`;
    const paths = base === withSlash ? [base] : [withSlash, base];

    return { representation: representation as Representation, paths };
  }

  return undefined;
}

/**
 * The URL one representation of a resource is served at, given the resource's
 * canonical URL.
 *
 * `index` is inserted before the extension when the canonical URL is a
 * directory-style path, which every permalink and every listing URL is.
 */
export function representationHref(href: string, representation: Representation): string {
  const extension = REPRESENTATION_EXTENSIONS[representation];
  if (extension === undefined) return href;
  return href.endsWith('/') ? `${href}index${extension}` : `${href}${extension}`;
}

/**
 * Version of the JSON representation.
 *
 * It is in every JSON body so a consumer can tell what it is reading. Keys are
 * only ever added within a version; anything that would break a reader gets a
 * new number.
 */
export const JSON_SCHEMA_VERSION = 1;

/** A document as JSON. `markdown` and `html` are absent from a listing summary. */
export interface DocumentJson {
  /** {@link JSON_SCHEMA_VERSION}. */
  schema: number;
  /** Absolute URL of the document, built on the site's `baseUrl`. */
  url: string;
  /** The front matter, exactly as the Markdown file carries it. */
  frontMatter: Record<string, unknown>;
  /** The Markdown body, without the front matter. Omitted from a summary. */
  markdown?: string;
  /** The rendered body. Omitted from a summary. */
  html?: string;
}

/** How to build a {@link DocumentJson}. */
export interface DocumentJsonOptions {
  /** The site's public origin, for the absolute `url`. */
  baseUrl: string;
  /** `false` leaves out `markdown` and `html`. Defaults to `true`. */
  body?: boolean | undefined;
}

/**
 * One document as JSON.
 *
 * The front matter is the writer's own block rather than a second rendering of
 * it, so what this reports and what the `.md` representation contains are the
 * same data.
 */
export function documentJson(document: Document, options: DocumentJsonOptions): DocumentJson {
  const json: DocumentJson = {
    schema: JSON_SCHEMA_VERSION,
    url: absoluteUrl(document.permalink, options.baseUrl),
    frontMatter: documentFrontMatter(document),
  };

  if (options.body !== false) {
    json.markdown = document.body;
    json.html = document.html;
  }

  return json;
}

/**
 * A path on the site as an absolute URL.
 *
 * A base URL carrying a path — a site served from a subdirectory — puts that
 * path in front of a root-relative one, exactly as the theme's `absoluteUrl`
 * filter does, so a document's id is the same string wherever it is built.
 */
export function absoluteUrl(pathname: string, baseUrl: string): string {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');
  const resolved = pathname.startsWith('/') ? `${basePath}${pathname}` : pathname;
  return new URL(resolved, base).toString();
}

/** What each representation is labelled with on the wire. */
const CONTENT_TYPES: Readonly<Record<Representation, string>> = {
  html: 'text/html; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

/** The conditional headers a request may carry. */
export interface ConditionalHeaders {
  /** `If-None-Match`. */
  ifNoneMatch?: string | undefined;
  /** `If-Modified-Since`. */
  ifModifiedSince?: string | undefined;
}

/** Everything one negotiated response needs. */
export interface RepresentationResponseOptions {
  /** A string for HTML and Markdown; anything serialisable for JSON. */
  body: unknown;
  /** Which representation `body` is. */
  representation: Representation;
  /** The resource's canonical URL path, percent-encoded. */
  href: string;
  /** Which representations this resource offers, for the `Link` alternates. */
  available: readonly Representation[];
  /**
   * Whole `Link` header values to advertise alongside the alternates — the
   * webmention endpoint is the one that uses it (TASK-51).
   *
   * Spelled by the caller rather than built here, because they are not
   * representations of this resource and nothing about them is this module's
   * business beyond joining them to the header.
   */
  links?: readonly string[] | undefined;
  /** Validator for this representation. Omit when one cannot be trusted. */
  etag?: string | undefined;
  /** When the resource last changed. */
  lastModified?: Date | undefined;
  /** The request's conditional headers, for the 304. */
  conditional?: ConditionalHeaders | undefined;
}

/**
 * One representation as an HTTP response, validators and alternates included.
 *
 * Every negotiated response in the CMS comes from here, so `Vary`, `Link` and
 * the conditional handling cannot be right on one route and forgotten on the
 * next. A request whose validators still match gets the 304 from here too: the
 * body is built either way, but building it is cheap next to shipping it, and
 * one exit means one place where the headers are decided.
 */
export function representationResponse(options: RepresentationResponseOptions): Response {
  const headers = new Headers({
    vary: 'Accept',
    link: [
      alternateLinks(options.href, options.representation, options.available),
      ...(options.links ?? []),
    ]
      .filter((value) => value !== '')
      .join(', '),
  });

  if (options.etag !== undefined) headers.set('etag', options.etag);
  if (options.lastModified !== undefined) {
    headers.set('last-modified', options.lastModified.toUTCString());
  }
  // A validator without a directive leaves the browser to guess how long the
  // response stays fresh. `no-cache` keeps the validator's value — a cheap 304
  // — without ever letting a stale page through.
  if (options.etag !== undefined || options.lastModified !== undefined) {
    headers.set('cache-control', 'no-cache');
  }

  if (isNotModified(options.conditional, options.etag, options.lastModified)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', CONTENT_TYPES[options.representation]);
  if (options.representation === 'markdown') {
    // The point of the Markdown representation is to be read, not downloaded.
    headers.set('content-disposition', 'inline');
  }

  const body =
    options.representation === 'json'
      ? `${JSON.stringify(options.body, undefined, 2)}\n`
      : String(options.body);

  return new Response(body, { headers });
}

/**
 * The 406 a request earns when it accepts none of the representations on
 * offer, with the options in the body so a client can pick one and retry.
 */
export function notAcceptableResponse(
  href: string,
  available: readonly Representation[],
): Response {
  return new Response(
    `${JSON.stringify(
      {
        error: 'not_acceptable',
        message: 'This URL is not available in any of the media types you accept.',
        alternates: available.map((representation) => ({
          type: MEDIA_TYPES[representation],
          url: representationHref(href, representation),
        })),
      },
      undefined,
      2,
    )}\n`,
    {
      status: 406,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        vary: 'Accept',
        link: alternateLinks(href, undefined, available),
      },
    },
  );
}

/**
 * A `Link` header advertising the representations other than the current one,
 * as doc-3 specifies.
 */
export function alternateLinks(
  href: string,
  current: Representation | undefined,
  available: readonly Representation[],
): string {
  return available
    .filter((representation) => representation !== current)
    .map(
      (representation) =>
        `<${representationHref(href, representation)}>; rel="alternate"; type="${MEDIA_TYPES[representation]}"`,
    )
    .join(', ');
}

/**
 * The validator for one representation of something whose content is already
 * hashed.
 *
 * Mixing the representation in is what keeps the three bodies at a URL apart:
 * a client holding the JSON must not be told its Markdown is unchanged.
 */
export function representationEtag(representation: Representation, fingerprint: string): string {
  return contentEtag(representation, fingerprint);
}

/**
 * A validator over any kind of body, given something that changes whenever the
 * body does.
 *
 * `kind` is what keeps two bodies built from the same documents apart — the
 * Atom feed and the JSON feed over one archive share every hash, and a client
 * holding one must not be told the other is unchanged.
 */
export function contentEtag(kind: string, fingerprint: string): string {
  const digest = createHash('sha256').update(`${kind}\n${fingerprint}`, 'utf8').digest('hex');
  return `"${digest.slice(0, 32)}"`;
}

/** When a document last changed: its `updated`, else its publish `date`. */
export function lastModifiedOf(document: Document): Date | undefined {
  for (const value of [document.updated, document.date]) {
    if (value === undefined) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

/** The most recent modification time among some documents, if any has one. */
export function latestModified(documents: readonly Document[]): Date | undefined {
  let latest: Date | undefined;
  for (const document of documents) {
    const modified = lastModifiedOf(document);
    if (modified === undefined) continue;
    if (latest === undefined || modified > latest) latest = modified;
  }
  return latest;
}

/**
 * Whether a conditional request may be answered with 304.
 *
 * `If-None-Match` wins outright when it is present, as RFC 9110 requires, so a
 * client that has both validators is never told a page is fresh on the
 * strength of a timestamp its ETag disagrees with.
 */
export function isNotModified(
  conditional: ConditionalHeaders | undefined,
  etag: string | undefined,
  lastModified: Date | undefined,
): boolean {
  if (conditional === undefined) return false;

  if (conditional.ifNoneMatch !== undefined) {
    return etag !== undefined && matchesEtag(conditional.ifNoneMatch, etag);
  }

  if (conditional.ifModifiedSince === undefined || lastModified === undefined) return false;
  const since = new Date(conditional.ifModifiedSince);
  if (Number.isNaN(since.getTime())) return false;

  // HTTP dates have one-second resolution; a document modified within the same
  // second as the copy the client holds is the copy the client holds.
  return Math.floor(lastModified.getTime() / 1000) <= Math.floor(since.getTime() / 1000);
}

/** One media range from an `Accept` header. */
export interface AcceptRange {
  /** The type, or `*`. */
  type: string;
  /** The subtype, or `*`. */
  subtype: string;
  /** The q-value, 0 to 1. Defaults to 1, as the header's grammar says. */
  quality: number;
}

/**
 * An `Accept` header as media ranges.
 *
 * Parameters other than `q` are parsed and dropped: none of our representations
 * are distinguished by one, and a range that carries some unknown parameter is
 * still a request for its media type. Anything unparseable is skipped rather
 * than failing the request, because a malformed `Accept` should cost a client
 * its preference, not its page.
 */
export function parseAccept(header: string): AcceptRange[] {
  const ranges: AcceptRange[] = [];

  for (const part of splitList(header)) {
    const [mediaRange, ...parameters] = part.split(';');
    const slash = (mediaRange ?? '').indexOf('/');
    if (slash <= 0) continue;

    const type = (mediaRange ?? '').slice(0, slash).trim().toLowerCase();
    const subtype = (mediaRange ?? '')
      .slice(slash + 1)
      .trim()
      .toLowerCase();
    if (type === '' || subtype === '') continue;

    ranges.push({ type, subtype, quality: qualityOf(parameters) });
  }

  return ranges;
}

/** The best range matching one media type, or `undefined` when none does. */
function bestRange(
  ranges: readonly AcceptRange[],
  mediaType: string,
): { quality: number; specificity: number } | undefined {
  const slash = mediaType.indexOf('/');
  const type = mediaType.slice(0, slash);
  const subtype = mediaType.slice(slash + 1);

  let best: { quality: number; specificity: number } | undefined;

  for (const range of ranges) {
    const specificity = specificityOf(range, type, subtype);
    if (specificity === undefined) continue;

    if (best === undefined || specificity > best.specificity) {
      best = { quality: range.quality, specificity };
    }
  }

  return best;
}

/**
 * How specifically a range names a media type: 2 for an exact match, 1 for
 * `type/*`, 0 for `*\/*`, `undefined` for no match at all.
 */
function specificityOf(range: AcceptRange, type: string, subtype: string): number | undefined {
  if (range.type === '*' && range.subtype === '*') return 0;
  if (range.type !== type) return undefined;
  if (range.subtype === '*') return 1;
  return range.subtype === subtype ? 2 : undefined;
}

/** The `q` parameter of a media range, clamped to the range the grammar allows. */
function qualityOf(parameters: readonly string[]): number {
  for (const parameter of parameters) {
    const equals = parameter.indexOf('=');
    if (equals < 0) continue;
    if (parameter.slice(0, equals).trim().toLowerCase() !== 'q') continue;

    const quality = Number(parameter.slice(equals + 1).trim());
    if (Number.isNaN(quality)) return 1;
    return Math.min(1, Math.max(0, quality));
  }
  return 1;
}

/** Split a comma-separated header, dropping the empty elements a stray comma leaves. */
function splitList(header: string): string[] {
  return header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}
