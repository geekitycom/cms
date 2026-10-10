import { listUsers } from '../admin/accounts.ts';
import { readSiteSettings } from '../admin/settings.ts';
import type { AdminStore, PostComment } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import type { ContentStore } from '../content/store.ts';
import type { DocumentChange } from '../content/sync.ts';
import { authorHref, userForAuthor } from '../web/authors.ts';
import type { ConversationReader } from '../web/conversation.ts';
import { isServed } from '../web/documents.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import type { CommentNotices } from './records.ts';

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
 */

/** What {@link createReplyNotices} needs. */
export interface CreateReplyNoticesOptions {
  readonly admin: AdminStore;
  readonly store: ContentStore;
  readonly conversation: ConversationReader;
  readonly notices: CommentNotices;
  readonly config: Pick<ResolvedConfig, 'baseUrl' | 'contentDir' | 'dataDir'>;
}

/** Listens to the index for reply posts that answer a native comment. */
export interface ReplyNotices {
  handle(change: DocumentChange): void;
}

/** Build the reply post notices for one site. */
export function createReplyNotices(options: CreateReplyNoticesOptions): ReplyNotices {
  const { admin, store, conversation, notices, config } = options;

  return {
    handle(change) {
      if (change.origin === 'scan') return;
      const reply = change.next;
      if (reply?.inReplyTo === undefined) return;
      const now = store.now();
      if (
        !isServed(reply, now) ||
        (change.previous !== undefined && isServed(change.previous, now))
      ) {
        return;
      }

      const answered = conversation.heldAt(absoluteUrl(reply.inReplyTo, config.baseUrl));
      if (answered?.kind !== 'reply' || answered.reply.source !== 'comment') return;

      const told = `reply-notice:${answered.reply.id}:${reply.permalink}`;
      if (admin.getState(told) !== undefined) return;
      admin.setState(told, now.toISOString());

      notices.replyApproved(noticeOf(reply, answered.reply.id, answered.post, config));
    },
  };
}

/** The reply post as the reply notice reads one, by its author's account. */
function noticeOf(
  reply: Document,
  parent: string,
  post: Document,
  config: CreateReplyNoticesOptions['config'],
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
      name:
        user?.profile?.displayName ??
        user?.username ??
        reply.author ??
        readSiteSettings(config.contentDir).title,
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
