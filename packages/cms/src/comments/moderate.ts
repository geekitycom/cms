import type { CommentStatus, PostComment } from '../admin/store.ts';
import { deleteComment, updateComment } from './records.ts';
import type { CommentRecords } from './records.ts';
import type { CommentChecker, CommentReport } from './submission.ts';

/**
 * The three things that can be done to a stored comment, in one place.
 *
 * There are two doors onto them — the moderation screen, and the one-click
 * links a notification carries (TASK-55) — and they have to agree about
 * everything: which file is rewritten, when the index moves, and when a spam
 * checker is told a human disagreed with it. Two copies of that would drift,
 * and the way they would drift is that the email links would quietly stop
 * training Akismet.
 *
 * So this is the whole of moderation, and both doors are a thin skin over it:
 * one turns the outcome into a flash and a redirect, the other into a page a
 * mail reader can show.
 */

/** What a button, or a link in a message, can do to a comment. */
export const MODERATION_ACTIONS = ['approve', 'spam', 'delete'] as const;

/** One of {@link MODERATION_ACTIONS}. */
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** Whether a name is one of them. */
export function isModerationAction(value: string): value is ModerationAction {
  return (MODERATION_ACTIONS as readonly string[]).includes(value);
}

/** What became of one moderation. */
export type ModerationOutcome =
  /** There is no such comment; somebody else has already dealt with it. */
  | { readonly kind: 'gone' }
  /** It was already exactly that, so nothing was written. */
  | { readonly kind: 'unchanged'; readonly comment: PostComment }
  /** It moved, and this is where it was before. */
  | { readonly kind: 'moved'; readonly comment: PostComment; readonly before: CommentStatus }
  /** It is gone now. The comment is what it was when it went. */
  | { readonly kind: 'deleted'; readonly comment: PostComment };

/** What {@link moderateComment} needs around it. */
export interface ModerateCommentOptions {
  /** The files and the index every action writes through. */
  records: CommentRecords;
  /** Which comment. */
  id: string;
  /** What to do to it. */
  action: ModerationAction;
  /** The checker, when the site named one, so a change of mind can be reported. */
  checker?: CommentChecker | undefined;
  /** The site's public origin, which a report names the post by. */
  baseUrl: string;
  /** Where a checker that will not take a correction is reported. */
  logger?: { warn(message: string): void } | undefined;
}

/**
 * Approve a comment, file it as spam, or forget it.
 *
 * The file is rewritten first and the index inside the same step, exactly as
 * the form on the public site does it: the file is the comment (decision-9),
 * and moderation only ever moves it.
 */
export async function moderateComment(options: ModerateCommentOptions): Promise<ModerationOutcome> {
  const { records, id, action } = options;
  const held = records.admin.getComment(id);
  if (held === undefined) return { kind: 'gone' };

  if (action === 'delete') {
    await deleteComment(records, id);
    return { kind: 'deleted', comment: held };
  }

  const status: CommentStatus = action === 'approve' ? 'approved' : 'spam';
  if (held.status === status) return { kind: 'unchanged', comment: held };

  const moved = await updateComment(records, id, { status });
  if (moved === undefined) return { kind: 'gone' };

  await tellChecker(options, moved, held.status);
  return { kind: 'moved', comment: moved, before: held.status };
}

/**
 * Tell the checker, when there is one, that a human disagreed with it.
 *
 * Only a real change of mind is reported. Approving something that was merely
 * waiting says nothing a checker did not already assume, and a service charged
 * per call should not be told it twice.
 */
async function tellChecker(
  options: ModerateCommentOptions,
  comment: PostComment,
  before: CommentStatus,
): Promise<void> {
  const checker: CommentChecker | undefined = options.checker;
  if (checker === undefined) return;

  const report: CommentReport = {
    comment,
    url: absolute(comment.permalink, options.baseUrl),
    baseUrl: options.baseUrl,
  };

  try {
    if (comment.status === 'spam') await checker.reportSpam?.(report);
    else if (before === 'spam') await checker.reportHam?.(report);
  } catch (error) {
    // The comment has already moved; a checker that cannot be told is a worse
    // spam filter tomorrow, not a failed moderation action today.
    const logger = options.logger ?? console;
    logger.warn(`The comment checker would not take the correction: ${messageOf(error)}`);
  }
}

/** A site-root path as an absolute URL. */
function absolute(pathname: string, baseUrl: string): string {
  try {
    return new URL(pathname, baseUrl).href;
  } catch {
    return pathname;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
