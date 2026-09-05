import type { Context, Hono } from 'hono';

import type { AdminStore } from '../admin/store.ts';
import { clientAddress, createLoginThrottle } from '../admin/throttle.ts';
import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import type { GeekityEnv } from '../env.ts';
import { isPublicDocument } from '../web/documents.ts';
import {
  COMMENT_NOTICE_PARAM,
  COMMENT_NOTICES,
  COMMENT_POST_PATH,
  commentForm,
  refilledCommentForm,
  valuesOf,
} from './form.ts';
import type { CommentFormContext } from './form.ts';
import { commentPolicyOf, commentsOpen } from './policy.ts';
import { commentAnchor } from './conversation.ts';
import {
  COMMENT_FIELDS,
  COMMENT_RATE_LIMIT,
  COMMENT_RATE_WINDOW_SECONDS,
  submitComment,
} from './submission.ts';
import type { CommentForm, CommentThrottle } from './submission.ts';

/**
 * The one public endpoint comments add: where the form under a post posts to.
 *
 * It is a single path rather than one per post because the post is a field of
 * the form. That keeps it out of the way of every permalink a site might ever
 * mint — a path under `/_geekity/` is the CMS's own, like the health check —
 * and means the route table does not grow with the site.
 *
 * Everything it answers is either a redirect or the post's own page rendered
 * again with the form still filled in. There is no JSON, no fragment and no
 * script: a comment form has worked without JavaScript since 2003 and there is
 * no reason for this one to stop.
 */

export { COMMENT_POST_PATH, COMMENT_REPLY_PARAM } from './form.ts';

/** Register the comment endpoint. Mounted by the public site. */
export function mountComments(app: Hono<GeekityEnv>): void {
  // One limiter for the whole mount, built on the first submission because the
  // clock is on the context. It holds nothing but recent submissions, so it
  // belongs to the process rather than the database: a restart clears it,
  // which is the right trade for state an anonymous caller can create.
  let limiter: CommentThrottle | undefined;

  function throttle(config: ResolvedConfig): CommentThrottle {
    limiter ??= createLoginThrottle({
      attempts: COMMENT_RATE_LIMIT,
      lockoutSeconds: COMMENT_RATE_WINDOW_SECONDS,
      now: config.now,
    });
    return limiter;
  }

  app.post(COMMENT_POST_PATH, async (c) => {
    const { store, admin, renderer, config } = c.var;
    const body = await c.req.parseBody();
    const form = formOf(body);

    const document = store.getBySlug(form.post);
    if (document === undefined || !isPublicDocument(document, store.now())) {
      return c.text('There is no such post to comment on.', 404);
    }

    const now = config.now();
    if (!commentsOpen(document, commentPolicyOf(renderer.site()), now)) {
      // 403 rather than 404: the post is there, and the reader can see for
      // themselves that it is. Saying so is more honest than pretending the
      // URL is wrong, and a closed post is a state rather than a mistake.
      return page(c, document, 403, {
        ...refilledCommentForm(document, valuesOf(form), {}, now),
        error: 'This post is not taking comments any more.',
      });
    }

    const outcome = await submitComment({
      records: { admin, contentDir: config.contentDir },
      document,
      form,
      dataDir: config.dataDir,
      baseUrl: config.baseUrl,
      checker: config.commentChecker,
      address: clientAddress(c, config),
      userAgent: c.req.header('user-agent'),
      referrer: c.req.header('referer'),
      throttle: throttle(config),
      // Whether the box on the form meant anything, read per submission so a
      // credential saved a moment ago is honoured now (TASK-55).
      notifiable: c.var.mail.configured(),
      now,
    });

    if (outcome.kind === 'stored') {
      const stored = outcome.comment;
      // Whoever moderates this site hears that something is waiting, and, when
      // the site let it straight through, whoever it answers hears about it.
      // Neither is awaited: the reader is redirected now and the messages go
      // out behind them (TASK-55).
      c.var.notifications.pending(stored);
      c.var.notifications.replyApproved(stored);
      // A redirect rather than a rendered page, so a refresh does not post the
      // comment a second time. An approved comment is on the page already, so
      // the reader is sent to it; one waiting for a moderator has nothing to
      // point at, so the reader is sent to the form they just used.
      const anchor = stored.status === 'approved' ? commentAnchor(stored.id) : 'respond';
      const notice = stored.status === 'approved' ? 'posted' : 'pending';
      return c.redirect(`${document.permalink}?${COMMENT_NOTICE_PARAM}=${notice}#${anchor}`, 303);
    }

    const refusal = outcome.refusal;
    if (refusal.kind === 'discarded') {
      // Nothing is said about why. A robot that filled the honeypot, or that a
      // checker recognised, learns exactly as much from this as from a
      // successful post — which is the point of both defences.
      return c.redirect(`${document.permalink}?${COMMENT_NOTICE_PARAM}=pending#respond`, 303);
    }

    if (refusal.kind === 'rate-limited') {
      c.header('Retry-After', String(refusal.retryAfter));
      return page(c, document, 429, {
        ...refilledCommentForm(document, valuesOf(form), {}, now),
        error: 'That is a lot of comments in a short time. Try again in a few minutes.',
      });
    }

    const message =
      refusal.kind === 'too-quick'
        ? 'That was posted faster than anybody types. Try again.'
        : refusal.kind === 'stale'
          ? 'That form had been open a long time. Here it is again — the words are still there.'
          : undefined;

    return page(c, document, 400, {
      ...refilledCommentForm(document, valuesOf(form), problemsOf(refusal), now),
      ...(message === undefined ? {} : { error: message }),
    });
  });
}

