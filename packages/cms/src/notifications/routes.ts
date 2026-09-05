import type { Context, Hono } from 'hono';

import { isModerationAction, moderateComment } from '../comments/moderate.ts';
import type { ModerationAction } from '../comments/moderate.ts';
import type { GeekityEnv } from '../env.ts';
import {
  MODERATE_PATH,
  NOTIFICATION_FIELDS,
  UNSUBSCRIBE_ACTION,
  UNSUBSCRIBE_PATH,
} from './links.ts';
import { addCommentOptOut, hasOptedOut } from './optouts.ts';
import { notificationTokenExpiry, readNotificationToken } from './tokens.ts';

/**
 * Where the links in a notification land.
 *
 * Two endpoints under `/_geekity/`, and neither has a session behind it: the
 * token in the URL is the whole of the authority, which is the point — a
 * moderator reading mail on a phone should not have to sign in to approve a
 * comment, and somebody unsubscribing has no account to sign in to.
 *
 * **Opening a link does nothing.** Every link lands on a page with a button on
 * it, and only pressing the button acts. That is not politeness: mail readers,
 * spam filters and link-safety scanners fetch the URLs in a message as a
 * matter of course, and a GET that moderated would mean a corporate mail
 * gateway silently deleting this site's comments. The button posts the same
 * token back, and there is no CSRF field on it because there is no session to
 * confuse — anybody who could make a browser post this form already has the
 * token, which is everything.
 *
 * **A moderation link works once.** The token's signature is checked, and then
 * it is spent against the cache before anything is written, so a link forwarded
 * to somebody else is a link that has already been used. An unsubscribe link is
 * deliberately not spent: clicking it a second time should say "you are
 * unsubscribed", not "that link is dead".
 */

/** Register both landing pages. Mounted by the public site. */
export function mountNotificationLinks(app: Hono<GeekityEnv>): void {
  app.get(MODERATE_PATH, async (c) => await moderationLanding(c, false));
  app.post(MODERATE_PATH, async (c) => await moderationLanding(c, true));

  app.get(UNSUBSCRIBE_PATH, async (c) => await unsubscribeLanding(c, false));
  app.post(UNSUBSCRIBE_PATH, async (c) => await unsubscribeLanding(c, true));
}

/** The moderation link: the confirm page, and the thing it confirms. */
async function moderationLanding(c: Context<GeekityEnv>, act: boolean): Promise<Response> {
  const { config, admin } = c.var;
  const submitted = act ? await c.req.parseBody() : {};
  const token = act ? field(submitted[NOTIFICATION_FIELDS.token]) : (c.req.query('token') ?? '');
  const named = act ? field(submitted[NOTIFICATION_FIELDS.action]) : (c.req.query('action') ?? '');

  const claim = readNotificationToken(config.dataDir, token, config.now());
  // The named action has to be the signed one. It is in the query so a person
  // can read what a link does; if the two disagree, the link has been edited.
  if (claim === undefined || claim.action !== named || !isModerationAction(claim.action)) {
    return refuse(c, 'This link is no longer valid. Sign in to the Comments screen instead.');
  }

  const action: ModerationAction = claim.action;
  const comment = admin.getComment(claim.subject);

  if (!act) {
    if (comment === undefined) return done(c, 'That comment is not here any more.');
    return confirm(c, {
      action,
      token,
      heading: `${verb(action)} this comment?`,
      author: comment.author.name,
      html: comment.content.html,
      button: verb(action),
    });
  }

  // Spent before anything is written, so two clicks cannot both act, and a
  // forwarded link is a link that has already been used.
  const expiry = notificationTokenExpiry(config.dataDir, token);
  if (expiry === undefined || !admin.spendToken(token, expiry, config.now())) {
    return done(c, 'That link has already been used. Sign in to the Comments screen instead.');
  }
  // A good moment to sweep: this is the one handler that writes such a row.
  admin.pruneSpentTokens(config.now());

  const outcome = await moderateComment({
    records: { admin, contentDir: config.contentDir },
    id: claim.subject,
    action,
    checker: config.commentChecker,
    baseUrl: config.baseUrl,
  });

  if (outcome.kind === 'gone') return done(c, 'That comment is not here any more.');
  if (outcome.kind === 'unchanged') {
    return done(c, `${outcome.comment.author.name}’s comment was already ${was(action)}.`);
  }

  // A newly approved reply is what somebody upthread asked to hear about.
  if (outcome.kind === 'moved' && outcome.comment.status === 'approved') {
    c.var.notifications.replyApproved(outcome.comment);
  }

  return done(c, `${outcome.comment.author.name}’s comment has been ${was(action)}.`);
}

