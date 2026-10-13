import type { AdminStore, ConversationWrite, PostComment } from '../store/admin-store.ts';
import type { ResolvedConfig } from '../config.ts';
import { userForAuthor, authorHref } from '../content/authors.ts';
import type { Document } from '../content/document.ts';
import { isServed } from '../content/served.ts';
import type { DocumentLookup, IndexClock, ReplyReader } from '../content/store.ts';
import type { DocumentChange } from '../content/sync.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { SITE } from '../site/namespace.ts';
import { listUsers } from '../site/users.ts';
import { messageOf } from '../util/errors.ts';
import { createSerialQueue } from '../util/queue.ts';
import { absoluteUrl } from '../util/url.ts';
import { commentNames } from './conversation.ts';
import type { ConversationReader, ConversationSite } from './conversation.ts';
import type { CommentNotices } from './intake.ts';

/**
 * The reply notice for a reply post (TASK-326): a commenter who asked to hear
 * about replies hears about a reply post answering them, once, whichever door
 * it came in by: the thread, the moderation screen, the editor, Micropub or a
 * file. It listens to the index, as federation and webmentions do, so no door
 * has a call of its own to forget.
 *
 * Once is two rules. Only the change that first puts the reply post where a
 * reader can see it is news: an edit, a scan at boot, or a file the watcher
 * re-reads is not. And each notice is recorded before it goes, so a reply post
 * trashed and restored, or drafted and published again, is not news twice.
 *
 * A reply post answering a comment still waiting for a moderator is news when
 * the comment is approved instead (TASK-333), so it listens to the comment
 * index too, and both go through the one record.
 */

/** What {@link createReplyNotices} needs. */
export interface CreateReplyNoticesOptions {
  readonly admin: AdminStore;
  readonly store: DocumentLookup & ReplyReader & IndexClock;
  readonly conversation: ConversationReader;
  readonly notices: CommentNotices;
  readonly config: Pick<ResolvedConfig, 'baseUrl' | 'dataDir'>;
  readonly settings: Pick<SettingsRegistry, 'values'>;
}

/** Listens to the indexes for reply posts that answer a native comment. */
export interface ReplyNotices {
  handle(change: DocumentChange): void;
  /**
   * Consider one comment write. Run inside the comment file's lock, so it
   * only queues: the indexes are read once the site's settings are.
   */
  heard(written: ConversationWrite): void;
  /** Resolve once every notice queued so far has been considered. */
  settled(): Promise<void>;
}

/** Build the reply post notices for one site. */
export function createReplyNotices(options: CreateReplyNoticesOptions): ReplyNotices {
  const { admin, store, conversation, notices, config, settings } = options;
  const queue = createSerialQueue();

  const consider = (reply: Document, site: ConversationSite): void => {
    if (reply.inReplyTo === undefined) return;
    const answered = conversation.heldAt(absoluteUrl(reply.inReplyTo, config.baseUrl), site);
    if (answered?.kind !== 'reply' || answered.reply.source !== 'comment') return;

    const told = `reply-notice:${answered.reply.id}:${reply.permalink}`;
    if (admin.getState(told) !== undefined) return;
    admin.setState(told, store.now().toISOString());

    notices.replyApproved(noticeOf(reply, answered.reply.id, answered.post, config, site));
  };

  const tell = (replies: readonly Document[]): void => {
    if (replies.length === 0) return;
    queue
      .run(async () => {
        const site = await settings.values(SITE);
        for (const reply of replies) consider(reply, site);
      })
      .catch((thrown: unknown) => {
        console.warn(`A reply notice failed: ${messageOf(thrown)}`);
      });
  };

  return {
    handle(change) {
      if (change.origin === 'scan') return;
      const reply = change.next;
      if (reply === undefined) return;
      const now = store.now();
      if (
        !isServed(reply, now) ||
        (change.previous !== undefined && isServed(change.previous, now))
      ) {
        return;
      }
      tell([reply]);
    },

    heard(written) {
      if (written.kind !== 'comment' || !written.approved) return;
      const post = store.getBySlug(written.slug);
      if (post === undefined || admin.getComment(written.id)?.source !== 'comment') return;
      const permalink = absoluteUrl(post.permalink, config.baseUrl);
      tell(store.listRepliesTo(commentNames(written.id, permalink, config.baseUrl)));
    },

    settled: () => queue.settled(),
  };
}

/** The reply post as the reply notice reads one, by its author's account. */
function noticeOf(
  reply: Document,
  parent: string,
  post: Document,
  config: CreateReplyNoticesOptions['config'],
  site: ConversationSite,
): PostComment {
  const user = userForAuthor(listUsers(config.dataDir), reply.author);
  return {
    id: reply.permalink,
    slug: post.slug,
    permalink: post.permalink,
    source: 'comment',
    kind: 'reply',
    status: 'approved',
    author: {
      name: user?.profile?.displayName ?? user?.username ?? reply.author ?? site.title,
      url: user === undefined ? null : authorHref(user.username),
      email: user?.email ?? null,
      avatar: null,
    },
    content: { markdown: reply.body, html: reply.html },
    submitted: reply.date ?? reply.updated ?? '',
    addressHash: null,
    inReplyTo: parent,
    url: absoluteUrl(reply.permalink, config.baseUrl),
    notify: false,
  };
}
