import { listUsers } from '../admin/accounts.ts';
import { commentAnchor } from '../web/conversation.ts';
import { MODERATION_ACTIONS } from '../comments/moderate.ts';
import type { AdminStore, PostComment } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import type { ContentStore } from '../content/store.ts';
import type { MailService } from '../mail/service.ts';
import { moderationLink, unsubscribeLink } from './links.ts';
import { hasOptedOut } from './optouts.ts';
import { isBatchedMode, notificationMode, notificationRecipients } from './preferences.ts';

/**
 * The two messages a comment sets off, and the rules about who gets them.
 *
 * Both go through the mail service and nothing else (TASK-53), so a site with
 * no provider sends nothing and every path through here still works. Neither
 * is awaited by the request that caused it: a comment is stored, a page is
 * redirected to, and the message goes out behind that.
 *
 * **The moderation notice.** A comment or a webmention has entered the queue,
 * so everyone who has an address and has not turned the notice off is told,
 * with the words themselves and three signed links that approve, file as spam
 * or delete it without a login. It goes out for `pending` and nothing else,
 * which is the whole of the "not for spam" rule: a comment Akismet filed as
 * spam is nobody's decision to make today, and one it said to discard was
 * never stored at all.
 *
 * **The reply notice.** Somebody ticked "tell me about replies" when they
 * commented, and a reply to that comment has just been approved. That is the
 * only moment it goes: an unapproved reply is not something a stranger should
 * be emailed the text of, and a moderator should be able to delete a nasty one
 * before anybody hears about it.
 *
 * Three things stop it. The address is missing, the address has unsubscribed,
 * or the reply is by the very person who would be told — nobody needs an email
 * about their own words.
 */

/** The message an admin gets when something is waiting. */
export const COMMENT_PENDING_TEMPLATE = 'comment-pending';

/** The message a commenter gets when a reply to them is approved. */
export const COMMENT_REPLY_TEMPLATE = 'comment-reply';

/** The event name the users screen switches, from the registry. */
export const COMMENTS_NOTIFICATION = 'comments';

/** What {@link createCommentNotifier} needs. */
export interface CreateCommentNotifierOptions {
  /** The comment index, which is what a parent comment is looked up in. */
  admin: AdminStore;
  /** The content index, for the post's title. */
  store: ContentStore;
  /** The one door out for email. */
  mail: MailService;
  /**
   * Config after defaults: the base URL the links are absolute against, the
   * data directory the signing secret and the opt-outs live in, and the clock.
   */
  config: Pick<ResolvedConfig, 'baseUrl' | 'dataDir' | 'now'>;
}

/** Tells people about comments. Never throws, and never waits on a provider. */
export interface CommentNotifier {
  /**
   * A comment has been stored. Tells the moderators when, and only when, it is
   * waiting for one of them.
   */
  pending(comment: PostComment): void;
  /**
   * A comment has been approved. Tells whoever it answers, when they asked to
   * be told and are still listening.
   */
  replyApproved(reply: PostComment): void;
}

/** Build the notifier for one site. */
export function createCommentNotifier(options: CreateCommentNotifierOptions): CommentNotifier {
  const { admin, store, mail, config } = options;

  /** The post a comment is on, as a message names it. */
  function postOf(comment: PostComment): { title: string; url: string } {
    const document = store.getBySlug(comment.slug);
    return {
      title: document?.title ?? comment.slug,
      url: absolute(comment.permalink, config.baseUrl),
    };
  }

  /** What a message says about the comment itself. */
  function commentIn(comment: PostComment): Record<string, unknown> {
    return {
      author: comment.author.name,
      // The website they gave, which is a thing a moderator judges a comment
      // by. Never their email: the message goes to a moderator, but it also
      // goes through a third party's servers, and the address is not needed to
      // decide anything.
      website: comment.author.url,
      source: comment.source,
      kind: comment.kind,
      text: comment.content.markdown,
      html: comment.content.html,
      submitted: comment.submitted,
      // Where it came from, for a webmention: the page that linked here.
      url: comment.url,
    };
  }

  return {
    pending(comment) {
      if (comment.status !== 'pending') return;
      // Asked before anything else, so a site that sends no mail never mints a
      // signing secret it would have no use for.
      if (!mail.configured()) return;

      // Everybody who wants the notice as it happens. A user on an hourly or
      // daily digest is deliberately not written to here: the whole of what
      // choosing a window means is that this moment is not one of the moments
      // they hear about (TASK-60), and `createCommentDigest` writes to them
      // instead, from the queue as it stands when their window comes up.
      const recipients = notificationRecipients(
        listUsers(config.dataDir),
        COMMENTS_NOTIFICATION,
      ).filter(
        (recipient) => !isBatchedMode(notificationMode(recipient.user, COMMENTS_NOTIFICATION)),
      );
      if (recipients.length === 0) return;

      const context = { dataDir: config.dataDir, baseUrl: config.baseUrl, now: config.now() };
      const actions = MODERATION_ACTIONS.map((action) => ({
        action,
        label: action === 'approve' ? 'Approve' : action === 'spam' ? 'Spam' : 'Delete',
        url: moderationLink(context, comment.id, action),
      }));

      const data = {
        comment: commentIn(comment),
        post: postOf(comment),
        actions,
        queueUrl: absolute('/admin/comments', config.baseUrl),
      };

      for (const recipient of recipients) {
        // One message each rather than one with everybody on it: a moderator's
        // address is not something to show the other moderators, and a message
        // per person is what lets a later version say something different to
        // each of them.
        void mail.send({ to: recipient.email, template: COMMENT_PENDING_TEMPLATE, data });
      }
    },

    replyApproved(reply) {
      if (reply.status !== 'approved' || reply.inReplyTo === null) return;
      if (!mail.configured()) return;

      const parent = admin.getComment(reply.inReplyTo);
      if (parent === undefined || !parent.notify) return;

      const address = parent.author.email;
      if (address === null || address === '') return;
      // Nobody wants an email about their own reply, and a thread of two
      // people talking would otherwise send one on every message.
      if (address.toLowerCase() === (reply.author.email ?? '').toLowerCase()) return;
      if (hasOptedOut(config.dataDir, address)) return;

      const context = { dataDir: config.dataDir, baseUrl: config.baseUrl, now: config.now() };
      const post = postOf(reply);

      void mail.send({
        to: address,
        template: COMMENT_REPLY_TEMPLATE,
        data: {
          reply: {
            ...commentIn(reply),
            url: reply.url ?? `${post.url}#${commentAnchor(reply.id)}`,
          },
          comment: {
            ...commentIn(parent),
            url: parent.url ?? `${post.url}#${commentAnchor(parent.id)}`,
          },
          post,
          unsubscribeUrl: unsubscribeLink(context, address),
        },
      });
    },
  };
}

/** A site-root path as an absolute URL. */
function absolute(pathname: string, baseUrl: string): string {
  try {
    return new URL(pathname, baseUrl).href;
  } catch {
    return pathname;
  }
}
