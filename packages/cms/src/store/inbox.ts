import type { DatabaseSync } from 'node:sqlite';

import type { Clock } from '../util/clock.ts';

import { repliesKey } from '../content/guids.ts';
import { REPLY_ACTIVITY_TYPE, replyIdOf, replyTargetOf } from './inbox-replies.ts';
import type { ConversationWrite } from './conversation.ts';
import { inTransaction, NO_LIMIT, nullableText } from './rows.ts';
import type { ListPageOptions } from './rows.ts';

/**
 * Which rows of the inbox log are replies: a `Create` that named something it
 * answers. Spelled once, because a count and a listing that disagreed about it
 * would show a post a number no page of comments could produce.
 */
const IS_REPLY = `activity_type = '${REPLY_ACTIVITY_TYPE}' AND in_reply_to IS NOT NULL`;

/**
 * One activity that arrived in the inbox and was recorded rather than acted
 * on: doc-4's `Like`, `Announce` and `Create(Note)` reply, and the follow
 * traffic alongside them.
 *
 * The raw JSON-LD is kept whole because a later phase surfaces likes, boosts
 * and comments, and what that phase needs out of an activity is not knowable
 * from here.
 */
export interface InboxActivity {
  /** Row id, and the order activities arrived in. */
  readonly id: number;
  /** The activity's own id, or `null` for one that arrived without one. */
  readonly activityId: string | null;
  /** The compacted ActivityStreams type name, such as `Like` or `Announce`. */
  readonly activityType: string;
  /** Who sent it. */
  readonly actorId: string;
  /** What it was about — the post that was liked, the note replied to — or `null`. */
  readonly objectId: string | null;
  /**
   * Which of this site's users it was addressed to, or `null` for one
   * delivered to the shared inbox without naming one.
   *
   * decision-14 makes every user an actor, so the log records whose inbox was
   * told as well as what it was told. Derived from the log line rather than
   * from the activity, because the addressee is a fact about the delivery.
   */
  readonly recipient: string | null;
  /**
   * The object this activity answers, for a `Create` that carried an
   * `inReplyTo`, and `null` for everything else.
   *
   * Derived from {@link InboxActivity.json} by {@link replyTargetOf} rather
   * than supplied, so an index rebuilt from the inbox log holds exactly what
   * the live one holds. It is a column so a post's replies can be counted
   * without reading every activity the site was ever sent.
   */
  readonly inReplyTo: string | null;
  /** When it arrived, as an ISO 8601 instant. */
  readonly receivedAt: string;
  /**
   * Whether the site read it rather than was told it: a reply found in a
   * fediverse reply's `replies` collection (TASK-321), logged as the `Create`
   * nobody delivered. Only these are the site's to remove when the remote
   * server stops listing them.
   */
  readonly fetched: boolean;
  /** The activity as compacted JSON-LD, exactly as it was received. */
  readonly json: string;
}

/**
 * An {@link InboxActivity} before the store has given it a row and the reply
 * target it derives.
 *
 * `receivedAt` is optional and defaults to now, exactly as a follower's
 * `followedAt` is: naming one is what lets the boot rebuild put the log's own
 * arrival times back rather than stamping every activity with the moment the
 * index was rebuilt.
 */
export type NewInboxActivity = Omit<
  InboxActivity,
  'id' | 'receivedAt' | 'inReplyTo' | 'recipient' | 'fetched'
> & {
  receivedAt?: string | undefined;
  /** Delivered, unless it says otherwise. */
  fetched?: boolean | undefined;
  /**
   * Who it was addressed to, when the delivery said. Optional and `null` by
   * default: an activity that reached the shared inbox without naming one of
   * this site's actors is addressed to nobody in particular, and so is every
   * line of a log written before decision-14.
   */
  recipient?: string | null | undefined;
};