/** The unsubscribe link: the confirm page, and the thing it confirms. */
async function unsubscribeLanding(c: Context<GeekityEnv>, act: boolean): Promise<Response> {
  const { config } = c.var;
  const submitted = act ? await c.req.parseBody() : {};
  const token = act ? field(submitted[NOTIFICATION_FIELDS.token]) : (c.req.query('token') ?? '');

  const claim = readNotificationToken(config.dataDir, token, config.now());
  if (claim === undefined || claim.action !== UNSUBSCRIBE_ACTION) {
    return refuse(c, 'This link is no longer valid.');
  }

  if (!act) {
    if (hasOptedOut(config.dataDir, claim.subject)) {
      return done(c, `${claim.subject} is not being emailed about replies.`);
    }
    return confirm(c, {
      action: UNSUBSCRIBE_ACTION,
      token,
      heading: 'Stop emailing you about replies?',
      author: claim.subject,
      html: `<p>Nothing more will be sent to ${escapeHtml(claim.subject)} about replies to comments on this site. Your comments stay where they are.</p>`,
      button: 'Unsubscribe',
    });
  }

  await addCommentOptOut(config.dataDir, claim.subject);
  return done(c, `${claim.subject} will not be emailed about replies again.`);
}

/** The verb a button and a heading use for one action. */
function verb(action: ModerationAction): string {
  return action === 'approve' ? 'Approve' : action === 'spam' ? 'Mark as spam' : 'Delete';
}

/** What that action left behind, as a sentence says it. */
function was(action: ModerationAction): string {
  return action === 'approve' ? 'approved' : action === 'spam' ? 'filed as spam' : 'deleted';
}

/** The page a link lands on: what it would do, and a button that does it. */
function confirm(
  c: Context<GeekityEnv>,
  options: {
    action: string;
    token: string;
    heading: string;
    author: string;
    html: string;
    button: string;
  },
): Response {
  return c.html(
    page(
      options.heading,
      `<h1>${escapeHtml(options.heading)}</h1>
      <p class="who">${escapeHtml(options.author)}</p>
      <blockquote>${options.html}</blockquote>
      <form method="post">
        <input type="hidden" name="${NOTIFICATION_FIELDS.action}" value="${escapeHtml(options.action)}" />
        <input type="hidden" name="${NOTIFICATION_FIELDS.token}" value="${escapeHtml(options.token)}" />
        <button type="submit">${escapeHtml(options.button)}</button>
      </form>`,
    ),
  );
}

/** The page a finished action leaves behind. */
function done(c: Context<GeekityEnv>, message: string): Response {
  return c.html(page(message, `<h1>${escapeHtml(message)}</h1>`));
}

/** The page a link that buys nothing lands on. */
function refuse(c: Context<GeekityEnv>, message: string): Response {
  c.status(400);
  return c.html(page(message, `<h1>${escapeHtml(message)}</h1>`));
}

/**
 * One whole HTML document, built here rather than through the theme.
 *
 * These two pages are the CMS's own, like the health check: they are reached
 * from an email by somebody who may never have seen the site, they have to
 * work on a theme that has been half rewritten, and there is nothing about
 * them a theme would want to say. Deliberately one file, no assets and no
 * script, so nothing about them can fail to load.
 */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 2rem 1rem; max-width: 40rem; }
  h1 { font-size: 1.3rem; }
  .who { color: #555; margin: 0 0 .5rem; }
  blockquote { border-left: 3px solid #ccc; margin: 0 0 1.5rem; padding: 0 0 0 1rem; }
  button { font: inherit; padding: .5rem 1rem; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** Text as it may safely be printed into the page. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function field(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
