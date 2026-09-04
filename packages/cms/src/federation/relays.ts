import { randomUUID } from 'node:crypto';

import type { Context } from '@fedify/fedify';
import { Accept, Follow, PUBLIC_COLLECTION, Reject, Undo } from '@fedify/vocab';
import type { Recipient } from '@fedify/vocab';

import { readSiteSettings } from '../admin/settings.ts';
import type { AdminStore, Relay } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import type { ContentStore } from '../content/store.ts';
import type { FederationContextData, SiteFederation } from './federation.ts';
import { SITE_ACTOR_IDENTIFIER } from './keys.ts';

/** Where a relay reports what it could not do. `console` will do. */
export interface RelayLogger {
  warn(message: string): void;
}

/** What {@link createRelayService} needs. */
export interface CreateRelayServiceOptions {
  /** The site's federation object, which mints the ids and signs the requests. */
  federation: SiteFederation;
  /** The settings, which hold the relay list, and the subscription records. */
  admin: AdminStore;
  /** The content index, which the dispatchers read through the context. */
  store: ContentStore;
  /** Config after defaults and environment overrides. */
  config: ResolvedConfig;
  /** Where failures are reported. Defaults to `console`. */
  logger?: RelayLogger | undefined;
}

/** What one call to {@link RelayService.sync} did. */
export interface RelaySyncReport {
  /** The relays newly followed, because the list named them and nothing knew them. */
  readonly followed: readonly string[];
  /** The relays unfollowed, because the list stopped naming them. */
  readonly unfollowed: readonly string[];
}

/**
 * The site's half of the Mastodon relay protocol (FEP-ae0c).
 *
 * A relay is not a follower and is not stored as one: it is followed rather
 * than following, its subscription can be refused, and it has no profile worth
 * showing. What it shares with a follower is the only thing that matters to
 * the rest of the system — an inbox every public activity is delivered to —
 * and {@link relayRecipient} is where that likeness is spelled out.
 */
export interface RelayService {
  /**
   * Bring the subscriptions in line with the relay list in the settings: a
   * listed relay with no record is followed, a record no longer listed is
   * undone. Called at boot and after every save of the settings.
   *
   * A listed relay whose record was lost — a rebuilt database, a restored
   * content directory — is followed again, which is what makes the file the
   * source and the records derivable from it.
   */
  sync(): RelaySyncReport;
  /**
   * Send the `Follow` again for one relay, under a fresh id, and put its
   * record back to pending. This is the Retry on the federation screen: a
   * relay may have been down, or may have lost the subscription.
   */
  retry(inboxId: string): Promise<Relay | undefined>;
  /** Resolve once every queued `Follow` and `Undo` has finished, however it finished. */
  settled(): Promise<void>;
}

/**
 * One relay as the {@link Recipient} Fedify delivers to.
 *
 * The inbox stands in for the id until the relay has answered, because the
 * `Follow` goes out before the site knows what to call it: Fedify drops a
 * recipient with no id, so `null` would silently send nothing. The id is only
 * ever used to key the inbox and to build a collection synchronisation header
 * for a shared inbox, and a relay publishes no shared inbox — a relay *is* one
 * — so standing the inbox in for it costs the relay nothing.
 */
export function relayRecipient(relay: Relay): Recipient {
  return {
    id: new URL(relay.actorId ?? relay.inboxId),
    inboxId: new URL(relay.inboxId),
  };
}

/**
 * The relays a public activity is delivered to: the accepted ones, and only
 * those.
 *
 * A pending subscription has not been agreed to and a rejected one has been
 * refused; delivering to either would be posting into an inbox that has not
 * said it wants this, which is what the handshake exists to establish.
 */
export function acceptedRelays(admin: AdminStore): Relay[] {
  return admin.listRelays().filter((relay) => relay.state === 'accepted');
}

/**
 * Build the relay service for one site.
 *
 * FEP-ae0c is the whole of the protocol: a `Follow` whose object is the
 * literal Public collection, sent to the relay's inbox and signed the way any
 * other activity is; an `Accept` or a `Reject` back, which may take days
 * because a relay is allowed to hold a subscription for a human to approve;
 * and an `Undo` of that same `Follow` to leave.
 */