export interface InboxStore {
  /** How many activities the inbound log holds. */
  countInboxActivities(): number;
  /** Logged activities, newest first, optionally one page of them. */
  listInboxActivities(options?: ListPageOptions): InboxActivity[];
  /**
   * Record an inbound activity, replacing an earlier row with the same
   * activity id so a redelivered `Like` stays one like. An activity that
   * arrived without an id is always a new row: there is nothing to match it
   * against.
   */
  logInboxActivity(activity: NewInboxActivity): InboxActivity;
  /** Forget one logged activity by its row id. Returns `false` when there was none. */
  deleteInboxActivity(id: number): boolean;
  /**
   * Make the inbound log index say exactly this, in one transaction, with the
   * row ids starting again from one.
   *
   * The counterpart of {@link FollowerStore.replaceFollowers} over
   * `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`. The ids restart
   * because a row id is the order things arrived in and nothing else: letting
   * them climb on every boot would give the same log different ids on two
   * machines holding the same files.
   */
  replaceInboxActivities(activities: readonly NewInboxActivity[]): void;
  /** How many logged activities are replies to anything at all. */
  countReplies(): number;
  /** Every logged reply, newest first, optionally one page of them. */
  listReplies(options?: ListPageOptions): InboxActivity[];
  /** How many replies one object — a post's ActivityStreams id — has. */
  countRepliesTo(objectId: string): number;
  /** One object's replies, newest first, optionally one page of them. */
  listRepliesTo(objectId: string, options?: ListPageOptions): InboxActivity[];
  /**
   * Every logged activity that names one of these objects — as what it is
   * about, or as what it answers — oldest first.
   *
   * The query a conversation is built from: the likes and boosts of a post,
   * the replies to it, and the `Delete` or `Undo` that takes one of those
   * back, all name an object this side already knows the id of. Both columns
   * are read because a `Create` is *about* the note it carries and only
   * `in_reply_to` says which post that note answers.
   *
   * Oldest first, because that is the order a thread reads in; a caller
   * wanting the newest can reverse a page it has. Naming nothing returns
   * nothing rather than everything.
   */
  listActivitiesAbout(objectIds: readonly string[]): InboxActivity[];

  /** The logged replies whose note's id has this `/replies/` key (TASK-327). */
  listRepliesByKey(key: string): InboxActivity[];
}

