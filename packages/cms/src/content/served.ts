import type { Document } from './document.ts';
import { scheduledFor } from './schedule.ts';
import { isTrashedPath } from './store.ts';
import { visibilityOf } from './visibility.ts';
import { systemClock } from '../util/clock.ts';

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
 * rather than deriving the rule again. A caller with a store passes
 * `IndexClock.now` so the answer matches the listings it came from.
 */
export function hiddenReason(document: Document, now: Date): HiddenReason | undefined {
  if (isTrashedPath(document.path)) return { kind: 'trashed' };
  return withheldReason(document, now);
}

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

export function isServed(document: Document, now: Date = systemClock()): boolean {
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
export function isGone(document: Document, now: Date): boolean {
  return isTrashedPath(document.path) && withheldReason(document, now) === undefined;
}

/**
 * Whether the site lists a document: served, and not unlisted (TASK-227).
 *
 * What every list the site publishes asks — the listings, the feeds, the
 * sitemap, search, `llms.txt`, IndexNow — about a document in hand. The
 * index's listing queries answer the same rule in SQL.
 */
export function isListed(document: Document, now: Date = systemClock()): boolean {
  return isServed(document, now) && visibilityOf(document) === 'public';
}

/**
 * Whether a document is one of the objects this site federates.
 *
 * doc-4 federates published posts and nothing else: pages are standing
 * content with no place in a timeline, and a draft, a trashed post or one
 * whose date has not arrived is not public at all. This is the one rule, so
 * the object dispatcher, the outbox and the permalink all agree about what
 * exists.
 */
export function isFederatedDocument(document: Document, now: Date): boolean {
  return document.type === 'post' && isServed(document, now);
}