export function createRelayService(options: CreateRelayServiceOptions): RelayService {
  const { federation, admin, store, config } = options;
  const logger = options.logger ?? console;

  // Follows and undos are chained rather than run at once, for the reason
  // deliveries are: a relay that is told to unfollow before it has been told
  // to follow keeps the subscription. The chain never rejects.
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task);
    chain = result.then(ignore, ignore);
    return result;
  }

  /** A context outside any request, which is where a follow is sent from. */
  function relayContext(): Context<FederationContextData> {
    return federation.createContext(new URL(config.baseUrl), { admin, store, config });
  }

  /**
   * Send one activity to one relay inbox.
   *
   * The key that signs the request is the site actor's whether or not the
   * relay has answered yet; see {@link relayRecipient} for what stands in for
   * the id until it has.
   */
  async function send(
    context: Context<FederationContextData>,
    relay: Relay,
    activity: Follow | Undo,
  ): Promise<void> {
    await context.sendActivity(
      { identifier: SITE_ACTOR_IDENTIFIER },
      relayRecipient(relay),
      activity,
      {
        // A relay has one inbox and no shared one, and its activities are about
        // the subscription rather than about any post, so they are ordered
        // against each other rather than against a post's Create.
        orderingKey: relay.inboxId,
      },
    );
  }

  /**
   * Follow one relay: write the record first, then send the `Follow`.
   *
   * The record is written before the activity goes out, not after, so an
   * `Accept` that arrives while the POST is still in flight — a fast relay,
   * a synchronous test — finds something to mark accepted.
   */
  async function follow(relay: Relay): Promise<Relay> {
    const context = relayContext();
    const followId = new URL(
      `#relay-follow/${randomUUID()}`,
      context.getActorUri(SITE_ACTOR_IDENTIFIER),
    );

    const stored = admin.putRelay({
      inboxId: relay.inboxId,
      actorId: relay.actorId,
      state: 'pending',
      reason: null,
      followId: followId.href,
      createdAt: relay.createdAt,
    });

    try {
      await send(
        context,
        stored,
        new Follow({
          id: followId,
          actor: context.getActorUri(SITE_ACTOR_IDENTIFIER),
          // The literal Public collection, expanded, which is what FEP-ae0c
          // says a relay looks for and what tells it this is a subscription
          // rather than somebody following an account.
          object: PUBLIC_COLLECTION,
        }),
      );
    } catch (thrown) {
      // The record stays pending with the reason on it: the relay may simply
      // have been down, and Retry is what the screen offers for that.
      const message = messageOf(thrown);
      logger.warn(`Could not follow the relay at ${stored.inboxId}: ${message}`);
      return admin.putRelay({ ...stored, reason: message });
    }

    return stored;
  }

  /** Undo one relay's follow and forget it. */
  async function unfollow(relay: Relay): Promise<void> {
    if (relay.followId !== null) {
      try {
        const context = relayContext();
        await send(
          context,
          relay,
          new Undo({
            id: new URL(`#undo/${randomUUID()}`, context.getActorUri(SITE_ACTOR_IDENTIFIER)),
            actor: context.getActorUri(SITE_ACTOR_IDENTIFIER),
            // The follow by id rather than embedded, which FEP-ae0c allows and
            // which is what the relay matched its own record on.
            object: new URL(relay.followId),
          }),
        );
      } catch (thrown) {
        // The subscription is gone from this side whatever the relay heard: a
        // relay that keeps sending is one whose activities land in the inbox
        // log, which is a nuisance rather than a leak, and re-adding it would
        // strand the record against a list that no longer names it.
        logger.warn(`Could not tell the relay at ${relay.inboxId} to stop: ${messageOf(thrown)}`);
      }
    }

    admin.deleteRelay(relay.inboxId);
  }

  return {
    sync() {
      const listed = readSiteSettings(admin).relays;
      const known = admin.listRelays();

      const followed: string[] = [];
      const unfollowed: string[] = [];

      for (const inboxId of listed) {
        if (known.some((relay) => relay.inboxId === inboxId)) continue;
        followed.push(inboxId);
        queue(() =>
          follow({
            inboxId,
            actorId: null,
            state: 'pending',
            reason: null,
            followId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        );
      }

      for (const relay of known) {
        if (listed.includes(relay.inboxId)) continue;
        unfollowed.push(relay.inboxId);
        queue(() => unfollow(relay));
      }

      return { followed, unfollowed };
    },

    async retry(inboxId) {
      const relay = admin.getRelay(inboxId);
      if (relay === undefined) return undefined;
      return await enqueue(() => follow(relay));
    },

    settled() {
      return chain.then(ignore);
    },
  };

  /**
   * Put one subscription change on the queue and stop caring about its result.
   *
   * Nothing is waiting for the follow a settings save set off, so a rejection
   * here has nowhere to go but the log; a failed follow has already been
   * written to its record by then.
   */
  function queue(task: () => Promise<unknown>): void {
    enqueue(task).catch((thrown: unknown) => {
      logger.warn(`A relay subscription failed: ${messageOf(thrown)}`);
    });
  }
}

/**
 * Mark the subscription an `Accept` answers as accepted, and record who the
 * relay turned out to be. `undefined` when it answers no follow this site
 * sent — the site follows nothing but relays (doc-4), so that is a stray.
 *
 * A free function over the store rather than a method on the service: nothing
 * about it is queued or sent, and the inbox listener that calls it has the
 * store on its context and no service.
 */
export function acceptRelay(admin: AdminStore, activity: Accept): Relay | undefined {
  const relay = relayAnswering(admin, activity);
  if (relay === undefined) return undefined;
  return admin.putRelay({
    ...relay,
    actorId: activity.actorId?.href ?? relay.actorId,
    state: 'accepted',
    reason: null,
  });
}

/** The same for a `Reject`, which marks the relay rejected with its reason. */
export function rejectRelay(admin: AdminStore, activity: Reject): Relay | undefined {
  const relay = relayAnswering(admin, activity);
  if (relay === undefined) return undefined;
  return admin.putRelay({
    ...relay,
    actorId: activity.actorId?.href ?? relay.actorId,
    state: 'rejected',
    reason: rejectionReason(activity),
  });
}

/**
 * Match an `Accept` or a `Reject` to the subscription it answers.
 *
 * The follow id is what FEP-ae0c says the answer names, so it is tried first.
 * A relay that has answered before is then recognised by its actor id, which
 * covers a re-follow whose answer echoes a stale id. Last, a single pending
 * subscription on the answering relay's own origin is taken as the one meant:
 * a relay answering from the host its inbox is on is answering about that
 * inbox, and there is nothing else it could be about. Two pending
 * subscriptions on one host are left alone rather than guessed between.
 */
export function relayAnswering(admin: AdminStore, activity: Accept | Reject): Relay | undefined {
  const followId = activity.objectId?.href;
  if (followId !== undefined) {
    const byFollow = admin.getRelayByFollow(followId);
    if (byFollow !== undefined) return byFollow;
  }

  const actorId = activity.actorId?.href;
  if (actorId === undefined) return undefined;

  const relays = admin.listRelays();
  const byActor = relays.find((relay) => relay.actorId === actorId);
  if (byActor !== undefined) return byActor;

  const origin = originOf(actorId);
  if (origin === undefined) return undefined;
  const pending = relays.filter(
    (relay) => relay.state === 'pending' && originOf(relay.inboxId) === origin,
  );
  return pending.length === 1 ? pending[0] : undefined;
}

/** Why a `Reject` was a rejection, in the relay's own words, or `null`. */
function rejectionReason(activity: Reject): string | null {
  const summary = activity.summary?.toString() ?? activity.content?.toString();
  return summary === undefined || summary === '' ? null : summary;
}

/** A URL's origin, or `undefined` for something that is not one. */
function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ignore(): void {
  // Deliberately empty: the chain must not reject, and a failure has already
  // been logged and written to the record it happened to.
}
