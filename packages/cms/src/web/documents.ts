import type { Document } from '../content/document.ts';
import { scheduledFor } from '../content/schedule.ts';
import { isTrashedPath } from '../content/store.ts';
import { visibilityOf } from '../content/visibility.ts';
import type { ContentStore } from '../content/store.ts';
import { absoluteUrl } from './negotiate.ts';

/**
 * Why the public site does not serve a document at its URL.
 *
 * Four things hide one: living under `_trash/`, `draft: true` in the front
 * matter, a date that has not arrived yet, and a `visibility` the site does
 * not recognize. All four stay indexed so the admin can find them; none is
 * ever listed or fed, and only the first is never shown to anybody: the other
 * three are the author's to read at the permalink while signed in (TASK-235).
 */
export type HiddenReason =
  | { readonly kind: 'trashed' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'scheduled'; readonly at: string }
  | { readonly kind: 'unrecognized-visibility'; readonly visibility: string };

/**
 * The index answers the same rule in SQL, so anything that has to decide
 * about a single document in hand — a permalink, a View link — asks it here
 * rather than deriving the rule again. The clock defaults to the system one; a
 * caller with a store should pass {@link ContentStore.now} so the answer
 * matches the listings it came from.
 */
export function hiddenReason(document: Document, now: Date = new Date()): HiddenReason | undefined {
  if (isTrashedPath(document.path)) return { kind: 'trashed' };
  return withheldReason(document, now);
}

/** Why a document is not served, setting the trash aside. */
function withheldReason(document: Document, now: Date): HiddenReason | undefined {
  if (document.draft) return { kind: 'draft' };
  const at = scheduledFor(document, now);
  if (at !== undefined) return { kind: 'scheduled', at };
  const visibility = visibilityOf(document);
  if (typeof visibility !== 'string') {
    return { kind: 'unrecognized-visibility', visibility: visibility.unrecognized };
  }
  return undefined;
}

export function isServed(document: Document, now: Date = new Date()): boolean {
  return hiddenReason(document, now) === undefined;
}

/**
 * Whether a document was deleted from the public site: it is in the trash, and
 * would be served if it were not (TASK-195).
 *
 * The trash file is the record of the deletion (decision-9), so a restore and
 * a new document at the URL both end it with no second record to clear. A
 * trashed draft was never public, so its URL stays a 404 rather than telling
 * anybody something used to be there.
 */
export function isGone(document: Document, now: Date = new Date()): boolean {
  return isTrashedPath(document.path) && withheldReason(document, now) === undefined;
}

/** The deleted document a public URL used to serve, or `undefined`. */
export function goneDocumentAt(store: ContentStore, permalink: string): Document | undefined {
  const document = store.getByPermalink(permalink);
  return document !== undefined && isGone(document, store.now()) ? document : undefined;
}

/**
 * Whether the site lists a document: served, and not unlisted (TASK-227).
 *
 * What every list the site publishes asks — the listings, the feeds, the
 * sitemap, search, `llms.txt`, IndexNow — about a document in hand. The
 * index's listing queries answer the same rule in SQL.
 */
export function isListed(document: Document, now: Date = new Date()): boolean {
  return isServed(document, now) && visibilityOf(document) === 'public';
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
  if (document === undefined || !isServed(document, store.now())) return undefined;
  return document;
}

export function previewDocumentAt(store: ContentStore, permalink: string): Document | undefined {
  const document = store.getByPermalink(permalink);
  if (document === undefined) return undefined;
  const reason = hiddenReason(document, store.now());
  return reason === undefined || reason.kind === 'trashed' ? undefined : document;
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
  if (document.type !== 'post' || !isServed(document)) return undefined;
  return postObjectId(document, baseUrl);
}

/**
 * The permalink an object id names, when it is one this site would have
 * minted: the path, with the base URL's own directory taken off it.
 *
 * An id from another host belongs to no post here however it is spelled, and
 * neither does one carrying a query string — a permalink has none, so an id
 * like `?p=813` is a stored one and is looked up as one instead.
 */
export function permalinkOfObjectId(objectId: string, baseUrl: string): string | undefined {
  let url: URL;
  let base: URL;
  try {
    url = new URL(objectId);
    base = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== base.origin || url.search !== '') return undefined;

  const directory = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');
  if (directory !== '' && !url.pathname.startsWith(`${directory}/`)) return undefined;

  const pathname = url.pathname.slice(directory.length);
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}
