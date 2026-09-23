import { feedItems } from './feed-item.ts';
import type { FeedItem } from './feed-item.ts';
import { notifyServerOf } from './feed-source.ts';
import type { FeedSource } from './feed-source.ts';
import { absoluteUrl } from './negotiate.ts';

/**
 * JSON Feed 1.1: the document, its items, and the vocabulary they are spelled
 * in.
 *
 * An item is keyed by the post's object id and lists every term it carries,
 * which is what the two XML formats do with the same item: decision-12 leaves
 * the three formats nothing to disagree about.
 */

/** The `version` every JSON Feed this CMS writes declares. */
export const JSON_FEED_VERSION = 'https://jsonfeed.org/version/1.1';

/** What JSON Feed 1.1 calls the protocol the notify server's hub speaks. */
export const JSON_FEED_HUB_TYPE = 'WebSub';

/** A JSON Feed 1.1 document. */
export interface JsonFeed {
  /** {@link JSON_FEED_VERSION}. */
  version: string;
  /** The feed's name. */
  title: string;
  /** The HTML page this feed syndicates. */
  home_page_url: string;
  /** Where this feed itself lives. */
  feed_url: string;
  /** The site's tagline, when it has one. */
  description?: string;
  /** Site-level authors, when the site names one. */
  authors?: JsonFeedAuthor[];
  /**
   * Where a subscriber can be told the feed changed rather than polling it.
   * One entry, the site's notify server, when it names one.
   */
  hubs?: JsonFeedHub[];
  /** The entries, newest first. */
  items: JsonFeedItem[];
}

/**
 * A real-time endpoint, as JSON Feed 1.1 models one. `type` names the protocol
 * rather than a media type, and `WebSub` is the one this CMS's server speaks.
 */
export interface JsonFeedHub {
  /** The protocol: `WebSub`. */
  type: string;
  /** The hub's URL. */
  url: string;
}

/** An author, as JSON Feed 1.1 models one. */
export interface JsonFeedAuthor {
  name: string;
}

/** One entry of a {@link JsonFeed}. */
export interface JsonFeedItem {
  /**
   * Permanent identifier: the post's ActivityStreams object id, which is its
   * permalink unless the post carries a stored one.
   */
  id: string;
  /** Where the entry can be read: the permalink. */
  url: string;
  /** Display title, absent for a note. */
  title?: string;
  /** The rendered body. */
  content_html: string;
  /** The post's summary, unless there is nothing to summarise. */
  summary?: string;
  /** Publish date, RFC 3339. */
  date_published?: string;
  /** Last modification date, RFC 3339. */
  date_modified?: string;
  /** The post's terms — its categories and then its tags, in file order. */
  tags?: string[];
  /** The post's own author, when it names one. */
  authors?: JsonFeedAuthor[];
}

/** One feed as a JSON Feed 1.1 document. */
export function jsonFeed(source: FeedSource): JsonFeed {
  const { site, baseUrl } = source;
  const notify = notifyServerOf(site);

  return {
    version: JSON_FEED_VERSION,
    title: source.title,
    home_page_url: absoluteUrl(source.href, baseUrl),
    feed_url: absoluteUrl(source.feedHref, baseUrl),
    ...(site.tagline === undefined ? {} : { description: site.tagline }),
    ...(site.author === undefined ? {} : { authors: [{ name: site.author }] }),
    ...(notify === undefined ? {} : { hubs: [{ type: JSON_FEED_HUB_TYPE, url: notify.hub }] }),
    items: feedItems(source.documents, source).map(jsonFeedItem),
  };
}

/** One item as a JSON Feed item. */
export function jsonFeedItem(item: FeedItem): JsonFeedItem {
  const entry: JsonFeedItem = {
    id: item.id,
    url: item.link,
    ...(item.title === undefined ? {} : { title: item.title }),
    content_html: item.html,
  };

  // A key with nothing behind it is left out rather than sent empty: a JSON
  // Feed reader treats absent and empty differently.
  if (item.summary !== '') entry.summary = item.summary;
  if (item.published !== undefined) entry.date_published = item.published.toISOString();
  if (item.updated !== undefined) entry.date_modified = item.updated.toISOString();
  if (item.terms.length > 0) entry.tags = [...item.terms];
  if (item.author !== undefined) entry.authors = [{ name: item.author }];

  return entry;
}
