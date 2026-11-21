import { listUsers } from '../site/users.ts';
import { commentAnchor } from '../comments/conversation.ts';
import { MODERATION_ACTIONS } from '../comments/moderate.ts';
import type { AdminStore, PostComment } from '../store/admin-store.ts';
import type { ResolvedConfig } from '../config.ts';
import type { DocumentLookup } from '../content/store.ts';
import { postLabel } from '../content/post-type.ts';
import type { CitedPageReader, CitedPagesNow } from '../content/citation.ts';
import type { PublishedComment } from '../comments/intake.ts';
import type { MailService } from './mail-service.ts';
import { recordNotice } from './notice-log.ts';
import { createSerialQueue } from '../util/queue.ts';
import { absoluteUrl } from '../util/url.ts';
import { moderationLink, unsubscribeLink } from './links.ts';
import { hasOptedOut } from './optouts.ts';
import {
  isBatchedMode,
  notificationMode,
  notificationRecipients,
} from '../site/notification-preferences.ts';

/**
 * The three messages a comment sets off, and the rules about who gets them.
 *
 * All three go through the mail service and nothing else, so a site with
 * no provider sends nothing and every path through here still works. None
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
 * **The published notice.** Something went on a page without passing through
 * a moderator: a form comment from an author approved before, anything a
 * checker called ham, or a fediverse reply the review rule shows. The people
 * who would have moderated it hear about it once, with the words and a link to
 * it on the page. A moderator's own approval sends nothing, because they were
 * there.
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

/** The message an admin gets when something went on a page without them. */
export const COMMENT_PUBLISHED_TEMPLATE = 'comment-published';

/** The message a commenter gets when a reply to them is approved. */
export const COMMENT_REPLY_TEMPLATE = 'comment-reply';

/** The event name the users screen switches, from the registry. */
export const COMMENTS_NOTIFICATION = 'comments';

/** The event name of the published notice, from the registry. */
export const PUBLISHED_NOTIFICATION = 'published';

/** What {@link createCommentNotifier} needs. */
export interface CreateCommentNotifierOptions {
  /** The comment index, which is what a parent comment is looked up in. */
  admin: AdminStore;
  /** The content index, for the post's title. */
  store: DocumentLookup;
  cited?: CitedPagesNow | undefined;
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
   * waiting for one of them, in one message with the waiting replies the same
   * page carried.
   */
  pending(comment: PostComment, carried?: readonly PostComment[]): void;
  /**
   * A comment has been approved. Tells whoever it answers, when they asked to
   * be told and are still listening.
   */
  replyApproved(reply: PostComment): void;
  /**
   * Something went on a page with no moderator's hand on it. Tells whoever
   * takes the published notice, now or in their digest.
   */
  published(comment: PublishedComment): void;
  /** Resolve once every notice asked for so far has been handed to the mail service. */
  settled(): Promise<void>;
}

