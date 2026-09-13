import type { Context, Hono } from 'hono';

import { renderCommentMarkdown } from '../comments/markdown.ts';
import { isModerationAction, moderateComment } from '../comments/moderate.ts';
import { intakeComment } from '../comments/records.ts';
import type { CommentRecords } from '../comments/records.ts';
import type { GeekityEnv } from '../env.ts';
import { editorPath, PAGE_KIND, POST_KIND } from './documents.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { findUserById } from './accounts.ts';
import { formatInTimezone } from './formatting.ts';
import { readSiteSettings } from './settings.ts';
import { ADMIN_PREFIX } from './session.ts';
import { COMMENT_STATUSES } from './store.ts';
import type { AdminStore, CommentStatus, PostComment } from './store.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/**
 * The moderation queue: what people have left on the site, and the four things
 * that can be done about it.
 *
 * There is no email in this milestone, so this screen is the notification —
 * which is why the dashboard carries the pending count and why the default
 * list is the pending one. Every action rewrites the comment's file first and
 * the index inside the same step, exactly as the form on the public site does:
 * the file is the comment (decision-9), and this screen only ever moves it.
 *
 * The two reclassifications are also the only training a spam checker gets, so
 * they are where {@link CommentChecker.reportSpam} and
 * {@link CommentChecker.reportHam} are called from. A checker that has no
 * opinion about being corrected simply does not implement them.
 */

/** Where the comments screen lives. */
export const COMMENTS_PATH = `${ADMIN_PREFIX}/comments`;

/** The navigation section it marks as current. */
export const COMMENTS_SECTION = 'comments';

/** Where the row buttons post. */
export const COMMENTS_MODERATE_PATH = `${COMMENTS_PATH}/moderate`;

/** Where the reply form posts. */
export const COMMENTS_REPLY_PATH = `${COMMENTS_PATH}/reply`;

/** The fields the forms on this screen submit. */
export const COMMENT_ADMIN_FIELDS = {
  /** Which comment a button is about. */
  id: 'id',
  /** Which button was pressed: one of {@link COMMENT_ACTIONS}. */
  action: 'action',
  /** The reply's own text, on the reply form. */
  body: 'body',
  /** Which list to go back to afterwards. */
  status: 'status',
} as const;

/** What a row's buttons can do. */
export const COMMENT_ACTIONS = ['approve', 'spam', 'delete'] as const;

/** One of {@link COMMENT_ACTIONS}. */
export type CommentAction = (typeof COMMENT_ACTIONS)[number];

/** How many comments one page of the queue shows. */
export const COMMENTS_PER_PAGE = 25;

/** The three lists, in the order the screen offers them. */
export const COMMENT_TABS: readonly { status: CommentStatus; label: string }[] = [
  { status: 'pending', label: 'Pending' },
  { status: 'approved', label: 'Approved' },
  { status: 'spam', label: 'Spam' },
];

/** One comment as the screen shows it. */
export interface CommentRow {
  /** Its id, which the buttons carry. */
  id: string;
  /** Where it stands. */
  status: CommentStatus;
  /** Where it came from: the form, or a webmention. */
  source: string;
  /** The name the commenter gave. */
  author: string;
  /** Their website, or `null`. */
  url: string | null;
  /** Their email, which only this screen ever shows. */
  email: string | null;
  /** What it says, already rendered and safe to print. */
  html: string;
  /** When it arrived, in the site's own time zone. */
  submitted: string;
  /** A short form of the address hash, for spotting one machine's run of them. */
  address: string | null;
  /** The post's title, or its slug when the post is not in the index. */
  post: string;
  /** Where the post can be read, or `null` when it is not published. */
  postUrl: string | null;
  /** Where the post can be edited, or `null` when the index has lost it. */
  editUrl: string | null;
  /** The comment this one answers, if any, so a thread reads as one. */
  inReplyTo: string | null;
}

