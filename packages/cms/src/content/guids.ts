import { createHash } from 'node:crypto';

import { absoluteUrl } from '../util/url.ts';
import type { Document } from './document.ts';

/**
 * The names this site gives things to the world outside it: a post's object
 * id, a feed guid, a comment's page.
 */

/**
 * A post's ActivityStreams object id: its permalink, absolute on the site's
 * base URL, or the id its file already names.
 *
 * decision-13. A permalink is by name permanent, and the fediverse id is the
 * same promise made to a different audience, so one URL answers both: a
 * browser gets the page and a peer gets the `Article`, by content negotiation.
 * There is no second URL to mint and none to keep in step.
 *
 * A stored `activitypub.id` wins, for the life of the post. That is not a
 * cache: it is what lets a post migrated from WordPress keep the
 * `https://example.com/?p=813` id its followers, its replies and its RSS
 * subscribers already hold (decision-14), so the CMS serves the object there
 * too and names it in every `Update` and `Delete`. A hand-written
 * `activitypub.id` that is not a URL is not an id, and the permalink is used
 * instead.
 *
 * Unlike `activityStreamsId` this answers for any post, published or
 * not: a draft that was announced before it was withdrawn still has the name
 * its followers filed it under, and a `Delete` has to say it.
 */
export function postObjectId(document: Document, baseUrl: string): string {
  const stored = document.activitypub?.id;
  if (stored !== undefined && stored !== '') {
    try {
      return new URL(stored).href;
    } catch {
      // Not a URL, so not an id. Fall through to the permalink.
    }
  }
  return absoluteUrl(document.permalink, baseUrl);
}

/**
 * The guid every feed keys a document by (decision-12): a migrated document's
 * stored `guid`, else a post's object id, else its permalink. The post feeds
 * and the comments feeds both name it so, which is what lets a reply's
 * `source:inReplyTo` name the item it answers (TASK-324).
 *
 * It is the guid the document has while it is served, which is the only time
 * a feed carries it, so it does not depend on the clock and the index can
 * hold its key.
 */
export function feedGuid(document: Document, baseUrl: string): string {
  const guid = document.extra['guid'];
  if (typeof guid === 'string' && URL.canParse(guid.trim())) return guid.trim();
  return document.type === 'post'
    ? postObjectId(document, baseUrl)
    : absoluteUrl(document.permalink, baseUrl);
}

/** Where a native comment's own page is (TASK-318), by its key. */
export function commentPageHref(key: string): string {
  return `${COMMENT_PAGE_PREFIX}${key}/`;
}

/** What every comment page's path starts with. */
export const COMMENT_PAGE_PREFIX = '/comment/';

/** The key of an item that has no stored id: the first 16 hex digits of the SHA-256 of its feed guid. */
export function repliesKey(guid: string): string {
  return createHash('sha256').update(guid).digest('hex').slice(0, 16);
}
