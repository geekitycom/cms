import type { Context, Hono } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import { isServed } from '../content/served.ts';
import { commentAnchor } from '../comments/conversation.ts';
import {
  COMMENT_NOTICE_PARAM,
  COMMENT_POST_PATH,
  refilledCommentForm,
  valuesOf,
} from '../comments/form.ts';
import type { CommentFormContext, CommentViewer } from '../comments/form.ts';
import { drawnFor } from '../comments/page-form.ts';
import { commentPolicyOf, commentsOpen } from '../comments/policy.ts';
import { submitReplyPost } from '../comments/reply-post.ts';
import {
  COMMENT_FIELDS,
  COMMENT_RATE_LIMIT,
  COMMENT_RATE_WINDOW_SECONDS,
  submitComment,
} from '../comments/submission.ts';
import type { CommentForm, CommentRefusal, CommentThrottle } from '../comments/submission.ts';
import { commenterOf } from '../comments/viewer.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { documentSite } from './document-site.ts';
import type { GeekityEnv } from './env.ts';
import { CROSS_SITE_REFUSAL, crossSiteWrite, csrfTokenMatches } from './session.ts';
import { clientAddress, createLoginThrottle } from './throttle.ts';

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
    // Who the session says this is, read before anything else is decided: it
    // settles the token, the attribution and where the comment lands.
    const account = c.var.signedIn;
    const viewer = account === undefined ? undefined : commenterOf(account);

    // A form that acts on nobody's behalf needs no token, and the public one
    // still carries none. This one posts under somebody's name, so without a
    // matching token a page on another site could make them say something they
    // never typed. Refused in the words and with the status the admin guard
    // uses, because it is the same check on the same token.
    //
    // Fetch Metadata first, as in the admin: a browser that says the form was
    // on another site is refused whatever token it carries. A stranger's form
    // is left alone, because it acts on nobody's behalf.
    if (viewer !== undefined && crossSiteWrite(c)) return c.text(CROSS_SITE_REFUSAL, 403);
    if (viewer !== undefined && !csrfTokenMatches(viewer.csrfToken, form.csrf)) {
      return c.text('That form was stale or came from somewhere else. Reload and try again.', 403);
    }

    const document = store.getBySlug(form.post);
    if (document === undefined || !isServed(document, store.now())) {
      return c.text('There is no such post to comment on.', 404);
    }

    const now = config.now();
    if (!commentsOpen(document, commentPolicyOf(renderer.site()), now)) {
      // 403 rather than 404: the post is there, and the reader can see for
      // themselves that it is. Saying so is more honest than pretending the
      // URL is wrong, and a closed post is a state rather than a mistake.
      return page(c, document, 403, viewer, {
        ...drawnFor(refilledCommentForm(document, valuesOf(form), {}, now), viewer),
        error: 'This post is not taking comments any more.',
      });
    }

    if (viewer !== undefined) {
      const answered = await submitReplyPost({
        site: documentSite(c, viewer.username),
        document,
        conversation: c.var.conversation.thread(document, c.var.siteAtRequestStart),
        form,
        throttle: throttle(config),
        address: clientAddress(c, config),
      });
      if (answered.kind === 'saved') {
        const reply = c.var.conversation.replyNamed(
          document,
          answered.saved.permalink,
          c.var.siteAtRequestStart,
        );
        const anchor = reply === undefined ? 'comments' : commentAnchor(reply.key);
        return c.redirect(`${document.permalink}?${COMMENT_NOTICE_PARAM}=posted#${anchor}`, 303);
      }
      return refusedPage(c, document, viewer, form, answered.refusal, now);
    }

    const outcome = await submitComment({
      records: { admin, contentDir: config.contentDir, dataDir: config.dataDir },
      document,
      cited: (url) => c.var.replyContexts.read(url, c.var.siteAtRequestStart),
      form,
      dataDir: config.dataDir,
      baseUrl: config.baseUrl,
      checker: config.commentChecker,
      // Who hears about what lands is the intake's to decide, and neither
      // message is awaited: the reader is redirected now and they go out
      // behind them (TASK-55).
      notices: c.var.notifications,
      address: clientAddress(c, config),
      userAgent: c.req.header('user-agent'),
      referrer: c.req.header('referer'),
      throttle: throttle(config),
      // Whether the box on the form meant anything, read per submission so a
      // credential saved a moment ago is honoured now (TASK-55).
      notifiable: c.var.mailConfigured,
      now,
    });

    if (outcome.kind === 'stored') {
      const stored = outcome.comment;
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
    return refusedPage(c, document, viewer, form, refusal, now);
  });
}

/** The post's page again, with the form refilled and what went wrong on it. */
function refusedPage(
  c: Context<GeekityEnv>,
  document: Document,
  viewer: CommentViewer | undefined,
  form: CommentForm,
  refusal: CommentRefusal,
  now: Date,
): Response {
  if (refusal.kind === 'rate-limited') {
    c.header('Retry-After', String(refusal.retryAfter));
    return page(c, document, 429, viewer, {
      ...drawnFor(refilledCommentForm(document, valuesOf(form), {}, now), viewer),
      error: 'That is a lot of comments in a short time. Try again in a few minutes.',
    });
  }

  const message =
    refusal.kind === 'too-quick'
      ? 'That was posted faster than anybody types. Try again.'
      : refusal.kind === 'stale'
        ? 'That form had been open a long time. Here it is again — the words are still there.'
        : undefined;

  return page(c, document, 400, viewer, {
    ...drawnFor(refilledCommentForm(document, valuesOf(form), problemsOf(refusal), now), viewer),
    ...(message === undefined ? {} : { error: message }),
  });
}

/** The statuses a refused submission is answered with. */
type RefusalStatus = 400 | 403 | 429;

function page(
  c: Context<GeekityEnv>,
  document: Document,
  status: RefusalStatus,
  viewer: CommentViewer | undefined,
  form: CommentFormContext,
): Response {
  c.status(status);
  return c.html(c.var.renderer.renderDocument(document, { commentForm: form }, viewer));
}

/** The per-field messages a refusal carries, if it carries any. */
function problemsOf(refusal: { kind: string; problems?: unknown }): Record<string, string> {
  return refusal.kind === 'invalid' ? ((refusal.problems ?? {}) as Record<string, string>) : {};
}

/** A submitted body as the form it is, every field a string. */
function formOf(body: Record<string, unknown>): CommentForm {
  return {
    post: stringOrEmpty(body[COMMENT_FIELDS.post]),
    name: stringOrEmpty(body[COMMENT_FIELDS.name]),
    email: stringOrEmpty(body[COMMENT_FIELDS.email]),
    url: stringOrEmpty(body[COMMENT_FIELDS.url]),
    body: stringOrEmpty(body[COMMENT_FIELDS.body]),
    inReplyTo: stringOrEmpty(body[COMMENT_FIELDS.inReplyTo]),
    trap: stringOrEmpty(body[COMMENT_FIELDS.trap]),
    loaded: stringOrEmpty(body[COMMENT_FIELDS.loaded]),
    notify: stringOrEmpty(body[COMMENT_FIELDS.notify]),
    csrf: stringOrEmpty(body[COMMENT_FIELDS.csrf]),
    listed: stringOrEmpty(body[COMMENT_FIELDS.listed]),
  };
}
