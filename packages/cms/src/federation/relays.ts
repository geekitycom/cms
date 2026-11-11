import { randomUUID } from 'node:crypto';

import type { Context } from '@fedify/fedify';
import { Accept, Follow, PUBLIC_COLLECTION, Reject, Undo } from '@fedify/vocab';
import type { Recipient } from '@fedify/vocab';

import type { AdminStore, DeliveryStatus, Relay } from '../store/admin-store.ts';
import type { ResolvedConfig } from '../config.ts';
import { holdOutbound } from '../dev-mode.ts';
import type { ConversationSite } from '../comments/conversation.ts';
import type { CitedPageReader } from '../content/citation.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { SITE } from '../site/namespace.ts';
import { primaryUser } from '../site/users.ts';
import type { User } from '../site/users.ts';
import { messageOf, oneLineMessageOf } from '../util/errors.ts';
import { createSerialQueue } from '../util/queue.ts';
import { actorId, senderKeyPairs } from './actor.ts';
import type { FederationContextData, SiteFederation } from './federation.ts';
import { isDuplicateDelivery } from './outbox-observer.ts';
import { sendWithinDeadline } from './send-deadline.ts';

const RELAY_FOLLOW_FRAGMENT = '#relay-follow/';

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
  store: FederationContextData['store'];
  /** Config after defaults and environment overrides. */
  config: ResolvedConfig;
  settings: SettingsRegistry;
  /** What the federation context carries for the inbox; nothing here calls it. */
  actorProfiles: FederationContextData['actorProfiles'];
  /** What the federation context carries for the post objects. */
  cited: (site: ConversationSite) => CitedPageReader;
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
   * undone. Called at boot and after every save of the settings. It waits
   * behind subscription changes already under way, reads the list and the
   * records only then, and resolves once its own changes are made.
   *
   * A listed relay whose record was lost — a rebuilt database, a restored
   * content directory — is followed again, which is what makes the file the
   * source and the records derivable from it.
   */
  sync(): Promise<RelaySyncReport>;
  /**
   * Send the `Follow` again for one pending relay, under a fresh id. This is
   * the Retry on the federation screen: a relay may have been down, or may
   * have lost the subscription.
   *
   * A relay that has answered is returned as it stands and sent nothing: an
   * accepted one would stop receiving posts until it accepted again, and a
   * rejected one has already said no. `undefined` when the settings do not
   * list the relay or there is no subscription to it.
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
  const { federation, admin, store, config, settings } = options;
  const logger = options.logger ?? console;
  const synchronous = config.federation.queue === null;

  // Each change is decided here as well as made here: a decision read from
  // records an earlier change has not written yet follows a relay the list
  // has since dropped, or brings back one whose Undo just went out.
  const subscriptions = createSerialQueue();

  /** A context outside any request, which is where a follow is sent from. */
  async function relayContext(): Promise<Context<FederationContextData>> {
    const site = await settings.values(SITE);
    return federation.createContext(new URL(config.baseUrl), {
      admin,
      store,
      config,
      settings,
      actorProfiles: options.actorProfiles,
      site,
      cited: options.cited(site),
    });
  }

  /**
   * Who subscribes to a relay: the site's first account.
   *
   * A relay subscription is an instance-wide agreement — it boosts everything
   * public this site sends, whoever wrote it — and with every user an actor
   * there is no site actor left to make one. The first account is the one actor
   * that can be chosen without asking, and it is the account a one-person blog
   * has anyway. `undefined` before anybody has signed up, and then nothing is
   * sent: a site in first-run setup has no identity to sign with.
   */
  function subscriber(): User | undefined {
    return primaryUser(config.dataDir);
  }

  /**
   * Send one activity to one relay inbox.
   *
   * The key that signs the request is the subscriber's whether or not the
   * relay has answered yet; see {@link relayRecipient} for what stands in for
   * the id until it has.
   */
  async function send(
    context: Context<FederationContextData>,
    user: User,
    relay: Relay,
    activity: Follow | Undo,
  ): Promise<'held' | 'sent'> {
    const activityType = activity instanceof Follow ? 'Follow' : 'Undo';
    const activityId = activity.id?.href ?? '';
    if (
      await holdOutbound(settings, config, {
        kind: 'activitypub',
        what: `${activityType} ${activityId}`,
        to: [relay.inboxId],
      })
    ) {
      return 'held';
    }
    const record = (status: DeliveryStatus, error: string | null): void => {
      admin.recordDelivery({
        activityId,
        activityType,
        objectId: activity.objectId?.href ?? '',
        slug: null,
        actorId: relay.actorId ?? relay.inboxId,
        inboxId: relay.inboxId,
        status,
        error,
      });
    };
    if (!synchronous) record('queued', null);
    try {
      await sendWithinDeadline(
        config,
        relay.inboxId,
        context.sendActivity(await senderKeyPairs(context, user), relayRecipient(relay), activity, {
          // A relay has one inbox and no shared one, and its activities are about
          // the subscription rather than about any post, so they are ordered
          // against each other rather than against a post's Create.
          orderingKey: relay.inboxId,
        }),
      );
    } catch (thrown) {
      if (!isDuplicateDelivery(thrown)) {
        record('failed', messageOf(thrown));
        throw thrown;
      }
    }
    if (synchronous) record('sent', null);
    return 'sent';
  }

  /**
   * Follow one relay: write the record first, then send the `Follow`.
   *
   * The record is written before the activity goes out, not after, so an
   * `Accept` that arrives while the POST is still in flight — a fast relay,
   * a synchronous test — finds something to mark accepted.
   */
  async function follow(relay: Relay): Promise<Relay> {
    const context = await relayContext();
    const user = subscriber();
    if (user === undefined) {
      logger.warn(
        `Could not follow the relay at ${relay.inboxId}: the site has no accounts, ` +
          'and decision-14 makes a user the actor a subscription is made by.',
      );
      return admin.putRelay({ ...relay, reason: 'The site has no account to subscribe with.' });
    }
    const id = actorId(context, user);
    const followId = new URL(`${RELAY_FOLLOW_FRAGMENT}${randomUUID()}`, id);

    const stored = admin.putRelay({
      inboxId: relay.inboxId,
      actorId: relay.actorId,
      state: 'pending',
      reason: null,
      followId: followId.href,
      createdAt: relay.createdAt,
    });

    try {
      const outcome = await send(
        context,
        user,
        stored,
        new Follow({
          id: followId,
          actor: id,
          // The literal Public collection, expanded, which is what FEP-ae0c
          // says a relay looks for and what tells it this is a subscription
          // rather than somebody following an account.
          object: PUBLIC_COLLECTION,
        }),
      );
      if (outcome === 'held') {
        return noteWhilePending(
          stored,
          'Not sent: the site is in dev mode. Retry once it is live.',
        );
      }
    } catch (thrown) {
      // The record stays pending with the reason on it: the relay may simply
      // have been down, and Retry is what the screen offers for that.
      logger.warn(`Could not follow the relay at ${stored.inboxId}: ${oneLineMessageOf(thrown)}`);
      return noteWhilePending(stored, messageOf(thrown));
    }

    return stored;
  }

  /**
   * Say why a follow went nowhere, unless the relay answered it meanwhile: its
   * `Accept` can arrive before the POST that carried the `Follow` has failed.
   */
  function noteWhilePending(stored: Relay, reason: string): Relay {
    const current = admin.getRelay(stored.inboxId);
    if (current?.state !== 'pending' || current.followId !== stored.followId) {
      return current ?? stored;
    }
    return admin.putRelay({ ...current, reason });
  }

  /**
   * Undo one relay's follow and forget it, unless dev mode holds the `Undo`:
   * then the record is kept as leaving, and the first sync once the site is
   * live sends it.
   */
  async function unfollow(relay: Relay): Promise<void> {
    const user = subscriber();
    if (relay.followId !== null && user !== undefined) {
      try {
        const context = await relayContext();
        const id = actorId(context, user);
        const outcome = await send(
          context,
          user,
          relay,
          new Undo({
            id: new URL(`#undo/${randomUUID()}`, id),
            actor: id,
            // The follow by id rather than embedded, which FEP-ae0c allows and
            // which is what the relay matched its own record on.
            object: new URL(relay.followId),
          }),
        );
        if (outcome === 'held') {
          admin.putRelay({
            ...relay,
            state: 'leaving',
            reason: 'Undo not sent: the site is in dev mode. It goes out once the site is live.',
          });
          return;
        }
      } catch (thrown) {
        // The subscription is gone from this side whatever the relay heard: a
        // relay that keeps sending is one whose activities land in the inbox
        // log, which is a nuisance rather than a leak, and re-adding it would
        // strand the record against a list that no longer names it.
        logger.warn(
          `Could not tell the relay at ${relay.inboxId} to stop: ${oneLineMessageOf(thrown)}`,
        );
      }
    }

    admin.deleteRelay(relay.inboxId);
  }

  async function attempt(change: () => Promise<unknown>): Promise<void> {
    try {
      await change();
    } catch (thrown) {
      logger.warn(`A relay subscription failed: ${oneLineMessageOf(thrown)}`);
    }
  }

  return {
    sync() {
      return subscriptions.run(async () => {
        const listed = await settings.get(SITE.relays);
        const known = admin.listRelays();

        const recordOf = (inboxId: string): Relay | undefined =>
          known.find((relay) => relay.inboxId === inboxId);

        // A leaving relay listed again is followed again: its record no
        // longer says how the relay last answered, so the site asks again.
        const followed = listed.filter((inboxId) => {
          const record = recordOf(inboxId);
          return record === undefined || record.state === 'leaving';
        });
        const leaving = known.filter((relay) => !listed.includes(relay.inboxId));

        for (const inboxId of followed) {
          const at = config.now().toISOString();
          await attempt(() =>
            follow(
              recordOf(inboxId) ?? {
                inboxId,
                actorId: null,
                state: 'pending',
                reason: null,
                followId: null,
                createdAt: at,
                updatedAt: at,
              },
            ),
          );
        }
        for (const relay of leaving) await attempt(() => unfollow(relay));

        return { followed, unfollowed: leaving.map((relay) => relay.inboxId) };
      });
    },

    retry(inboxId) {
      return subscriptions.run(async () => {
        const relay = admin.getRelay(inboxId);
        const listed = await settings.get(SITE.relays);
        if (relay === undefined || !listed.includes(inboxId)) return undefined;
        if (relay.state !== 'pending') return relay;
        return await follow(relay);
      });
    },

    settled() {
      return subscriptions.settled();
    },
  };
}