/** What {@link mountCommentsScreen} needs from the admin around it. */
export interface MountCommentsScreenOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/** Register the moderation screen. */
export function mountCommentsScreen(
  app: Hono<GeekityEnv>,
  options: MountCommentsScreenOptions,
): void {
  const { render } = options;

  app.get(COMMENTS_PATH, (c) => {
    const status = statusOf(c.req.query('status'));
    const page = Math.max(1, Math.trunc(Number(c.req.query('page') ?? '1')) || 1);
    const counts = c.var.admin.countCommentsByStatus();
    const rows = c.var.admin
      .listComments({
        status,
        limit: COMMENTS_PER_PAGE,
        offset: (page - 1) * COMMENTS_PER_PAGE,
      })
      .map((comment) => commentRow(c, comment));

    const pages = Math.max(1, Math.ceil(counts[status] / COMMENTS_PER_PAGE));

    return render(c, ADMIN_TEMPLATES.comments, {
      section: COMMENTS_SECTION,
      child: 'all',
      heading: 'Comments',
      status,
      counts,
      tabs: COMMENT_TABS.map((tab) => ({
        ...tab,
        url: listUrl(tab.status),
        count: counts[tab.status],
        current: tab.status === status,
      })),
      rows,
      fields: COMMENT_ADMIN_FIELDS,
      moderateUrl: COMMENTS_MODERATE_PATH,
      replyUrl: COMMENTS_REPLY_PATH,
      page,
      pages,
      previousUrl: page > 1 ? listUrl(status, page - 1) : undefined,
      nextUrl: page < pages ? listUrl(status, page + 1) : undefined,
    });
  });

  app.post(COMMENTS_MODERATE_PATH, async (c) => {
    const body = await c.req.parseBody();
    const back = listUrl(statusOf(text(body[COMMENT_ADMIN_FIELDS.status])));
    const comment = c.var.admin.getComment(text(body[COMMENT_ADMIN_FIELDS.id]));
    if (comment === undefined) {
      flash(c, 'error', 'That comment is not here any more.');
      return c.redirect(back, 303);
    }

    const action = text(body[COMMENT_ADMIN_FIELDS.action]);
    if (!isModerationAction(action)) {
      flash(c, 'error', 'That is not something a comment can be.');
      return c.redirect(back, 303);
    }

    // The same function the one-click links in a notification call, so the two
    // doors onto moderation can never disagree about what an action does or
    // about when the spam checker is told (TASK-55).
    const outcome = await moderateComment({
      records: recordsOf(c),
      id: comment.id,
      action,
      checker: c.var.config.commentChecker,
      baseUrl: c.var.config.baseUrl,
    });

    if (outcome.kind === 'gone') {
      flash(c, 'error', 'That comment is not here any more.');
      return c.redirect(back, 303);
    }

    if (outcome.kind === 'unchanged') {
      flash(c, 'notice', `That comment is already ${outcome.comment.status}.`);
      return c.redirect(back, 303);
    }

    // A reply nobody had approved is now on the page, so whoever it answers
    // hears about it, if they asked to.
    if (outcome.kind === 'moved' && outcome.comment.status === 'approved') {
      c.var.notifications.replyApproved(outcome.comment);
    }

    flash(
      c,
      'notice',
      action === 'delete'
        ? `Deleted ${comment.author.name}’s comment.`
        : action === 'approve'
          ? `Approved ${comment.author.name}’s comment.`
          : `Filed ${comment.author.name}’s comment as spam.`,
    );
    return c.redirect(back, 303);
  });

  app.post(COMMENTS_REPLY_PATH, async (c) => {
    const body = await c.req.parseBody();
    const back = listUrl(statusOf(text(body[COMMENT_ADMIN_FIELDS.status])));
    const parent = c.var.admin.getComment(text(body[COMMENT_ADMIN_FIELDS.id]));
    if (parent === undefined) {
      flash(c, 'error', 'That comment is not here any more.');
      return c.redirect(back, 303);
    }

    const markdown = text(body[COMMENT_ADMIN_FIELDS.body]).trim();
    if (markdown === '') {
      flash(c, 'error', 'A reply needs something in it.');
      return c.redirect(back, 303);
    }

    // The moderator's reply is a comment like any other, so it goes through
    // the same door as the form and the webmention endpoint. The intake
    // approves it — the person writing it is the person who would have
    // approved it — and tells whoever it answers, if they asked to be told
    // (TASK-55). It lands in the same file, under the comment it answers, so
    // the thread on the page reads as one conversation.
    await intakeComment({
      records: recordsOf(c),
      origin: 'moderator',
      comment: {
        slug: parent.slug,
        permalink: parent.permalink,
        source: 'comment',
        kind: 'reply',
        author: { name: moderatorName(c), url: null, email: null, avatar: null },
        content: { markdown, html: renderCommentMarkdown(markdown) },
        submitted: c.var.config.now().toISOString(),
        inReplyTo: parent.id,
        url: null,
        // A moderator writing from the admin is already reading the queue;
        // nothing here is going to email them about their own reply.
        notify: false,
      },
      // No address is recorded for a reply written in the admin: it came from
      // a signed-in person, and the hash exists to spot a run of anonymous
      // submissions rather than to log the owner of the site.
      dataDir: c.var.config.dataDir,
      baseUrl: c.var.config.baseUrl,
      notices: c.var.notifications,
    });

    flash(c, 'notice', `Replied to ${parent.author.name}.`);
    return c.redirect(back, 303);
  });
}

