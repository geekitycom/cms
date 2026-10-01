import type { Document } from './document.ts';
import { toUtcInstant } from './time.ts';

/**
 * The front matter key that pins a post to the top of its author's profile
 * (TASK-207): `pinned: <ISO instant>`, written when the author pinned it.
 *
 * An instant rather than `true`, so the order the fediverse shows pins in
 * (most recently pinned first, as Mastodon does) lives in the file with the
 * pin itself (decision-9) instead of in an index that a rebuild would lose.
 */
export const PINNED_FRONT_MATTER_KEY = 'pinned';

/** How many posts one author can pin, which is Mastodon's own limit. */
export const PINNED_POST_LIMIT = 5;

/**
 * When a post was pinned, as a UTC instant, or `undefined` for one that is not.
 *
 * YAML hands back an unquoted timestamp as a `Date` and a quoted one as a
 * string; both are read. A hand-written `pinned: true` has no moment of its
 * own, so it reads as the post's date and sorts among the others by that.
 */
export function pinnedAt(document: Document): string | undefined {
  const value = document.extra[PINNED_FRONT_MATTER_KEY];
  if (value === true) return document.date ?? '';
  if (typeof value !== 'string' && !(value instanceof Date)) return undefined;
  return toUtcInstant(value, 'UTC');
}

/**
 * The pinned ones among some posts, most recently pinned first and no more
 * than {@link PINNED_POST_LIMIT} of them: an author's featured collection.
 */
export function featuredPosts(documents: readonly Document[]): Document[] {
  return documents
    .flatMap((document) => {
      const at = pinnedAt(document);
      return at === undefined ? [] : [{ document, at }];
    })
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, PINNED_POST_LIMIT)
    .map(({ document }) => document);
}
