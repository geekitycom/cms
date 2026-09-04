import type { Document } from '../content/document.ts';

/**
 * When a post is taking comments, and when it has stopped.
 *
 * WordPress spells this as three things that argue with each other — a site
 * switch, an age, and a per-post override — and so does this. They are read in
 * one place so the form under a post and the endpoint that refuses a
 * submission can never disagree about whether a post is open, which is the
 * only way a comment form can lie to somebody who has just typed a paragraph.
 */

/** The front-matter key a post opens or closes its own comments with. */
export const COMMENTS_FRONT_MATTER_KEY = 'comments';

/**
 * How long a post takes comments for, in days, before this is decided
 * otherwise. WordPress's own default, and the age at which a post stops being
 * a conversation and starts being a spam target.
 */
export const DEFAULT_COMMENTS_CLOSE_AFTER_DAYS = 14;

/** The site's half of the decision: the two settings that apply to every post. */
export interface CommentPolicy {
  /** Whether the site takes comments at all. Off means off everywhere. */
  enabled: boolean;
  /** Days after a post's `date` that it stops taking them. Zero never closes. */
  closeAfterDays: number;
}

/**
 * Whether this document is taking native comments right now.
 *
 * The order is what the rules mean rather than what is cheapest to check:
 *
 * - The site switch is absolute. A site that has turned comments off has
 *   turned them off, and no post reopens itself past it.
 * - A draft or a trashed document takes none either. Nobody can read it to
 *   comment on, so a form would only be a way of writing to a post that does
 *   not exist yet.
 * - `comments: true` or `comments: false` in the front matter is the post's
 *   own answer and beats everything below it, in both directions.
 * - A page is closed. A page is standing content — an about page, a colophon —
 *   and WordPress defaults them closed for the same reason.
 * - Otherwise a post is open until it is `closeAfterDays` old, counted from
 *   its `date`. A post with no date has no age and stays open.
 *
 * None of this touches the fediverse. A reply, a like or a boost arrives
 * because a remote server sent it, which nothing here can stop and nothing
 * here should hide: a closed post still shows every one of them.
 */
export function commentsOpen(
  document: Document,
  policy: CommentPolicy,
  now: Date = new Date(),
): boolean {
  if (!policy.enabled) return false;
  if (document.draft) return false;

  const own = document.extra[COMMENTS_FRONT_MATTER_KEY];
  if (own === false) return false;
  if (own === true) return true;

  if (document.type !== 'post') return false;
  if (policy.closeAfterDays <= 0) return true;
  if (document.date === undefined) return true;

  const published = new Date(document.date);
  if (Number.isNaN(published.getTime())) return true;

  const closesAt = published.getTime() + policy.closeAfterDays * DAY_MS;
  return now.getTime() < closesAt;
}

/** A day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The site's comment policy, as `content/_data/site.json` says it.
 *
 * Read off the site data rather than the typed settings so the public site can
 * ask without reaching into the admin: the two keys are ordinary keys of that
 * file, and a site that has never saved its settings gets the defaults —
 * comments on, closing after a fortnight.
 */
export function commentPolicyOf(site: Record<string, unknown>): CommentPolicy {
  const closeAfterDays = Number(site['commentsCloseAfterDays']);

  return {
    enabled: site['comments'] !== false,
    closeAfterDays:
      Number.isInteger(closeAfterDays) && closeAfterDays >= 0
        ? closeAfterDays
        : DEFAULT_COMMENTS_CLOSE_AFTER_DAYS,
  };
}
