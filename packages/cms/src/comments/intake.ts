import type { CommentStatus, PostComment } from '../store/admin-store.ts';
import { hashClientAddress } from '../forms/protection.ts';
import { messageOf } from '../util/errors.ts';
import { absoluteUrl } from '../util/url.ts';
import { webmentionKey } from '../content/guids.ts';
import { addComment, deleteComment, updateComment } from './records.ts';
import type { CommentRecords } from './records.ts';
import type { CommentChecker, CommentSubmission, CommentVerdict } from '../forms/checker.ts';

/**
 * The one door into a post's comments.
 *
 * Two things write comments — the form under a post and the webmention
 * endpoint — and both go through {@link intakeComment}, which is the whole of
 * what happens between a proposed comment and a comment existing: the address
 * hashed, the approved-author rule, the {@link CommentChecker}, one
 * verdict-to-status rule, the write, and the message to whoever was waiting to
 * hear. What the callers keep is what is really theirs — parsing a form and its
 * cheap defences, and fetching and verifying a source.
 */

/** Who is proposing a comment, which is the one thing the rules differ on. */
export type CommentOrigin =
  /** Somebody filled in the form under a post (doc-6). */
  | 'form'
  /** Another page said it links here, and it was verified (doc-7). */
  | 'webmention';

/**
 * A comment as its writer proposes it: everything but the three things the
 * intake decides — its name, where it stands, and where it came from.
 */
export type ProposedComment = Omit<PostComment, 'id' | 'status' | 'addressHash'>;

/**
 * Whoever is told about a comment that has just been written.
 *
 * Structural rather than the notifier's own type, so this module does not have
 * to know how a message is rendered or sent; `CommentNotifier` satisfies it.
 */
export interface CommentNotices {
  /** Something is waiting for a moderator. */
  pending(comment: PostComment): void;
  /** A reply is on the page, so whoever it answers may want to know. */
  replyApproved(reply: PostComment): void;
}

/** What {@link intakeComment} needs around a proposed comment. */
export interface IntakeCommentOptions {
  /** The files it is written into, and the index over them. */
  records: CommentRecords;
  /** Who is proposing it. */
  origin: CommentOrigin;
  /** The comment itself, as its writer proposes it. */
  comment: ProposedComment;
  /**
   * The post, as a checker is told it.
   *
   * The URL is passed rather than derived because the two callers know
   * different truths about it: a form knows the post's permalink against the
   * site's base URL, and a webmention knows the exact target its sender named.
   */
  post?: { title: string; url: string } | undefined;
  /** Where the address salt lives. */
  dataDir: string;
  /** The site's public origin. */
  baseUrl: string;
  /** The checker, when the site named one. */
  checker?: CommentChecker | undefined;
  /** Who to tell, when there is anybody to tell (TASK-55). */
  notices?: CommentNotices | undefined;
  /** Where the submission came from, **unhashed**. Only the checker sees it. */
  address?: string | undefined;
  /** The `User-Agent` it arrived with, for the checker. */
  userAgent?: string | undefined;
  /** The `Referer` it arrived with, for the checker. */
  referrer?: string | undefined;
  /** Where a checker that will not answer is reported. Defaults to `console`. */
  logger?: { warn(message: string): void } | undefined;
}

/** What became of one proposed comment. */
export type CommentIntakeOutcome =
  /**
   * It is in the file. `created` says whether it is new: a page re-sending its
   * webmention rewrites the entry it already made, which is not news.
   */
  | { readonly kind: 'stored'; readonly comment: PostComment; readonly created: boolean }
  /**
   * Nothing was stored, because a checker said to throw it away. `removed`
   * says whether it took a webmention this site was already holding with it.
   */
  | { readonly kind: 'discarded'; readonly removed: boolean }
  /** The entry it was going to rewrite went while this was deciding. */
  | { readonly kind: 'gone' };

/**
 * The one door into `content/_data/comments/`.
 *
 * Everything between a proposed comment and a comment existing happens here,
 * so the form, the webmention endpoint and the admin screen cannot drift into
 * three different answers to the same four questions.
 *
 * **Where the site would put it, before anybody judged it.** A form comment
 * whose name and email together have been approved before is approved again —
 * WordPress's rule, and the whole of the auto-approval decision. A webmention
 * waits, because a page linking here is as much a stranger's words as a form
 * submission is.
 *
 * **What the checker says.** Everything goes through {@link CommentChecker}; a
 * checker that is down or throws is no opinion, so a service having a bad
 * afternoon never stops a site taking comments.
 *
 * **The one verdict-to-status rule.**
 *
 * | Verdict   | A new comment                        | A webmention sent again              |
 * | --------- | ------------------------------------ | ------------------------------------ |
 * | `discard` | Nothing is stored.                   | The held entry is deleted.           |
 * | `spam`    | Filed as spam.                       | Filed as spam.                       |
 * | `ham`     | Approved.                            | The moderator's decision stands.     |
 * | `unknown` | Where the site would have put it.    | The moderator's decision stands.     |
 *
 * A source re-sending its webmention must not take an approved mention back
 * into the queue, and must not quietly let a spam one out. A checker that has
 * changed its mind to `spam` is the one thing that moves it, because that is a
 * new fact about the content rather than a repeat of an old one.
 *
 * **Who hears about it.** A new entry that is waiting sends the moderation
 * notice, once. A webmention that was merely rewritten sends nothing — the
 * moderators heard the first time and it has been in the queue ever since —
 * and neither does one that was approved or filed as spam, because neither is
 * waiting for anybody. A new comment that is approved instead tells whoever it
 * answers, when they asked to be told.
 */
