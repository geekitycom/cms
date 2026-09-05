import type { ModerationAction } from '../comments/moderate.ts';
import { signNotificationToken } from './tokens.ts';

/**
 * The URLs a notification puts in front of somebody, and what they cost.
 *
 * Both live under `/_geekity/`, like the comment endpoint and the webmention
 * one, so no permalink a site ever mints can shadow them and the route table
 * does not grow with the site.
 *
 * Each carries two things: the token, which is the whole of its authority, and
 * a plain `action=` that says what it does. The action is in the token too and
 * the handler refuses a link whose two halves disagree — it is in the query so
 * that a person reading a wall of links in a message can see which is which,
 * and so that a browser's address bar says what is about to happen.
 */

/** Where a moderation link lands. */
export const MODERATE_PATH = '/_geekity/moderate';

/** Where an unsubscribe link lands. */
export const UNSUBSCRIBE_PATH = '/_geekity/unsubscribe';

/** The fields both landing pages read, from the query and from the form. */
export const NOTIFICATION_FIELDS = {
  /** The signed claim. */
  token: 'token',
  /** What the link says it does, checked against the token. */
  action: 'action',
} as const;

/** The one thing an unsubscribe token is for. */
export const UNSUBSCRIBE_ACTION = 'unsubscribe';

/**
 * How long a moderation link works for.
 *
 * A week. Long enough that a message read on Monday is still actionable on
 * Friday, short enough that a mailbox somebody stopped reading a year ago is
 * not a drawer of keys to this site's comment queue. After it, the link says
 * so and the moderation screen is one sign-in away.
 */
export const MODERATION_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long an unsubscribe link works for.
 *
 * A year, which is much longer, because the two links are asking opposite
 * questions. A stale moderation link is a small power somebody should not
 * still have; a stale unsubscribe link is a person who pressed Stop and was
 * told no. The second failure is worse, and the link grants nothing but the
 * right to be left alone.
 */
export const UNSUBSCRIBE_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

/** What every link builder needs: the secret's home and the site's origin. */
export interface LinkContext {
  /** Where the signing secret lives. */
  dataDir: string;
  /** The site's public origin; the link is read somewhere else, so it is absolute. */
  baseUrl: string;
  /** The clock. */
  now: Date;
}

/** The link that does one thing to one comment. */
export function moderationLink(
  context: LinkContext,
  commentId: string,
  action: ModerationAction,
): string {
  return linkTo(context, MODERATE_PATH, action, commentId, MODERATION_TOKEN_LIFETIME_SECONDS);
}

/** The link that stops this site writing to an address. */
export function unsubscribeLink(context: LinkContext, email: string): string {
  return linkTo(
    context,
    UNSUBSCRIBE_PATH,
    UNSUBSCRIBE_ACTION,
    email,
    UNSUBSCRIBE_TOKEN_LIFETIME_SECONDS,
  );
}

/** One signed link, absolute. */
function linkTo(
  context: LinkContext,
  pathname: string,
  action: string,
  subject: string,
  lifetimeSeconds: number,
): string {
  const base = context.baseUrl.endsWith('/') ? context.baseUrl : `${context.baseUrl}/`;
  const url = new URL(pathname, base);
  url.searchParams.set(NOTIFICATION_FIELDS.action, action);
  url.searchParams.set(
    NOTIFICATION_FIELDS.token,
    signNotificationToken(context.dataDir, { action, subject, lifetimeSeconds }, context.now),
  );
  return url.href;
}
