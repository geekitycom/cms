import type { DatabaseSync } from 'node:sqlite';

import type { Clock } from '../util/clock.ts';

import {
  allRows,
  countByStatus,
  getRow,
  NO_LIMIT,
  nullableText,
  oneOf,
  readCount,
} from './rows.ts';
import type { ListPageOptions, Page, Row } from './rows.ts';

/** How one delivery of one activity to one follower ended. */
export const DELIVERY_STATUSES = ['sent', 'queued', 'retrying', 'failed'] as const;

/**
 * One of {@link DELIVERY_STATUSES}.
 *
 * `sent` is a POST the follower's server accepted. `queued` is one handed to
 * Fedify's outbox queue and not yet settled. `retrying` is one whose last
 * attempt failed, with that error, and which the queue will try again.
 * `failed` is a delivery Fedify gave up on, or one that threw before it
 * reached the queue, with the reason in the row.
 */
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * How one attempt to deliver one activity to one recipient ended, and what the
 * activity was.
 *
 * The whole of what SQLite keeps about anything the site has sent.
 * No payload goes with it: an activity is rebuilt from the post's file at the
 * moment somebody asks for it to go again, so storing the bytes that went out
 * last time would only be a second, staler answer to the same question. What
 * is left is a cache of outcomes, and a site that deletes its database loses
 * nothing but the record of how yesterday's delivery went.
 *
 * The activity's own columns are here rather than in a table of their own
 * because there is no longer anything else to put in one: they are what the
 * federation screen reads to say what went out and when.
 */
export interface Delivery {
  /** The id of the activity that was delivered. */
  readonly activityId: string;
  /** `Create`, `Update` or `Delete`. */
  readonly activityType: string;
  /**
   * The ActivityStreams id of what it was about: a post, or the site's own
   * actor when the profile itself was what moved.
   */
  readonly objectId: string;
  /**
   * The post's slug when the activity went out, or `null` for an activity
   * about no post — which is what an actor `Update` is.
   */
  readonly slug: string | null;
  /** Which follower or relay it was delivered to. */
  readonly actorId: string;
  /** The inbox actually used, which is the shared one when the follower has one. */
  readonly inboxId: string;
  /** How it went. */
  readonly status: DeliveryStatus;
  /** Why it failed, or `null`. */
  readonly error: string | null;
  /** When the attempt was made, as an ISO 8601 instant. */
  readonly attemptedAt: string;
}

export interface DeliveryOutcome {
  readonly activityId: string;
  readonly inbox: string;
  readonly status: DeliveryStatus;
  readonly error: string | null;
}

/** A {@link Delivery} before the store has timed it. */
export type NewDelivery = Omit<Delivery, 'attemptedAt'> & {
  attemptedAt?: string | undefined;
};

export interface SentActivity {
  readonly activityId: string;
  readonly activityType: string;
  readonly objectId: string;
  readonly slug: string | null;
  readonly lastAttemptedAt: string;
  readonly counts: Record<DeliveryStatus, number>;
}

/** What {@link DeliveryStore.searchDeliveries} narrows by. Every field given must match. */
export interface DeliverySearch {
  /** About any of these objects. */
  readonly objectIds?: readonly string[] | undefined;
  readonly activityId?: string | undefined;
  /** At any of these statuses. */
  readonly statuses?: readonly DeliveryStatus[] | undefined;
  readonly inboxId?: string | undefined;
  readonly actorId?: string | undefined;
}

const DELIVERY_SEARCH = `
  WHERE (:objectIds IS NULL OR object_id IN (SELECT value FROM json_each(:objectIds)))
    AND (:activityId IS NULL OR activity_id = :activityId)
    AND (:statuses IS NULL OR status IN (SELECT value FROM json_each(:statuses)))
    AND (:inboxId IS NULL OR inbox_id = :inboxId)
    AND (:actorId IS NULL OR actor_id = :actorId)`;