/** Build the notifier for one site. */
export function createCommentNotifier(options: CreateCommentNotifierOptions): CommentNotifier {
  const { admin, store, mail, config } = options;
  const notices = createSerialQueue();

  /** The post a comment is on, as a message names it. */
  function postOf(
    comment: Pick<PostComment, 'slug' | 'permalink'>,
    cited: CitedPageReader | undefined,
  ): { title: string; url: string } {
    const document = store.getBySlug(comment.slug);
    return {
      title: document === undefined ? comment.slug : postLabel(document, cited),
      url: absoluteUrl(comment.permalink, config.baseUrl),
    };
  }

  /** What a message says about the comment itself. */
  function commentIn(comment: PublishedComment): Record<string, unknown> {
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
    pending(comment, carried = []) {
      const waiting = [comment, ...carried].filter((one) => one.status === 'pending');
      const [first, ...rest] = waiting;
      if (first === undefined) return;
      void notices.run(() => tellModerators(first, rest));
    },

    replyApproved(reply) {
      if (reply.status !== 'approved' || reply.inReplyTo === null) return;
      const parentId = reply.inReplyTo;
      void notices.run(() => tellParent(reply, parentId));
    },

    published(comment) {
      void notices.run(() => tellPublished(comment));
    },

    settled() {
      return notices.settled();
    },
  };

  async function tellPublished(comment: PublishedComment): Promise<void> {
    if (!(await mail.configured())) return;

    const post = postOf(comment, await options.cited?.());
    const link = `${post.url}#${commentAnchor(comment.id)}`;

    // A user on an hourly or daily digest is told from the notice log when
    // their window comes up; the key is the comment's, so a reply received
    // twice is listed once.
    await recordNotice({
      dataDir: config.dataDir,
      event: PUBLISHED_NOTIFICATION,
      item: {
        key: comment.id,
        actor: { name: comment.author.name, url: comment.author.url ?? undefined },
        action: publishedAction(comment),
        post,
        text: comment.content.markdown,
        url: link,
      },
      now: config.now(),
    });

    const recipients = notificationRecipients(
      listUsers(config.dataDir),
      PUBLISHED_NOTIFICATION,
    ).filter(
      (recipient) => !isBatchedMode(notificationMode(recipient.user, PUBLISHED_NOTIFICATION)),
    );

    const data = { comment: commentIn(comment), post, link };
    for (const recipient of recipients) {
      void mail.send({ to: recipient.email, template: COMMENT_PUBLISHED_TEMPLATE, data });
    }
  }

  async function tellModerators(
    comment: PostComment,
    carried: readonly PostComment[],
  ): Promise<void> {
    // Asked before anything else, so a site that sends no mail never mints a
    // signing secret it would have no use for.
    if (!(await mail.configured())) return;

    // Everybody who wants the notice as it happens. A user on an hourly or
    // daily digest is deliberately not written to here: the whole of what
    // choosing a window means is that this moment is not one of the moments
    // they hear about, and `createCommentDigest` writes to them
    // instead, from the queue as it stands when their window comes up.
    const recipients = notificationRecipients(
      listUsers(config.dataDir),
      COMMENTS_NOTIFICATION,
    ).filter(
      (recipient) => !isBatchedMode(notificationMode(recipient.user, COMMENTS_NOTIFICATION)),
    );
    if (recipients.length === 0) return;

    const context = { dataDir: config.dataDir, baseUrl: config.baseUrl, now: config.now() };
    const actionsFor = (id: string) =>
      MODERATION_ACTIONS.map((action) => ({
        action,
        label: action === 'approve' ? 'Approve' : action === 'spam' ? 'Spam' : 'Delete',
        url: moderationLink(context, id, action),
      }));

    const data = {
      comment: commentIn(comment),
      post: postOf(comment, await options.cited?.()),
      actions: actionsFor(comment.id),
      carried: carried.map((one) => ({ ...commentIn(one), actions: actionsFor(one.id) })),
      queueUrl: absoluteUrl('/admin/comments', config.baseUrl),
    };

    for (const recipient of recipients) {
      // One message each rather than one with everybody on it: a moderator's
      // address is not something to show the other moderators, and a message
      // per person is what lets a later version say something different to
      // each of them.
      void mail.send({ to: recipient.email, template: COMMENT_PENDING_TEMPLATE, data });
    }
  }

  async function tellParent(reply: PostComment, parentId: string): Promise<void> {
    if (!(await mail.configured())) return;

    const parent = admin.getComment(parentId);
    if (parent === undefined || !parent.notify) return;

    const address = parent.author.email;
    if (address === null || address === '') return;
    // Nobody wants an email about their own reply, and a thread of two
    // people talking would otherwise send one on every message.
    if (address.toLowerCase() === (reply.author.email ?? '').toLowerCase()) return;
    if (hasOptedOut(config.dataDir, address)) return;

    const context = { dataDir: config.dataDir, baseUrl: config.baseUrl, now: config.now() };
    const post = postOf(reply, await options.cited?.());

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
  }
}

/** What a digest says somebody did, as the words after their name. */
function publishedAction(comment: Pick<PostComment, 'source' | 'kind'>): string {
  if (comment.source === 'comment') return 'commented on';
  switch (comment.kind) {
    case 'reply':
      return 'replied to';
    case 'like':
      return 'liked';
    case 'boost':
    case 'repost':
      return 'reposted';
    case 'mention':
      return 'mentioned';
  }
}