/**
 * Mark the subscription an `Accept` answers as accepted, and record who the
 * relay turned out to be. `undefined` when it answers no follow this site
 * sent — the site follows nothing but relays, so that is a stray.
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
 * The answer has to come from the relay: the actor it recorded once it had
 * answered before, and until then an actor on the relay inbox's host. The
 * follow id is what FEP-ae0c says the answer names, so it is tried first.
 * After that the answer has to name some relay follow of this site, and a
 * relay that has answered before is recognised by its actor id, which covers
 * a re-follow whose answer echoes a stale id. Last, a single pending
 * subscription on the answering relay's own origin is taken as the one meant.
 * Two pending subscriptions on one host are left alone rather than guessed
 * between.
 */
export function relayAnswering(admin: AdminStore, activity: Accept | Reject): Relay | undefined {
  const actorId = activity.actorId?.href;
  if (actorId === undefined) return undefined;
  const answeredBy = (relay: Relay): boolean =>
    relay.actorId === null
      ? originOf(relay.inboxId) === originOf(actorId)
      : relay.actorId === actorId;

  const followId = activity.objectId?.href;
  if (followId === undefined) return undefined;
  const byFollow = admin.getRelayByFollow(followId);
  if (byFollow !== undefined) return answeredBy(byFollow) ? byFollow : undefined;
  if (!new URL(followId).hash.startsWith(RELAY_FOLLOW_FRAGMENT)) return undefined;

  const relays = admin.listRelays().filter(answeredBy);
  const byActor = relays.find((relay) => relay.actorId === actorId);
  if (byActor !== undefined) return byActor;

  const pending = relays.filter((relay) => relay.state === 'pending');
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
