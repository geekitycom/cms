import { COMMENTS_FRONT_MATTER_KEY } from '../content/comments.ts';
import type { Document, DocumentType } from '../content/document.ts';
import { DEFAULT_COMMENTS_CLOSE_AFTER_DAYS } from '../site/settings.ts';

/**
 * When a post or a page is taking comments, and when it has stopped.
 *
 * WordPress spells this as things that argue with each other — a site switch,
 * a default per type, an age, and a per-document override — and so does this.
 * They are read in one place so the form under a document, the endpoint that
 * refuses a submission and the editor's "Follow the site settings" can never
 * disagree about whether it is open, which is the only way a comment form can
 * lie to somebody who has just typed a paragraph.
 *
 * Only the form and the endpoint ask. What was already said is shown under
 * every document, open or closed.
 */

/** The site's half of the decision: the settings that apply to every document. */
export interface CommentPolicy {
  /** Whether the site takes comments at all. Off means off everywhere. */
  enabled: boolean;
  /** Days after a document's `date` that it stops taking them. Zero never closes. */
  closeAfterDays: number;
  /** Whether a document of each type takes comments when its front matter does not say. */
  openByDefault: Readonly<Record<DocumentType, boolean>>;
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
 * - A type the Discussion settings leave unticked is closed. Pages are, unless
 *   the site says otherwise: standing content, closed by default in WordPress
 *   for the same reason.
 * - Otherwise the document is open until it is `closeAfterDays` old, counted
 *   from its `date`. One with no date has no age and stays open.
 *
 * None of this touches the fediverse. A reply, a like or a boost arrives
 * because a remote server sent it, which nothing here can stop and nothing
 * here should hide: a closed document still shows every one of them.
 */
export function commentsOpen(document: Document, policy: CommentPolicy, now: Date): boolean {
  if (!policy.enabled) return false;
  if (document.draft) return false;

  const own = document.extra[COMMENTS_FRONT_MATTER_KEY];
  if (own === false) return false;
  if (own === true) return true;

  if (!policy.openByDefault[document.type]) return false;
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
 * ask without reaching into the admin: the keys are ordinary keys of that
 * file, and a site that has never saved its settings gets the defaults —
 * comments on, posts open and pages closed, closing after a fortnight.
 */
export function commentPolicyOf(site: Record<string, unknown>): CommentPolicy {
  const closeAfterDays = Number(site['commentsCloseAfterDays']);

  return {
    enabled: site['comments'] !== false,
    closeAfterDays:
      Number.isInteger(closeAfterDays) && closeAfterDays >= 0
        ? closeAfterDays
        : DEFAULT_COMMENTS_CLOSE_AFTER_DAYS,
    openByDefault: {
      post: site['commentsOnPosts'] !== false,
      page: site['commentsOnPages'] === true,
    },
  };
}
