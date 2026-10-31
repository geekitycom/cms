import type { Context } from 'hono';

import type { Document } from '../content/document.ts';
import { postLabel } from '../content/post-type.ts';
import type { GeekityEnv } from './env.ts';
import { FEED_FORMATS, FEED_SEGMENTS } from './feeds.ts';
import type { FeedFormat } from './feeds.ts';
import { selectRepresentation } from './negotiate.ts';
import type { ConditionalHeaders, Representation } from './negotiate.ts';

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

export function requestSearch(c: Context<GeekityEnv>): string {
  return new URL(c.req.url).search;
}

/** The conditional request headers, as the negotiator wants them. */
export function conditionalHeaders(c: Context<GeekityEnv>): ConditionalHeaders {
  return {
    ifNoneMatch: c.req.header('if-none-match'),
    ifModifiedSince: c.req.header('if-modified-since'),
  };
}

/** The representation an `Accept` header asked for, or `undefined` for a 406. */
export function selectFromAccept(
  c: Context<GeekityEnv>,
  available: readonly Representation[],
): Representation | undefined {
  return selectRepresentation(c.req.header('accept'), available);
}

/**
 * Whether this is a page drawn for a signed-in reader, which carries the admin
 * bar and so must never be answered with a 304 off the validators of
 * the copy an anonymous visit left in their browser.
 */
export function drawnForSomebody(c: Context<GeekityEnv>, representation: Representation): boolean {
  return representation === 'html' && c.var.signedIn !== undefined;
}

/**
 * Whether the request asked for whole documents rather than summaries.
 *
 * Anything but an explicit denial counts, so `?full`, `?full=1` and `?full=yes`
 * all mean the same thing to someone typing a URL by hand.
 */
export function wantsFullDocuments(c: Context<GeekityEnv>): boolean {
  const value = c.req.query('full');
  return value !== undefined && value !== '0' && value.toLowerCase() !== 'false';
}

/**
 * The format `?feed=` asked for, WordPress's pre-permalink spelling, or
 * `undefined` when the request did not ask for a feed at all.
 *
 * `rss2` is what WordPress calls RSS 2.0 and `rss` its RSS 0.92, which this
 * site does not serve and answers with the RSS 2.0 feed rather than a 404.
 */
export function queryFeedFormat(c: Context<GeekityEnv>): FeedFormat | undefined {
  const asked = c.req.query('feed');
  if (asked === undefined) return undefined;
  if (asked === 'rss2' || asked === 'rss') return 'rss';
  return FEED_FORMATS.find((format) => FEED_SEGMENTS[format] === asked);
}

export function documentLabel(c: Context<GeekityEnv>, document: Document): string {
  return postLabel(document, (url) => c.var.replyContexts.read(url, c.var.siteAtRequestStart));
}
