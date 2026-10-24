import type { DatabaseSync } from 'node:sqlite';

import type { Clock } from '../util/clock.ts';

import { repliesKey } from '../content/guids.ts';
import { REPLY_ACTIVITY_TYPE, replyIdOf, replyTargetOf } from './inbox-replies.ts';
import type { ConversationWrite } from './conversation.ts';
import { allRows, getRow, inTransaction, NO_LIMIT, nullableText, readCount } from './rows.ts';
import type { ListPageOptions, Row } from './rows.ts';

/**
 * Which rows of the inbox log are replies: a `Create` that named something it
 * answers. Spelled once, because a count and a listing that disagreed about it
 * would show a post a number no page of comments could produce.
 */
const IS_REPLY = `activity_type = '${REPLY_ACTIVITY_TYPE}' AND in_reply_to IS NOT NULL`;

/**
 * One activity that arrived in the inbox and was recorded rather than acted
 * on: a `Like`, an `Announce` or a `Create(Note)` reply, and the follow
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
   * Every user is an actor, so the log records whose inbox was
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
   * fediverse reply's `replies` collection, logged as the `Create`
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
   * line of a log written when the site had one actor.
   */
  recipient?: string | null | undefined;
};

export interface InboxInteraction {
  readonly kind: 'like' | 'boost' | 'reply';
  readonly receivedAt: string;
}

export interface LatestInteraction extends InboxInteraction {
  readonly actorId: string;
  readonly about: string | null;
}

const INTERACTIONS = `
  SELECT activity_type, actor_id,
    CASE WHEN activity_type = '${REPLY_ACTIVITY_TYPE}' THEN in_reply_to ELSE object_id END AS about,
    MIN(received_at) AS received_at
  FROM ap_inbox AS said
  WHERE received_at >= ?
    AND (activity_type IN ('Like', 'Announce') OR (${IS_REPLY}))
    AND NOT EXISTS (
      SELECT 1 FROM ap_inbox AS taken
      WHERE taken.actor_id = said.actor_id
        AND (
          (taken.activity_type = 'Undo' AND taken.object_id = said.activity_id)
          OR (taken.activity_type = 'Delete' AND said.activity_type = '${REPLY_ACTIVITY_TYPE}'
            AND taken.object_id = said.object_id)
        )
    )
  GROUP BY activity_type,
    CASE WHEN activity_type = '${REPLY_ACTIVITY_TYPE}' THEN NULL ELSE actor_id END,
    object_id`;

export interface InteractionCount {
  readonly kind: InboxInteraction['kind'];
  readonly about: string | null;
  readonly count: number;
}

const INTERACTION_KINDS: Readonly<Record<string, InboxInteraction['kind']>> = {
  Like: 'like',
  Announce: 'boost',
  [REPLY_ACTIVITY_TYPE]: 'reply',
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

  /** The logged replies whose note's id has this `/replies/` key. */
  listRepliesByKey(key: string): InboxActivity[];

  listInteractionsSince(since: string): InboxInteraction[];

  listLatestInteractions(limit: number): LatestInteraction[];

  countInteractionsSince(since: string): InteractionCount[];
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
    interactionsSince: db.prepare(`${INTERACTIONS} ORDER BY received_at`),
    latestInteractions: db.prepare(`${INTERACTIONS} ORDER BY received_at DESC LIMIT ?`),
    interactionCounts: db.prepare(`
      SELECT activity_type, about, COUNT(*) AS count FROM (${INTERACTIONS})
      GROUP BY activity_type, about
    `),
  };
  return {
    countInboxActivities() {
      return readCount(statements.countInboxActivities);
    },

    listInboxActivities(options = {}) {
      return allRows(
        statements.listInboxActivities,
        toInboxActivity,
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      );
    },

    logInboxActivity(activity) {
      const logged = getRow(
        statements.logInboxActivity,
        toInboxActivity,
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
      );
      if (logged === undefined) {
        throw new Error(`The activity "${activity.activityType}" was not written to the log.`);
      }
      written(activityWrite(logged));
      return logged;
    },

    deleteInboxActivity(id) {
      const deleted = getRow(statements.deleteInboxActivity, toInboxActivity, id);
      if (deleted === undefined) return false;
      written(activityWrite(deleted));
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
      return readCount(statements.countReplies);
    },

    listReplies(options = {}) {
      return allRows(
        statements.listReplies,
        toInboxActivity,
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      );
    },

    countRepliesTo(objectId) {
      return readCount(statements.countRepliesTo, objectId);
    },

    listRepliesTo(objectId, options = {}) {
      return allRows(
        statements.listRepliesTo,
        toInboxActivity,
        objectId,
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      );
    },

    listActivitiesAbout(objectIds) {
      if (objectIds.length === 0) return [];

      // Prepared here rather than beside the others because the number of
      // placeholders is the number of ids: a conversation asks about the post,
      // then about the notes that answered it, and neither count is known when
      // the statements are built.
      const placeholders = objectIds.map(() => '?').join(', ');
      return allRows(
        db.prepare(
          `SELECT * FROM ap_inbox
           WHERE object_id IN (${placeholders}) OR in_reply_to IN (${placeholders})
           ORDER BY id ASC`,
        ),
        toInboxActivity,
        ...objectIds,
        ...objectIds,
      );
    },

    listRepliesByKey(key) {
      return allRows(statements.repliesByKey, toInboxActivity, key);
    },

    listInteractionsSince(since) {
      return allRows(
        statements.interactionsSince,
        (row) => {
          const kind = INTERACTION_KINDS[String(row['activity_type'])];
          return kind === undefined ? [] : [{ kind, receivedAt: String(row['received_at']) }];
        },
        since,
      ).flat();
    },

    listLatestInteractions(limit) {
      return allRows(
        statements.latestInteractions,
        (row) => {
          const kind = INTERACTION_KINDS[String(row['activity_type'])];
          return kind === undefined
            ? []
            : [
                {
                  kind,
                  actorId: String(row['actor_id']),
                  about: nullableText(row['about']),
                  receivedAt: String(row['received_at']),
                },
              ];
        },
        '',
        limit,
      ).flat();
    },

    countInteractionsSince(since) {
      return allRows(
        statements.interactionCounts,
        (row) => {
          const kind = INTERACTION_KINDS[String(row['activity_type'])];
          return kind === undefined
            ? []
            : [{ kind, about: nullableText(row['about']), count: Number(row['count']) }];
        },
        since,
      ).flat();
    },
  };
}

function toInboxActivity(row: Row): InboxActivity {
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
