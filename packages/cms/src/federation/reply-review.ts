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

/**
 * Whether a fediverse reply shows on the page as it arrives or waits for a
 * moderator, under the rule chosen on Settings > Discussion.
 *
 * A reply that shows stays what every fediverse reply has always been: a
 * `Create` in the inbox log, read into the page as it is drawn. A reply that
 * waits is also stored as a pending comment keyed by its note id, with the
 * note as its `origin` and its sender as its `actor`. The page already lets a
 * stored comment with that origin stand for the note and threads the replies
 * under it beneath the stored one, so from there the queue, the notice and
 * its links, the digest and moderation are the ones every comment has.
 *
 * The rule is applied as a reply is received, never as a page is drawn, so a
 * reply already on a page stays there whatever the rule becomes. A delivered
 * reply that shows at once sends the published notice; a fetched one does
 * not, because the backfill finds replies that may be weeks old.
 */
export interface ReplyReview {
  /** A `Create` has just been logged, delivered or fetched. */
  received(activity: InboxActivity): Promise<void>;
  /** An actor deleted something: a held note of theirs leaves the queue. */
  deleted(actorId: string, objectId: string): Promise<void>;
  /** An actor sent an `Update`: a held note of theirs says its new words. */
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

  /**
   * Whether the page shows a reply this actor sent before this one: logged,
   * on one of the site's documents, not held for review and not withdrawn by
   * its author. Read off the inbox log's index, so it holds after a rebuild.
   */
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

  /** A held note of this actor's that arrived here, never one imported from elsewhere. */
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

      // A reply the rule lets through is on the page now, as it is logged.
      // One the backfill fetched is an old reply only now found, not news.
      if (await showsAtOnce(reply.actorId, reply.id)) {
        if (!activity.fetched) notices.published(comment);
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

/**
 * Take a deleted fediverse reply's `Create` out of the inbox log as well, so
 * the copy there does not come back onto the page in the stored one's place.
 */
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

/** How many of an actor's logged `Create` rows are read at a time. */
const SHOWN_PAGE = 50;

/** Whether the actor took this note back with a `Delete` or an `Undo`. */
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

/**
 * What a held reply answers, as a stored comment names it: `null` for the
 * document itself, a stored comment's key, or the id of a fediverse reply
 * that is in the inbox log, which is what that reply is called in a thread.
 */
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
