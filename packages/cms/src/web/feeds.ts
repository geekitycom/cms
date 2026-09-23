import { atomFeed } from './feed-atom.ts';
import { FEED_ITEM_REVISION } from './feed-item.ts';
import { jsonFeed } from './feed-json.ts';
import { rssFeed, commentsRssFeed } from './feed-rss.ts';
import { FEED_CONTENT_TYPES, feedLanguage, notifyServerOf } from './feed-source.ts';
import type { CommentFeedSource, FeedFormat, FeedIdentity, FeedSource } from './feed-source.ts';
import { absoluteUrl, contentEtag, isNotModified, latestModified } from './negotiate.ts';
import type { ConditionalHeaders } from './negotiate.ts';

/**
 * How a feed is served: its validator, its headers, and which serialiser
 * writes its body.
 *
 * The feed itself is spread over four modules below this one — what a feed is
 * (`feed-source.ts`), the item every format renders (`feed-item.ts`), the
 * three serialisers (`feed-rss.ts`, `feed-atom.ts`, `feed-json.ts`) and the
 * XML plumbing they share (`feed-xml.ts`). This file re-exports all of it, so
 * everything that used to import from `./feeds.ts` still can and there is one
 * name for the whole subject.
 */

export {
  COMMENTS_ROOT,
  COMMENTS_TITLE_PREFIX,
  commentsFeedPath,
  contentTypeOf,
  DEFAULT_FEED_LANGUAGE,
  DEFAULT_FEED_SIZE,
  DEFAULT_NOTIFY_SERVER,
  EMPTY_FEED_UPDATED,
  FEED_ALIASES,
  FEED_CONTENT_TYPES,
  FEED_FORMATS,
  FEED_GENERATOR,
  FEED_GENERATOR_URI,
  FEED_SEGMENT,
  FEED_SEGMENTS,
  feedLanguage,
  feedPathUnder,
  feedSize,
  NOTIFY_CLOUD_PORT,
  NOTIFY_CLOUD_PROTOCOL,
  NOTIFY_PATHS,
  notifyEndpoints,
  notifyServerOf,
  splitFeedPath,
} from './feed-source.ts';
export type {
  CommentFeedSource,
  FeedComment,
  FeedFormat,
  FeedIdentity,
  FeedPath,
  FeedSource,
  NotifyServer,
} from './feed-source.ts';

export {
  EXCERPT_WORDS,
  excerptFromHtml,
  FEED_ITEM_REVISION,
  feedExcerpt,
  feedItem,
  feedItems,
} from './feed-item.ts';
export type { FeedItem, FeedItemComments, FeedItemContext } from './feed-item.ts';

export {
  cdata,
  DC_NAMESPACE,
  escapeXml,
  rfc822,
  SOURCE_NAMESPACE,
  WFW_NAMESPACE,
} from './feed-xml.ts';

export { commentsRssFeed, rssFeed, rssItem } from './feed-rss.ts';
export { atomEntry, atomFeed } from './feed-atom.ts';
export { JSON_FEED_HUB_TYPE, JSON_FEED_VERSION, jsonFeed, jsonFeedItem } from './feed-json.ts';
export type {
  JsonFeed,
  JsonFeedAuthor,
  JsonFeedGeekity,
  JsonFeedHub,
  JsonFeedItem,
} from './feed-json.ts';

/** Everything one feed response needs. */
export interface FeedResponseOptions {
  /** Which format the body is. */
  format: FeedFormat;
  /** What the feed is built from, for the body and the validator alike. */
  source: FeedSource;
  /** The request's conditional headers, for the 304. */
  conditional?: ConditionalHeaders | undefined;
}

/**
 * One feed as an HTTP response, validator and conditional handling included.
 *
 * Feeds are polled far more often than they change, so the cheap 304 matters
 * more here than anywhere else on the site. The validator covers the documents
 * *and* the feed's own metadata, because a renamed site is a changed feed even
 * when no post moved.
 */