export interface DeliveryStore {
  /**
   * Record how one delivery to one follower ended, replacing the previous
   * outcome for that pair: the table answers "where does this activity stand
   * with each follower", which a resend moves rather than adds to.
   */
  recordDelivery(delivery: NewDelivery): Delivery;
  settleDeliveries(outcome: DeliveryOutcome): void;
  /** Every follower's outcome for one activity, in follower order. */
  listDeliveries(activityId: string): Delivery[];
  /** How many followers this activity stands at each status with. */
  countDeliveriesByStatus(activityId: string): Record<DeliveryStatus, number>;
  /**
   * The most recent delivery to one inbox, whichever activity it carried, or
   * `undefined` when nothing has ever gone there.
   *
   * Keyed by the inbox rather than by the actor because that is what a relay
   * has: it is not a follower, so there is no follower row to look its
   * outcomes up by, and the inbox is the thing the site was told to deliver to.
   */
  lastDeliveryToInbox(inboxId: string): Delivery | undefined;
  /**
   * The most recent delivery about one object — a post's ActivityStreams id,
   * or the site actor's — or `undefined` when nothing about it has ever gone
   * out.
   *
   * What the federation screen's per-post row is filled in from. Keyed by the
   * object rather than by the activity because a post is a series of
   * activities and the row is about the post: the newest outcome is the one
   * that says where the post currently stands with the fediverse.
   */
  lastDeliveryToObject(objectId: string): Delivery | undefined;
  /** Every object id a `Delete` was ever recorded going out for. */
  listDeletedObjectIds(): string[];
  countFailedDeliveriesSince(since: string): number;
  /** Every activity sent about any of these objects, newest first. */
  listSentActivitiesAbout(objectIds: readonly string[]): SentActivity[];
  /** The outcomes that match, newest attempt first, one page of them. */
  searchDeliveries(search: DeliverySearch, page?: ListPageOptions): Page<Delivery>;
}