/** How many comments are waiting, which is the number on the dashboard. */
export function pendingComments(admin: AdminStore): number {
  return admin.countCommentsByStatus().pending;
}

/** Where one list of the queue lives. */
export function listUrl(status: CommentStatus, page = 1): string {
  const query = page > 1 ? `&page=${String(page)}` : '';
  return `${COMMENTS_PATH}?status=${status}${query}`;
}

/** A requested status, or the pending list for anything else. */
function statusOf(value: string | undefined): CommentStatus {
  return COMMENT_STATUSES.includes(value as CommentStatus) ? (value as CommentStatus) : 'pending';
}

/** The files and the index this request writes through. */
function recordsOf(c: Context<GeekityEnv>): CommentRecords {
  return { admin: c.var.admin, contentDir: c.var.config.contentDir };
}

/** One stored comment as the screen shows it. */
function commentRow(c: Context<GeekityEnv>, comment: PostComment): CommentRow {
  const document = c.var.store.getBySlug(comment.slug);
  const timezone = readSiteSettings(c.var.config.contentDir).timezone;

  return {
    id: comment.id,
    status: comment.status,
    source: comment.source,
    author: comment.author.name,
    url: comment.author.url,
    email: comment.author.email,
    html: comment.content.html,
    submitted: formatInTimezone(comment.submitted, timezone),
    // The first eight characters are enough to see that two comments came from
    // one place, which is the only question the hash is there to answer.
    address: comment.addressHash === null ? null : comment.addressHash.slice(0, 8),
    post: document?.title ?? comment.slug,
    postUrl: comment.permalink === '' ? null : comment.permalink,
    editUrl:
      document === undefined
        ? null
        : editorPath(document.type === 'page' ? PAGE_KIND : POST_KIND, document.slug),
    inReplyTo: comment.inReplyTo,
  };
}

/**
 * What a reply from the admin is signed with: the site's author when it names
 * one, else the login of whoever is signed in.
 *
 * A blog's replies to its own comments read as the blog, which is what the
 * `author` setting is for; the login is the fallback rather than the default
 * because it is an account name rather than a person's name.
 */
function moderatorName(c: Context<GeekityEnv>): string {
  const author = readSiteSettings(c.var.config.contentDir).author.trim();
  if (author !== '') return author;

  const userId = c.var.session?.userId;
  const user = userId == null ? undefined : findUserById(c.var.config.dataDir, userId);
  return user?.username ?? 'The author';
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
