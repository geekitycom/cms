import type { DatabaseSync } from 'node:sqlite';

import type { Clock } from '../util/clock.ts';

import { nullableText, oneOf } from './rows.ts';

/** Where a relay subscription stands (FEP-ae0c). */
export const RELAY_STATES = ['pending', 'accepted', 'rejected'] as const;

/**
 * One of {@link RELAY_STATES}.
 *
 * `pending` is a `Follow` that has gone out and not been answered — which may
 * take days, because a relay is allowed to hold one for a human to approve.
 * `accepted` is one the relay answered `Accept` to, and the only state the
 * site delivers to. `rejected` is one it answered `Reject` to, with whatever
 * it said in {@link Relay.reason}.
 */
export type RelayState = (typeof RELAY_STATES)[number];

/**
 * The site's subscription to one relay.
 *
 * The list of relays itself is a setting, and so lives in `site.json`; this is
 * the state of the handshake with each of them, which is operational rather
 * than editorial. Keyed by the inbox because that is the only thing known when the
 * `Follow` goes out: a relay's actor id is not learned until it answers.
 */
export interface Relay {
  /** The relay's inbox, which is what the site was given and what it delivers to. */
  readonly inboxId: string;
  /** The relay actor's id, once it has answered, and `null` until then. */
  readonly actorId: string | null;
  /** Where the subscription stands. */
  readonly state: RelayState;
  /** Why a `Reject` was a reject, when it gave a reason, or `null`. */
  readonly reason: string | null;
  /** The id of the `Follow` that was sent, which an `Accept` names. */
  readonly followId: string | null;
  /** When the site first subscribed, as an ISO 8601 instant. */
  readonly createdAt: string;
  /** When the subscription last moved — accepted, rejected, re-followed. */
  readonly updatedAt: string;
}

/** A {@link Relay} before the store has timed it. */
export type NewRelay = Omit<Relay, 'createdAt' | 'updatedAt'> & {
  createdAt?: string | undefined;
};

export interface RelayStore {
  /** Every relay subscription, oldest first, however it stands. */
  listRelays(): Relay[];
  /** One relay subscription by the inbox it was made to, or `undefined`. */
  getRelay(inboxId: string): Relay | undefined;
  /**
   * The subscription one `Follow` established, or `undefined`.
   *
   * This is how an `Accept` or a `Reject` arriving later finds the relay it
   * answers: the activity names the follow, and the follow names the record.
   */
  getRelayByFollow(followId: string): Relay | undefined;
  /**
   * Store a relay subscription, replacing whatever was known about that inbox
   * and leaving the original `createdAt` alone: a subscription that moves from
   * pending to accepted is the same subscription, and when it began is a fact
   * only the row remembers.
   */
  putRelay(relay: NewRelay): Relay;
  /** Forget a relay subscription. Returns `false` when there was nothing to forget. */
  deleteRelay(inboxId: string): boolean;
}

export function openRelayStore(db: DatabaseSync, clock: Clock): RelayStore {
  const statements = {
    listRelays: db.prepare('SELECT * FROM ap_relays ORDER BY created_at, inbox_id'),
    relayByInbox: db.prepare('SELECT * FROM ap_relays WHERE inbox_id = ?'),
    relayByFollow: db.prepare('SELECT * FROM ap_relays WHERE follow_id = ?'),
    putRelay: db.prepare(`
      INSERT INTO ap_relays (
        inbox_id, actor_id, state, reason, follow_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (inbox_id) DO UPDATE SET
        actor_id = excluded.actor_id,
        state = excluded.state,
        reason = excluded.reason,
        follow_id = excluded.follow_id,
        updated_at = excluded.updated_at
      RETURNING *
    `),
    deleteRelay: db.prepare('DELETE FROM ap_relays WHERE inbox_id = ?'),
  };
  return {
    listRelays() {
      return (statements.listRelays.all() as Record<string, unknown>[]).map(toRelay);
    },

    getRelay(inboxId) {
      const row = statements.relayByInbox.get(inboxId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : toRelay(row);
    },

    getRelayByFollow(followId) {
      const row = statements.relayByFollow.get(followId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : toRelay(row);
    },

    putRelay(relay) {
      const now = clock().toISOString();
      const row = statements.putRelay.get(
        relay.inboxId,
        relay.actorId,
        relay.state,
        relay.reason,
        relay.followId,
        relay.createdAt ?? now,
        now,
      ) as Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new Error(`The relay subscription to "${relay.inboxId}" was not written.`);
      }
      return toRelay(row);
    },

    deleteRelay(inboxId) {
      return statements.deleteRelay.run(inboxId).changes > 0;
    },
  };
}

function toRelay(row: Record<string, unknown>): Relay {
  return {
    inboxId: String(row['inbox_id']),
    actorId: nullableText(row['actor_id']),
    state: relayState(row['state']),
    reason: nullableText(row['reason']),
    followId: nullableText(row['follow_id']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

/**
 * A stored relay state, or `pending` for one this version does not know.
 *
 * Pending is the safe reading of an unknown state: a subscription this version
 * cannot make sense of is one it should not be delivering public posts to, and
 * Retry is on the screen for exactly that row.
 */
function relayState(value: unknown): RelayState {
  return oneOf(value, RELAY_STATES, 'pending');
}