export function openDeliveryStore(db: DatabaseSync, clock: Clock): DeliveryStore {
  const statements = {
    recordDelivery: db.prepare(`
      INSERT INTO ap_deliveries (
        activity_id, activity_type, object_id, slug,
        actor_id, inbox_id, status, error, attempted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (activity_id, actor_id) DO UPDATE SET
        activity_type = excluded.activity_type,
        object_id = excluded.object_id,
        slug = excluded.slug,
        inbox_id = excluded.inbox_id,
        status = excluded.status,
        error = excluded.error,
        attempted_at = excluded.attempted_at
      RETURNING *
    `),
    settleDeliveries: db.prepare(`
      UPDATE ap_deliveries SET status = ?, error = ?, attempted_at = ?
      WHERE activity_id = ? AND inbox_id = ?
    `),
    listDeliveries: db.prepare(`
      SELECT * FROM ap_deliveries WHERE activity_id = ? ORDER BY actor_id
    `),
    countDeliveriesByStatus: db.prepare(`
      SELECT status, COUNT(*) AS count FROM ap_deliveries WHERE activity_id = ? GROUP BY status
    `),
    lastDeliveryToInbox: db.prepare(`
      SELECT * FROM ap_deliveries WHERE inbox_id = ?
      ORDER BY attempted_at DESC, rowid DESC
      LIMIT 1
    `),
    lastDeliveryToObject: db.prepare(`
      SELECT * FROM ap_deliveries WHERE object_id = ?
      ORDER BY attempted_at DESC, rowid DESC
      LIMIT 1
    `),
    listDeletedObjectIds: db.prepare(`
      SELECT DISTINCT object_id FROM ap_deliveries WHERE activity_type = 'Delete' ORDER BY object_id
    `),
    countFailedDeliveriesSince: db.prepare(`
      SELECT COUNT(*) AS count FROM ap_deliveries WHERE status = 'failed' AND attempted_at >= ?
    `),
    listSentActivitiesAbout: db.prepare(`
      SELECT activity_id, activity_type, object_id, slug,
        MAX(attempted_at) AS last_attempted_at,
        json_group_object(status, count) AS counts
      FROM (
        SELECT activity_id, activity_type, object_id, slug, status,
          MAX(attempted_at) AS attempted_at, COUNT(*) AS count
        FROM ap_deliveries
        WHERE object_id IN (SELECT value FROM json_each(?))
        GROUP BY activity_id, status
      )
      GROUP BY activity_id
      ORDER BY last_attempted_at DESC, activity_id
    `),
    searchDeliveries: db.prepare(`
      SELECT * FROM ap_deliveries ${DELIVERY_SEARCH}
      ORDER BY attempted_at DESC, rowid DESC
      LIMIT :limit OFFSET :offset
    `),
    countDeliverySearch: db.prepare(
      `SELECT COUNT(*) AS count FROM ap_deliveries ${DELIVERY_SEARCH}`,
    ),
  };
  return {
    recordDelivery(delivery) {
      const recorded = getRow(
        statements.recordDelivery,
        toDelivery,
        delivery.activityId,
        delivery.activityType,
        delivery.objectId,
        delivery.slug,
        delivery.actorId,
        delivery.inboxId,
        delivery.status,
        delivery.error,
        delivery.attemptedAt ?? clock().toISOString(),
      );
      if (recorded === undefined) {
        throw new Error(
          `The delivery of "${delivery.activityId}" to "${delivery.actorId}" was not recorded.`,
        );
      }
      return recorded;
    },

    settleDeliveries(outcome) {
      statements.settleDeliveries.run(
        outcome.status,
        outcome.error,
        clock().toISOString(),
        outcome.activityId,
        outcome.inbox,
      );
    },

    listDeliveries(activityId) {
      return allRows(statements.listDeliveries, toDelivery, activityId);
    },

    countDeliveriesByStatus(activityId) {
      return countByStatus(
        statements.countDeliveriesByStatus.all(activityId),
        DELIVERY_STATUSES,
        deliveryStatus,
      );
    },

    lastDeliveryToInbox(inboxId) {
      return getRow(statements.lastDeliveryToInbox, toDelivery, inboxId);
    },

    lastDeliveryToObject(objectId) {
      return getRow(statements.lastDeliveryToObject, toDelivery, objectId);
    },

    listDeletedObjectIds() {
      return allRows(statements.listDeletedObjectIds, (row) => String(row['object_id']));
    },

    countFailedDeliveriesSince(since) {
      return readCount(statements.countFailedDeliveriesSince, since);
    },

    listSentActivitiesAbout(objectIds) {
      return allRows(statements.listSentActivitiesAbout, toSentActivity, JSON.stringify(objectIds));
    },

    searchDeliveries(search, page = {}) {
      const filter = {
        objectIds: search.objectIds === undefined ? null : JSON.stringify(search.objectIds),
        activityId: search.activityId ?? null,
        statuses: search.statuses === undefined ? null : JSON.stringify(search.statuses),
        inboxId: search.inboxId ?? null,
        actorId: search.actorId ?? null,
      };
      return {
        total: Number(statements.countDeliverySearch.get(filter)?.['count'] ?? 0),
        items: statements.searchDeliveries
          .all({ ...filter, limit: page.limit ?? NO_LIMIT, offset: page.offset ?? 0 })
          .map(toDelivery),
      };
    },
  };
}

function toSentActivity(row: Row): SentActivity {
  const counts = JSON.parse(String(row['counts'])) as Record<string, number>;
  return {
    activityId: String(row['activity_id']),
    activityType: String(row['activity_type']),
    objectId: String(row['object_id']),
    slug: nullableText(row['slug']),
    lastAttemptedAt: String(row['last_attempted_at']),
    counts: countByStatus(
      Object.entries(counts).map(([status, count]) => ({ status, count })),
      DELIVERY_STATUSES,
      deliveryStatus,
    ),
  };
}

function toDelivery(row: Row): Delivery {
  return {
    activityId: String(row['activity_id']),
    activityType: String(row['activity_type']),
    objectId: String(row['object_id']),
    slug: nullableText(row['slug']),
    actorId: String(row['actor_id']),
    inboxId: String(row['inbox_id']),
    status: deliveryStatus(row['status']),
    error: nullableText(row['error']),
    attemptedAt: String(row['attempted_at']),
  };
}

/**
 * A stored status, or `failed` for one this version does not know.
 *
 * An unreadable status is reported as the pessimistic one: an admin screen
 * showing a delivery as failed when it was not is a nuisance, and showing one
 * as sent when nobody knows is a lie.
 */
function deliveryStatus(value: unknown): DeliveryStatus {
  return oneOf(value, DELIVERY_STATUSES, 'failed');
}