export async function intakeComment(options: IntakeCommentOptions): Promise<CommentIntakeOutcome> {
  const { records, origin, comment } = options;

  // What this site would do about it on its own, which is both what a checker
  // is shown and what `unknown` falls back to.
  const proposed: Omit<PostComment, 'id'> = {
    ...comment,
    status: siteStatusFor(origin, records, comment),
    addressHash: hashClientAddress(options.dataDir, options.address),
  };

  const held =
    origin === 'webmention' ? heldWebmention(records, comment.slug, comment.url) : undefined;

  const verdict = await ask(options, proposed);

  if (verdict === 'discard') {
    if (held === undefined) return { kind: 'discarded', removed: false };
    await deleteComment(records, held.id);
    return { kind: 'discarded', removed: true };
  }

  const status = statusFor(verdict, proposed.status, held);

  if (held !== undefined) {
    // Its id, its post and its source never move: that is what makes it the
    // same comment. What the page now says about itself replaces what it said,
    // what it answers included.
    const moved = await updateComment(records, held.id, {
      kind: comment.kind,
      status,
      author: comment.author,
      content: comment.content,
      submitted: comment.submitted,
      inReplyTo: comment.inReplyTo,
      rsvp: comment.rsvp ?? null,
      via: comment.via ?? null,
    });
    return moved === undefined
      ? { kind: 'gone' }
      : { kind: 'stored', comment: moved, created: false };
  }

  const stored = await addComment(records, {
    ...proposed,
    status,
    id: origin === 'webmention' ? webmentionKey(comment.url, comment.permalink) : undefined,
  });
  announce(options.notices, stored);
  return { kind: 'stored', comment: stored, created: true };
}

/**
 * The webmention this site already holds from that page, if any.
 *
 * The source URL is a webmention's identity (doc-7), so this is what stops a
 * blog post that is edited and re-sent adding a second entry — and what the
 * endpoint asks before it fetches, so a source that has stopped linking here
 * knows what to take away.
 */
export function heldWebmention(
  records: CommentRecords,
  slug: string,
  source: string | null,
): PostComment | undefined {
  if (source === null || source === '') return undefined;

  return records.admin
    .listCommentsFor(slug)
    .find((comment) => comment.source === 'webmention' && comment.url === source);
}

/** Where this site's own rules put a comment, before a checker has spoken. */
function siteStatusFor(
  origin: CommentOrigin,
  records: CommentRecords,
  comment: ProposedComment,
): CommentStatus {
  if (origin === 'webmention') return 'pending';
  return records.admin.hasApprovedAuthor(comment.author.name, comment.author.email)
    ? 'approved'
    : 'pending';
}

/** The verdict-to-status rule, in the one place it is written. */
function statusFor(
  verdict: CommentVerdict,
  site: CommentStatus,
  held: PostComment | undefined,
): CommentStatus {
  if (verdict === 'spam') return 'spam';
  if (held !== undefined) return held.status;
  return verdict === 'ham' ? 'approved' : site;
}

/** Ask the checker, if there is one, and treat a broken one as no opinion. */
async function ask(
  options: IntakeCommentOptions,
  comment: Omit<PostComment, 'id'>,
): Promise<CommentVerdict> {
  const checker = options.checker;
  if (checker === undefined) return 'unknown';

  const post = options.post;
  const submission: CommentSubmission = {
    comment,
    post: {
      slug: comment.slug,
      title: post?.title ?? comment.slug,
      url: post?.url ?? absoluteUrl(comment.permalink, options.baseUrl),
    },
    address: options.address,
    userAgent: options.userAgent,
    referrer: options.referrer,
    baseUrl: options.baseUrl,
  };

  try {
    return await checker.check(submission);
  } catch (error) {
    // A checker that is down must not stop a site taking comments; the comment
    // falls back to whatever the site's own rules said about it.
    const logger = options.logger ?? console;
    logger.warn(`The comment checker refused to answer: ${messageOf(error)}`);
    return 'unknown';
  }
}

/** Tell whoever was waiting on a comment that has just been written. */
function announce(notices: CommentNotices | undefined, stored: PostComment): void {
  if (notices === undefined) return;

  // Only `pending`: one a checker filed as spam is not waiting for anybody,
  // and one it said to discard was never stored at all.
  if (stored.status === 'pending') notices.pending(stored);
  // A comment the site let straight through is on the page already, so
  // whoever it answers hears about it now rather than at a moderator's hand.
  else if (stored.status === 'approved') notices.replyApproved(stored);
}