export function feedResponse(options: FeedResponseOptions): Response {
  const { format, source } = options;
  // The revision is part of the label rather than of the fingerprint so that
  // what a feed is made of and how it is written stay separate reasons for the
  // validator to move. See {@link FEED_ITEM_REVISION}.
  const etag = contentEtag(`feed:${format}:${String(FEED_ITEM_REVISION)}`, feedFingerprint(source));
  const lastModified = latestModified(source.documents);
  const headers = feedHeaders(source, etag, lastModified);

  if (isNotModified(options.conditional, etag, lastModified)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', FEED_CONTENT_TYPES[format]);
  const body =
    format === 'rss'
      ? rssFeed(source)
      : format === 'atom'
        ? atomFeed(source)
        : `${JSON.stringify(jsonFeed(source), undefined, 2)}\n`;

  return new Response(body, { headers });
}

/**
 * One comments feed as an HTTP response.
 *
 * Comments arrive from other people's servers rather than from the site's own
 * files, so the validator is built from the comments themselves; a feed with
 * none still has one, which is what makes an empty comments feed cheap to poll.
 */
export function commentsFeedResponse(
  source: CommentFeedSource,
  conditional?: ConditionalHeaders,
): Response {
  const etag = contentEtag('comments:rss', commentsFingerprint(source));
  const lastModified = source.comments[0]?.published;
  const headers = feedHeaders(source, etag, lastModified);

  if (isNotModified(conditional, etag, lastModified)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-type', FEED_CONTENT_TYPES.rss);
  return new Response(commentsRssFeed(source), { headers });
}

/**
 * The headers every feed response carries, whichever kind of feed it is and
 * whether it becomes a body or a 304.
 *
 * They are built in one place, and before the conditional is decided, because
 * a poller mostly gets the 304 — and a 304 that dropped the hub would hide the
 * one thing that stops it polling.
 */
function feedHeaders(source: FeedIdentity, etag: string, lastModified: Date | undefined): Headers {
  const headers = new Headers({ etag, 'cache-control': 'no-cache' });
  if (lastModified !== undefined) headers.set('last-modified', lastModified.toUTCString());

  const link = feedLinkHeader(source);
  if (link !== undefined) headers.set('link', link);

  return headers;
}

/**
 * WebSub's discovery header: the hub and the feed's own URL, in that order.
 *
 * A subscriber is meant to find both without parsing the body, which is the
 * only way a JSON Feed or a 304 could tell it anything at all. `undefined`
 * when the site names no notify server.
 */
export function feedLinkHeader(source: FeedIdentity): string | undefined {
  const notify = notifyServerOf(source.site);
  if (notify === undefined) return undefined;

  const self = absoluteUrl(source.feedHref, source.baseUrl);
  return `<${notify.hub}>; rel="hub", <${self}>; rel="self"`;
}

/** What a comments feed is made of, as one string to hash. */
function commentsFingerprint(source: CommentFeedSource): string {
  return [
    source.feedHref,
    source.title,
    source.site.tagline ?? '',
    feedLanguage(source.site),
    notifyServerOf(source.site)?.base ?? '',
    source.baseUrl,
    ...source.comments.map((comment) =>
      [comment.id, comment.author, comment.published.toISOString(), comment.html].join('\0'),
    ),
  ].join('\n');
}

/** What a feed is made of, as one string to hash. */
function feedFingerprint(source: FeedSource): string {
  return [
    source.feedHref,
    source.title,
    source.site.tagline ?? '',
    source.site.author ?? '',
    source.site.avatar ?? '',
    feedLanguage(source.site),
    notifyServerOf(source.site)?.base ?? '',
    source.baseUrl,
    ...source.documents.map(
      (document) =>
        `${document.hash} ${String(source.commentCounts?.get(document.permalink) ?? 0)}`,
    ),
  ].join('\n');
}
