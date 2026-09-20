import type { Document } from '../content/document.ts';
import { COMMENT_FIELDS, MAXIMUM_BODY_LENGTH, MAXIMUM_NAME_LENGTH } from './submission.ts';
import type { CommentForm, CommentProblems } from './submission.ts';

/**
 * The comment form as a template receives it.
 *
 * The theme renders `partials/comment-form.njk` from this, and it is on the
 * context only when the post is actually taking comments — so a closed post
 * shows the thread with no form, and a layout asks `{% if commentForm %}`
 * rather than working out the rules for itself.
 */
export interface CommentFormContext {
  /** Where the form posts. */
  action: string;
  /** The name each field is submitted under. */
  fields: typeof COMMENT_FIELDS;
  /** Which post is being commented on, as the hidden field carries it. */
  post: string;
  /**
   * When this form was rendered, in epoch milliseconds, as the hidden field
   * carries it. What the minimum submit time is measured against.
   */
  loaded: string;
  /** What is in the fields: empty on a fresh form, what was typed on a refused one. */
  values: Record<'name' | 'email' | 'url' | 'body' | 'inReplyTo' | 'notify', string>;
  /**
   * Whether to offer "tell me about replies" at all (TASK-55).
   *
   * False on a site that sends no mail, where the box would be a promise
   * nothing could keep. A theme asks `{% if commentForm.notifiable %}`.
   */
  notifiable: boolean;
  /** One message per field a person has to put right. Empty on a fresh form. */
  problems: CommentProblems;
  /** A message about the submission as a whole, when there is one. */
  error?: string | undefined;
  /** The longest a name may be, for the field's `maxlength`. */
  nameLength: number;
  /** The longest a comment may be, for the textarea's `maxlength`. */
  bodyLength: number;
  /**
   * Who the site knows is filling this in, when a session says so (TASK-103).
   *
   * Absent for a stranger, so a theme asks `{% if commentForm.signedInAs %}`
   * and draws the short form — the comment box and a sentence naming the
   * person — instead of the name, email and website boxes and the honeypot.
   * Nothing about the account is here but the two things the sentence prints:
   * the email is never handed to a template, exactly as a stranger's never is.
   */
  signedInAs?: { name: string; url: string } | undefined;
  /**
   * The token the signed-in form carries, and absent on a stranger's.
   *
   * A form that acts on nobody's behalf needs none; the moment this one posts
   * under somebody's name, a page on another site could make them post without
   * knowing it, so it carries the same per-session token every admin form
   * does and the endpoint checks it the way the admin guard does.
   */
  csrfToken?: string | undefined;
}

/**
 * Who the site knows is commenting, when a valid session says so.
 *
 * Read from the session on the request rather than from anything the browser
 * typed: `email` is the account's, which the comment is stored with and which
 * no template is ever handed, and `csrfToken` is that session's own.
 */
export interface CommentViewer {
  /** What the comment goes under: their display name, else their username. */
  name: string;
  /** Their author archive, which is the comment's website. */
  url: string;
  /** The account's email, which is stored and never shown. */
  email: string | null;
  /** This session's CSRF token, which the form carries. */
  csrfToken: string;
}

/**
 * The same form drawn for somebody the site knows rather than for a stranger.
 *
 * A function over a built form rather than another parameter on the two
 * builders, so `commentForm` and `refilledCommentForm` keep the signatures the
 * package publishes and there is one place that decides what "signed in"
 * changes about a form.
 */
export function signedInCommentForm(
  form: CommentFormContext,
  viewer: CommentViewer,
): CommentFormContext {
  return {
    ...form,
    signedInAs: { name: viewer.name, url: viewer.url },
    csrfToken: viewer.csrfToken,
  };
}

/** Where the comment form posts. */
export const COMMENT_POST_PATH = '/_geekity/comments';

/** The query the redirect after a submission carries, and what it can say. */
export const COMMENT_NOTICE_PARAM = 'comment';

/**
 * The query a Reply link on a comment carries.
 *
 * Threading without a line of JavaScript: the link goes to the form with the
 * comment it answers named in the URL, the form puts that in its hidden field,
 * and Cancel is a link back to the page without the query.
 */
export const COMMENT_REPLY_PARAM = 'reply_to';

/**
 * What that query means, and what the reader is told.
 *
 * A redirect rather than a rendered page, so a refresh does not post the
 * comment again; a query rather than a flash, because a reader has no session
 * to hang one on.
 */
export const COMMENT_NOTICES: Readonly<Record<string, string>> = {
  posted: 'Thank you — your comment is on the page.',
  pending: 'Thank you — your comment is waiting to be approved.',
};

/** A fresh, empty form for a post that is taking comments. */
export function commentForm(
  document: Document,
  now: Date = new Date(),
  notifiable = false,
): CommentFormContext {
  return refilledCommentForm(document, blankValues(), {}, now, undefined, notifiable);
}

/**
 * The same form with what somebody typed still in it.
 *
 * What a refused submission is answered with: losing a paragraph because an
 * email address had a typo in it is the fastest way to lose a commenter.
 */
export function refilledCommentForm(
  document: Document,
  values: CommentFormContext['values'],
  problems: CommentProblems,
  now: Date = new Date(),
  error?: string,
  notifiable = false,
): CommentFormContext {
  return {
    action: COMMENT_POST_PATH,
    fields: COMMENT_FIELDS,
    post: document.slug,
    loaded: String(now.getTime()),
    values,
    problems,
    notifiable,
    nameLength: MAXIMUM_NAME_LENGTH,
    bodyLength: MAXIMUM_BODY_LENGTH,
    ...(error === undefined ? {} : { error }),
  };
}

/** What a form holds before anybody has typed in it. */
export function blankValues(): CommentFormContext['values'] {
  return { name: '', email: '', url: '', body: '', inReplyTo: '', notify: '' };
}

/** What a submitted form typed, for putting back in a refused one. */
export function valuesOf(form: CommentForm): CommentFormContext['values'] {
  return {
    name: form.name,
    email: form.email,
    url: form.url,
    body: form.body,
    inReplyTo: form.inReplyTo,
    notify: form.notify,
  };
}
