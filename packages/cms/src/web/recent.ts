import type { Document } from '../content/document.ts';
import type { ListOptions } from '../content/store.ts';

/**
 * What the front page shows under its words: the newest posts, by the rule the
 * andrewshell.org design uses (decision-16).
 *
 * The rule is "this month, unless this month is thin": a site that has been
 * writing shows what it has been writing about, and one that has not still
 * shows five posts rather than a short list or an empty box. It lives here,
 * beside its test, rather than inside the renderer, because it is a decision
 * about what is recent and not about how a page is drawn.
 */

/** How many posts the front page falls back to, and the month's threshold. */
export const RECENT_POSTS = 5;

/** What {@link recentPosts} asks: the archive, and what time it is. */
export interface RecentPostsSource {
  /** The clock the listings hold a future-dated post against. */
  now(): Date;
  /** Published posts, newest first. */
  listPosts(options?: ListOptions): Document[];
  /** Published posts dated at or after an instant, newest first. */
  listPostsSince(instant: string): Document[];
}

/**
 * The posts the front page lists: this month's when there are at least
 * {@link RECENT_POSTS} of them, and the newest {@link RECENT_POSTS} otherwise.
 *
 * Two bounded queries at worst and never a walk of the archive, which is why
 * the month is asked for first: on a site that writes often the answer is the
 * month and the second query never happens.
 */
export function recentPosts(source: RecentPostsSource): Document[] {
  const month = source.listPostsSince(startOfMonth(source.now()));
  return month.length >= RECENT_POSTS ? month : source.listPosts({ limit: RECENT_POSTS });
}

/**
 * Midnight on the first of the month an instant falls in, as the UTC instant
 * the index sorts by.
 *
 * UTC because that is what a date in a file means (decision-11): the site's
 * timezone setting decides how a date is printed and nothing else, so "this
 * month" is the month the stored instants are in rather than the one a reader
 * happens to be living through.
 */
export function startOfMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