/** The statuses a refused submission is answered with. */
type RefusalStatus = 400 | 403 | 429;

/** The post's own page, rendered again with this form on it. */
function page(
  c: Context<GeekityEnv>,
  document: Document,
  status: RefusalStatus,
  form: CommentFormContext,
): Response {
  c.status(status);
  return c.html(c.var.renderer.renderDocument(document, { commentForm: form }));
}

/** The per-field messages a refusal carries, if it carries any. */
function problemsOf(refusal: { kind: string; problems?: unknown }): Record<string, string> {
  return refusal.kind === 'invalid' ? ((refusal.problems ?? {}) as Record<string, string>) : {};
}

/**
 * The thank-you a reader is shown after posting, from the query the redirect
 * carried, or `undefined` when the URL says nothing.
 *
 * A query rather than a flash message, because a reader has no session to hang
 * one on, and because a comment form that only works for people with cookies
 * is not a comment form.
 */
export function commentNoticeFor(query: string | undefined): string | undefined {
  return query === undefined ? undefined : COMMENT_NOTICES[query];
}

/**
 * The comment a `?reply_to=` query points at, as the theme needs it, or an
 * empty object when the query names nothing on this post.
 *
 * Checked against the index rather than trusted, so a made-up id — or one from
 * another page — cannot put a stranger's name on somebody's reply form, and so
 * a comment waiting for a moderator cannot be discovered by guessing.
 */
export function commentReplyTarget(options: {
  admin: AdminStore;
  document: Document;
  id: string | undefined;
}): Record<string, unknown> {
  if (options.id === undefined || options.id === '') return {};

  const parent = options.admin.getComment(options.id);
  if (parent === undefined || parent.slug !== options.document.slug) return {};
  if (parent.status !== 'approved') return {};

  return { commentReplyTo: parent.id, commentReplyingTo: parent.author.name };
}

/**
 * The form for a post, or `undefined` when it is not taking comments.
 *
 * What the renderer is handed at boot. It reads the settings and the clock on
 * every render, so a post that closed an hour ago stops offering a form on the
 * very next request.
 */
export function commentFormFor(options: {
  document: Document;
  site: Record<string, unknown>;
  now: Date;
  /** Whether the site can send mail, which is whether the box is offered. */
  notifiable?: boolean | undefined;
}): CommentFormContext | undefined {
  if (!commentsOpen(options.document, commentPolicyOf(options.site), options.now)) return undefined;
  return commentForm(options.document, options.now, options.notifiable ?? false);
}

/** A submitted body as the form it is, every field a string. */
function formOf(body: Record<string, unknown>): CommentForm {
  return {
    post: text(body[COMMENT_FIELDS.post]),
    name: text(body[COMMENT_FIELDS.name]),
    email: text(body[COMMENT_FIELDS.email]),
    url: text(body[COMMENT_FIELDS.url]),
    body: text(body[COMMENT_FIELDS.body]),
    inReplyTo: text(body[COMMENT_FIELDS.inReplyTo]),
    trap: text(body[COMMENT_FIELDS.trap]),
    loaded: text(body[COMMENT_FIELDS.loaded]),
    notify: text(body[COMMENT_FIELDS.notify]),
  };
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
