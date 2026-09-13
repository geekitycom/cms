import type { Document } from '../content/document.ts';
import { isScheduled } from '../content/schedule.ts';
import { isTrashedPath } from '../content/store.ts';
import type { ContentStore } from '../content/store.ts';
import { absoluteUrl } from './negotiate.ts';

/**
 * Whether the public site may show a document.
 *
 * Three things hide one: `draft: true` in the front matter, living under
 * `_trash/`, and a date that has not arrived yet. All three stay indexed so
 * the admin can find them; none is ever served, listed, or fed.
 *
 * This is the predicate the index answers in SQL, so anything that has to
 * decide about a single document in hand — a permalink, a View link, the
 * sitemap — asks it here rather than deriving the rule again. The clock
 * defaults to the system one; a caller with a store should pass
 * {@link ContentStore.now} so the answer matches the listings it came from.
 */
export function isPublicDocument(document: Document, now: Date = new Date()): boolean {
  return !document.draft && !isTrashedPath(document.path) && !isScheduled(document, now);
}

/**
 * The document a public URL resolves to, or `undefined`.
 *
 * This is the single lookup the public site does: every representation of a
 * document — the theme's HTML, the Markdown file, the JSON object — is the
 * same document found the same way, so they cannot disagree about what exists.
 */
export function publicDocumentAt(store: ContentStore, permalink: string): Document | undefined {
  const document = store.getByPermalink(permalink);
  if (document === undefined || !isPublicDocument(document, store.now())) return undefined;
  return document;
}

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
 * Unlike {@link activityStreamsId} this answers for any post, published or
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
 * The ActivityStreams id of a document, or `undefined` when it has none.
 *
 * Only a published post federates (doc-4), so only a published post has an id
 * to advertise. This is what the theme's `<link rel="alternate">` points at,
 * what every feed keys the post by (decision-12) and what the permalink
 * answers an ActivityStreams request with: the page, the feed item and the
 * object all agree about the post's name in the fediverse, because after
 * decision-13 they are the same URL.
 */
export function activityStreamsId(document: Document, baseUrl: string): string | undefined {
  if (document.type !== 'post' || !isPublicDocument(document)) return undefined;
  return postObjectId(document, baseUrl);
}
