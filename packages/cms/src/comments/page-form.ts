import type { Document } from '../content/document.ts';
import type { AdminStore } from '../store/admin-store.ts';
import { visibleReply } from './conversation.ts';
import type { Conversation } from './conversation.ts';
import { COMMENT_NOTICES, commentForm, signedInCommentForm } from './form.ts';
import type { CommentFormContext, CommentViewer } from './form.ts';
import { commentPolicyOf, commentsOpen } from './policy.ts';

/**
 * The same form drawn for whoever is filling it in: the short one when the
 * site knows them, and the stranger's one when it does not.
 */
export function drawnFor(
  form: CommentFormContext,
  viewer: CommentViewer | undefined,
): CommentFormContext {
  return viewer === undefined ? form : signedInCommentForm(form, viewer);
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
 * a comment waiting for a moderator cannot be discovered by guessing. With the
 * post's `thread`, which is handed over for somebody signed in, any
 * entry a reader can see is answerable: a webmention, a fediverse reply or a
 * reply post as well as a comment.
 */
export function commentReplyTarget(options: {
  admin: AdminStore;
  document: Document;
  id: string | undefined;
  thread?: Conversation | undefined;
}): Record<string, unknown> {
  if (options.id === undefined || options.id === '') return {};

  if (options.thread !== undefined) {
    const reply = visibleReply(options.thread.replies, options.id);
    return reply === undefined
      ? {}
      : { commentReplyTo: reply.key, commentReplyingTo: reply.author.name };
  }

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
  /** Who the request's session says is reading, when it says anybody. */
  viewer?: CommentViewer | undefined;
}): CommentFormContext | undefined {
  if (!commentsOpen(options.document, commentPolicyOf(options.site), options.now)) return undefined;

  const form = commentForm(options.document, options.now, options.notifiable ?? false);
  return drawnFor(form, options.viewer);
}
