import type { DatabaseSync } from 'node:sqlite';

import { countByStatus, nullableText, oneOf } from './rows.ts';

/** How one delivery of one activity to one follower ended. */
export const DELIVERY_STATUSES = ['sent', 'queued', 'failed'] as const;

/**
 * One of {@link DELIVERY_STATUSES}.
 *
 * `sent` is a POST the follower's server accepted. `queued` is one handed to
 * Fedify's outbox queue, which is as much as a site running with a queue can
 * know from the call: the queue retries out of band and does not report back.
 * `failed` is a delivery that threw, with the reason in the row.
 */
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * How one attempt to deliver one activity to one recipient ended, and what the
 * activity was.
 *
 * The whole of what SQLite keeps about anything the site has sent (decision-9).
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

/** A {@link Delivery} before the store has timed it. */
export type NewDelivery = Omit<Delivery, 'attemptedAt'> & {
  attemptedAt?: string | undefined;
};

export interface DeliveryStore {
  /**
   * Record how one delivery to one follower ended, replacing the previous
   * outcome for that pair: the table answers "where does this activity stand
   * with each follower", which a resend moves rather than adds to.
   */
  recordDelivery(delivery: NewDelivery): Delivery;
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
}

export function openDeliveryStore(db: DatabaseSync): DeliveryStore {
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
  };
  return {
    recordDelivery(delivery) {
      const row = statements.recordDelivery.get(
        delivery.activityId,
        delivery.activityType,
        delivery.objectId,
        delivery.slug,
        delivery.actorId,
        delivery.inboxId,
        delivery.status,
        delivery.error,
        delivery.attemptedAt ?? new Date().toISOString(),
      ) as Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new Error(
          `The delivery of "${delivery.activityId}" to "${delivery.actorId}" was not recorded.`,
        );
      }
      return toDelivery(row);
    },

    listDeliveries(activityId) {
      const rows = statements.listDeliveries.all(activityId) as Record<string, unknown>[];
      return rows.map(toDelivery);
    },

    countDeliveriesByStatus(activityId) {
      const rows = statements.countDeliveriesByStatus.all(activityId) as Record<string, unknown>[];
      return countByStatus(rows, DELIVERY_STATUSES, deliveryStatus);
    },

    lastDeliveryToInbox(inboxId) {
      const row = statements.lastDeliveryToInbox.get(inboxId) as
        Record<string, unknown> | undefined;
      return row === undefined ? undefined : toDelivery(row);
    },

    lastDeliveryToObject(objectId) {
      const row = statements.lastDeliveryToObject.get(objectId) as
        Record<string, unknown> | undefined;
      return row === undefined ? undefined : toDelivery(row);
    },
  };
}

function toDelivery(row: Record<string, unknown>): Delivery {
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