export function openInboxStore(
  db: DatabaseSync,
  written: (change: ConversationWrite) => void,
  clock: Clock,
): InboxStore {
  const statements = {
    clearInboxActivities: db.prepare('DELETE FROM ap_inbox'),
    resetInboxSequence: db.prepare("DELETE FROM sqlite_sequence WHERE name = 'ap_inbox'"),
    countInboxActivities: db.prepare('SELECT COUNT(*) AS count FROM ap_inbox'),
    deleteInboxActivity: db.prepare('DELETE FROM ap_inbox WHERE id = ? RETURNING *'),
    listInboxActivities: db.prepare(`
      SELECT * FROM ap_inbox
      ORDER BY received_at DESC, id DESC
      LIMIT ? OFFSET ?
    `),
    logInboxActivity: db.prepare(`
      INSERT INTO ap_inbox (
        activity_id, activity_type, actor_id, object_id, in_reply_to, reply_key, recipient,
        received_at, fetched, json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (activity_id) DO UPDATE SET
        activity_type = excluded.activity_type,
        actor_id = excluded.actor_id,
        object_id = excluded.object_id,
        in_reply_to = excluded.in_reply_to,
        reply_key = excluded.reply_key,
        recipient = excluded.recipient,
        received_at = excluded.received_at,
        fetched = excluded.fetched,
        json = excluded.json
      RETURNING *
    `),
    countReplies: db.prepare(`SELECT COUNT(*) AS count FROM ap_inbox WHERE ${IS_REPLY}`),
    listReplies: db.prepare(`
      SELECT * FROM ap_inbox WHERE ${IS_REPLY}
      ORDER BY received_at DESC, id DESC
      LIMIT ? OFFSET ?
    `),
    countRepliesTo: db.prepare(`
      SELECT COUNT(*) AS count FROM ap_inbox WHERE ${IS_REPLY} AND in_reply_to = ?
    `),
    listRepliesTo: db.prepare(`
      SELECT * FROM ap_inbox WHERE ${IS_REPLY} AND in_reply_to = ?
      ORDER BY received_at DESC, id DESC
      LIMIT ? OFFSET ?
    `),

    repliesByKey: db.prepare(`
      SELECT * FROM ap_inbox WHERE ${IS_REPLY} AND reply_key = ? ORDER BY received_at, id
    `),
  };
  return {
    countInboxActivities() {
      const row = statements.countInboxActivities.get() as Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    listInboxActivities(options = {}) {
      const rows = statements.listInboxActivities.all(
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      ) as Record<string, unknown>[];
      return rows.map(toInboxActivity);
    },

    logInboxActivity(activity) {
      const row = statements.logInboxActivity.get(
        activity.activityId,
        activity.activityType,
        activity.actorId,
        activity.objectId,
        // Derived here rather than passed in, so the column cannot say
        // something the stored activity does not.
        replyTargetOf(activity.json),
        replyKeyOf(activity),
        activity.recipient ?? null,
        activity.receivedAt ?? clock().toISOString(),
        activity.fetched === true ? 1 : 0,
        activity.json,
      ) as Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new Error(`The activity "${activity.activityType}" was not written to the log.`);
      }
      const logged = toInboxActivity(row);
      written(activityWrite(logged));
      return logged;
    },

    deleteInboxActivity(id) {
      const row = statements.deleteInboxActivity.get(id) as Record<string, unknown> | undefined;
      if (row === undefined) return false;
      written(activityWrite(toInboxActivity(row)));
      return true;
    },

    replaceInboxActivities(activities) {
      inTransaction(db, () => {
        statements.clearInboxActivities.run();
        // The AUTOINCREMENT high-water mark goes with the rows, so the same
        // log always produces the same ids however many times it is rebuilt.
        statements.resetInboxSequence.run();
        for (const activity of activities) {
          statements.logInboxActivity.run(
            activity.activityId,
            activity.activityType,
            activity.actorId,
            activity.objectId,
            replyTargetOf(activity.json),
            replyKeyOf(activity),
            activity.recipient ?? null,
            activity.receivedAt ?? clock().toISOString(),
            activity.fetched === true ? 1 : 0,
            activity.json,
          );
        }
      });
    },

    countReplies() {
      const row = statements.countReplies.get() as Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    listReplies(options = {}) {
      const rows = statements.listReplies.all(
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      ) as Record<string, unknown>[];
      return rows.map(toInboxActivity);
    },

    countRepliesTo(objectId) {
      const row = statements.countRepliesTo.get(objectId) as Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    listRepliesTo(objectId, options = {}) {
      const rows = statements.listRepliesTo.all(
        objectId,
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      ) as Record<string, unknown>[];
      return rows.map(toInboxActivity);
    },

    listActivitiesAbout(objectIds) {
      if (objectIds.length === 0) return [];

      // Prepared here rather than beside the others because the number of
      // placeholders is the number of ids: a conversation asks about the post,
      // then about the notes that answered it, and neither count is known when
      // the statements are built.
      const placeholders = objectIds.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `SELECT * FROM ap_inbox
           WHERE object_id IN (${placeholders}) OR in_reply_to IN (${placeholders})
           ORDER BY id ASC`,
        )
        .all(...objectIds, ...objectIds) as Record<string, unknown>[];
      return rows.map(toInboxActivity);
    },

    listRepliesByKey(key) {
      return (statements.repliesByKey.all(key) as Record<string, unknown>[]).map(toInboxActivity);
    },
  };
}

function toInboxActivity(row: Record<string, unknown>): InboxActivity {
  return {
    id: Number(row['id']),
    activityId: nullableText(row['activity_id']),
    activityType: String(row['activity_type']),
    actorId: String(row['actor_id']),
    objectId: nullableText(row['object_id']),
    inReplyTo: nullableText(row['in_reply_to']),
    recipient: nullableText(row['recipient']),
    receivedAt: String(row['received_at']),
    fetched: Number(row['fetched']) === 1,
    json: String(row['json']),
  };
}

/** What {@link ConversationEvents.onConversationWrite} hears about one logged activity. */
function activityWrite(activity: InboxActivity): ConversationWrite {
  return {
    kind: 'activity',
    about: [activity.objectId, activity.inReplyTo].filter((id) => id !== null),
  };
}

/** The `/replies/` key of a logged reply's note, or `null` for anything else. */
export function replyKeyOf(activity: Parameters<typeof replyIdOf>[0]): string | null {
  const id = replyIdOf(activity);
  return id === null ? null : repliesKey(id);
}
