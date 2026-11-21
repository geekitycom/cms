import { commentKeyAt, heldComment } from '../comments/conversation.ts';
import type { ConversationReader } from '../comments/conversation.ts';
import type { CommentNotices, PublishedComment } from '../comments/intake.ts';
import { addComment, deleteComment, updateComment } from '../comments/records.ts';
import type { ResolvedConfig } from '../config.ts';
import { isWebUrl } from '../content/enclosure.ts';
import { repliesKey } from '../content/guids.ts';
import { sanitizeCommentHtml } from '../content/sanitize.ts';
import { htmlToText } from '../content/search.ts';
import type { FediverseReplyRule } from '../site/fediverse-replies.ts';
import { SITE } from '../site/namespace.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import type {
  AdminStore,
  CommentAuthor,
  InboxActivity,
  PostComment,
} from '../store/admin-store.ts';
import {
  editedNoteOf,
  guessedName,
  replyFrom,
  REPLY_ACTIVITY_TYPE,
} from '../store/inbox-replies.ts';
import type { Reply } from '../store/inbox-replies.ts';
import { removeInboxActivities } from './records.ts';
import type { FederationRecords } from './records.ts';

export interface ReplyReview {
  received(activity: InboxActivity): Promise<void>;
  deleted(actorId: string, objectId: string): Promise<void>;
  edited(actorId: string, json: string): Promise<void>;
}

export interface CreateReplyReviewOptions {
  readonly admin: AdminStore;
  readonly config: Pick<ResolvedConfig, 'baseUrl' | 'contentDir' | 'dataDir'>;
  readonly settings: Pick<SettingsRegistry, 'values'>;
  readonly conversation: Pick<ConversationReader, 'documentOf'>;
  readonly notices: Pick<CommentNotices, 'pending' | 'published'>;
}

export function createReplyReview(options: CreateReplyReviewOptions): ReplyReview {
  const { admin, config, settings, conversation, notices } = options;
  const records: FederationRecords = {
    admin,
    contentDir: config.contentDir,
    dataDir: config.dataDir,
  };

  function hasShownReply(actorId: string, except: string): boolean {
    for (let offset = 0; ; offset += SHOWN_PAGE) {
      const { items } = admin.searchInboxActivities(
        { actor: actorId, type: REPLY_ACTIVITY_TYPE },
        { limit: SHOWN_PAGE, offset },
      );
      for (const activity of items) {
        const earlier = replyFrom(activity);
        if (earlier === undefined || earlier.id === except) continue;
        if (heldComment(admin, earlier.id) !== undefined) continue;
        if (withdrawn(admin, actorId, earlier.id)) continue;
        if (conversation.documentOf(earlier.inReplyTo) !== undefined) return true;
      }
      if (items.length < SHOWN_PAGE) return false;
    }
  }

  async function showsAtOnce(actorId: string, noteId: string): Promise<boolean> {
    const rule: FediverseReplyRule = (await settings.values(SITE)).fediverse_replies;
    switch (rule) {
      case 'show':
        return true;
      case 'hold':
        return false;
      case 'known':
        return (
          admin.listFollowers().some((follower) => follower.actorId === actorId) ||
          admin.hasApprovedActor(actorId) ||
          hasShownReply(actorId, noteId)
        );
    }
  }

  function heldFrom(actorId: string, noteId: string): PostComment | undefined {
    const held = heldComment(admin, noteId);
    return held !== undefined && held.migrated !== true && held.actor === actorId
      ? held
      : undefined;
  }

  return {
    async received(activity) {
      const reply = replyFrom(activity);
      if (reply === undefined || heldComment(admin, reply.id) !== undefined) return;
      const post = conversation.documentOf(reply.inReplyTo);
      if (post === undefined) return;

      const comment: PublishedComment = {
        id: repliesKey(reply.id),
        slug: post.slug,
        permalink: post.permalink,
        source: 'activitypub',
        kind: 'reply',
        author: authorOf(admin, reply.actorId),
        content: contentOf(reply.html),
        submitted: reply.published.toISOString(),
        url: isWebUrl(reply.url) ? reply.url : null,
      };

      if (await showsAtOnce(reply.actorId, reply.id)) {
        if (isNews(activity)) notices.published(comment);
        return;
      }

      const held = await addComment(records, {
        ...comment,
        status: 'pending',
        addressHash: null,
        inReplyTo: parentOf(admin, config.baseUrl, reply.inReplyTo),
        notify: false,
        origin: reply.id,
        actor: reply.actorId,
      });
      notices.pending(held);
    },

    async deleted(actorId, objectId) {
      const held = heldFrom(actorId, objectId);
      if (held !== undefined) await deleteComment(records, held.id);
    },

    async edited(actorId, json) {
      const note = editedNoteOf(json);
      if (note === undefined) return;
      const held = heldFrom(actorId, note.id);
      if (held !== undefined)
        await updateComment(records, held.id, { content: contentOf(note.html) });
    },
  };
}

export async function forgetDeletedReply(
  records: FederationRecords,
  comment: PostComment,
): Promise<void> {
  const note = comment.origin;
  if (comment.source !== 'activitypub' || note === undefined) return;
  await removeInboxActivities(
    records,
    records.admin
      .listActivitiesAbout([note])
      .filter((activity) => activity.activityType === 'Create' && activity.objectId === note),
  );
}

const SHOWN_PAGE = 50;

function withdrawn(admin: AdminStore, actorId: string, noteId: string): boolean {
  return admin
    .listActivitiesAbout([noteId])
    .some(
      (activity) =>
        (activity.activityType === 'Delete' || activity.activityType === 'Undo') &&
        activity.actorId === actorId &&
        activity.objectId === noteId,
    );
}

function contentOf(html: string): { markdown: string; html: string } {
  const clean = sanitizeCommentHtml(html);
  return { markdown: htmlToText(clean), html: clean };
}

function authorOf(admin: AdminStore, actorId: string): CommentAuthor {
  const profile =
    admin.listFollowers().find((follower) => follower.actorId === actorId) ??
    admin.getActorProfile(actorId);
  const url = profile?.url ?? actorId;
  return {
    name: profile?.name ?? profile?.handle ?? guessedName(actorId),
    url: isWebUrl(url) ? url : null,
    email: null,
    avatar: profile?.iconUrl ?? null,
  };
}

function parentOf(admin: AdminStore, baseUrl: string, target: Reply['inReplyTo']): string | null {
  const held = heldComment(admin, target) ?? admin.listCommentsAt(target)[0];
  if (held !== undefined) return held.id;

  const named = new URL(target);
  if (named.origin === new URL(baseUrl).origin) {
    const key = commentKeyAt(named.pathname);
    return key !== undefined && admin.getComment(key) !== undefined ? key : null;
  }

  const logged = admin
    .listActivitiesAbout([target])
    .some((activity) => replyFrom(activity)?.id === target);
  return logged ? target : null;
}

function isNews(activity: InboxActivity): boolean {
  return activity.fetched !== true;
}
