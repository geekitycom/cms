import type { Context } from '@fedify/fedify';
import { Activity, getTypeId, PUBLIC_COLLECTION, Update } from '@fedify/vocab';
import type { Recipient } from '@fedify/vocab';

import { readSiteSettings } from '../admin/settings.ts';
import type { AdminStore, Delivery, DeliveryStatus, Follower } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import { saveDocument } from '../content/save.ts';
import type { ContentStore } from '../content/store.ts';
import type { DocumentChange } from '../content/sync.ts';
import { documentContent } from '../content/writer.ts';
import { siteActor } from './actor.ts';
import {
  articleObjectId,
  isFederatedDocument,
  postCreateActivity,
  postDeleteActivity,
  postUpdateActivity,
} from './article.ts';
import type { FederationContextData, SiteFederation } from './federation.ts';
import { followerRecipient } from './followers.ts';
import { SITE_ACTOR_IDENTIFIER } from './keys.ts';
import { updateActivityId } from './paths.ts';
import { acceptedRelays, relayRecipient } from './relays.ts';

/** What one activity's delivery came to, recipient by recipient. */
export interface DeliveryReport {
  /** The activity that went out. */
  readonly activityId: string;
  /** `Create`, `Update` or `Delete`. */
  readonly activityType: string;
  /**
   * The ActivityStreams id of what it was about: a post, or the site's own
   * actor when the profile itself was what moved.
   */
  readonly objectId: string;
  /**
   * One row per follower and per accepted relay, as recorded. Empty when the
   * site has neither.
   */
  readonly deliveries: readonly Delivery[];
}

/** Where a delivery service reports what it could not do. `console` will do. */
export interface DeliveryLogger {
  warn(message: string): void;
}

/** What {@link createDeliveryService} needs. */
export interface CreateDeliveryServiceOptions {
  /** The site's federation object, which mints the ids and signs the requests. */
  federation: SiteFederation;
  /** Followers and the delivery log. */
  admin: AdminStore;
  /** The content index, which the dispatchers read through the context. */
  store: ContentStore;
  /** Config after defaults and environment overrides. */
  config: ResolvedConfig;
  /** Where failures are reported. Defaults to `console`. */
  logger?: DeliveryLogger | undefined;
}

/**
 * Sends a site's posts to its followers and its relays, and remembers how that
 * went.
 *
 * Deliveries run one after another on a queue of their own rather than at
 * once, because ActivityPub has no way of saying that a `Create` came before
 * the `Update` that follows it: a peer that receives them out of order keeps
 * the wrong version.
 */
export interface DeliveryService {
  /**
   * Consider one index change, and deliver whatever it implies. Resolves once
   * the change has been recorded in the file — not once the activity has been
   * delivered, which is what {@link DeliveryService.settled} is for.
   */
  handle(change: DocumentChange): Promise<void>;
  /**
   * Tell the followers that the site's own profile has moved: an `Update`
   * whose object is the actor, which is how a peer learns that the name, the
   * summary or the avatar it cached is out of date.
   *
   * `undefined` when the site has no followers and no accepted relay, in which
   * case nothing is built and nothing is recorded: there is no cached profile
   * anywhere to refresh.
   */
  updateActor(): Promise<DeliveryReport | undefined>;
  /**
   * Send one post as it now reads to every follower and every accepted relay
   * the site has.
   *
   * Not "send that activity again": the activity is built from the file at the
   * moment this is called (decision-9), so a follower whose server was down
   * ends up holding the post as it stands rather than the revision that failed
   * to reach it. Which activity that is follows the same rule a save does — a
   * published post no follower has been told about is a `Create` and is
   * stamped, a published post they have is an `Update`, a draft or a trashed
   * one is a `Delete` of a `Tombstone` — so a resend and an ordinary publish
   * produce the same shapes.
   *
   * `undefined` when there is nothing to send: no post answers to that slug,
   * or the post is one nobody outside the site has ever been told about and is
   * not published now, so there is neither a copy to withdraw nor anything to
   * announce.
   */
  resend(slug: string): Promise<DeliveryReport | undefined>;
  /** Resolve once every queued delivery has finished, however it finished. */
  settled(): Promise<void>;
}

/**
 * Build the delivery service for one site.
 *
 * doc-4's delivery table is the whole of the policy: a post that becomes
 * published is a `Create`, an edit to a published post is an `Update`, and a
 * post that stops being published — draft, trashed or deleted, which are one
 * thing from outside — is a `Delete` of a `Tombstone`.
 *
 * Nothing is delivered for a full scan. The boot scan reports a cold index as
 * a directory full of creations, so federating them would announce the whole
 * archive to every follower every time somebody deleted the database.
 */
export function createDeliveryService(options: CreateDeliveryServiceOptions): DeliveryService {
  const { federation, admin, store, config } = options;
  const logger = options.logger ?? console;

  /**
   * Whether a delivery is over by the time `sendActivity` resolves.
   *
   * With no queue it is: Fedify posts to each inbox and waits. With one, all
   * that is known is that the activity was accepted for delivery, and the
   * queue retries out of band without reporting back — which is the difference
   * between a `sent` row and a `queued` one.
   */
  const synchronous = config.federation.queue === null;

  // Deliveries are chained rather than run in parallel, and the chain never
  // rejects: a failure is recorded against the followers it happened to and
  // the next activity still goes out.
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task);
    chain = result.then(ignore, ignore);
    return result;
  }

  /** A context outside any request, which is where a delivery happens from. */
  function deliveryContext(): Context<FederationContextData> {
    return federation.createContext(new URL(config.baseUrl), { admin, store, config });
  }

  /**
   * Write `activitypub.published` into the post's file, and answer with the
   * document as it now reads.
   *
   * That one key is the whole of the record: it says the post has been
   * announced and when, which is what decides `Create` against `Update` and
   * what a resend needs. No id is minted — decision-13 makes the post's id its
   * permalink, so there is nothing to freeze — and an `activitypub.id` the
   * file already carries is left exactly where it is, because it is the name
   * the post's followers already hold.
   *
   * It is written through the same {@link saveDocument} the admin writes
   * through, which corrects the index in the same breath — so the watcher's
   * re-read of the file finds a hash that already matches and this write
   * federates nothing of its own.
   */
  async function stamp(document: Document): Promise<Document> {
    const existing = document.activitypub;
    const published = existing?.published ?? document.date ?? store.now().toISOString();
    if (existing?.published === published) return document;

    // The zone only matters for a date somebody wrote by hand with no offset;
    // `saveDocument` is what turns every date in the file into an instant.
    return await saveDocument({
      contentDir: config.contentDir,
      store,
      timezone: readSiteSettings(config.contentDir).timezone,
      path: document.path,
      content: {
        ...documentContent(document),
        activitypub: { ...existing, published },
      },
    });
  }

  /**
   * Fan one activity about one post out to the followers.
   *
   * What the activity was — its type, the object it named, the post's slug —
   * is written onto every outcome row rather than into a table of its own,
   * because the activity itself is not kept: it is rebuilt from the file
   * whenever it is wanted again (decision-9).
   */
  async function send(
    context: Context<FederationContextData>,
    activity: Activity,
    about: Document,
  ): Promise<DeliveryReport> {
    const activityId = activity.id?.href;
    if (activityId === undefined) {
      throw new TypeError('An activity cannot be delivered without an id.');
    }

    return await fanOut(context, activity, {
      activityId,
      activityType: typeNameOf(activity),
      objectId: articleObjectId(context, about).href,
      slug: about.slug,
    });
  }

  /**
   * Deliver one activity to every follower and every accepted relay, one inbox
   * at a time.
   *
   * Fedify's own `sendActivity(…, 'followers', …)` would reach the follower
   * inboxes in one call, but it answers `void`: there would be no way of
   * saying which follower did not get it, which is the thing decision-5
   * promised to record. So the recipients are grouped into the inboxes one
   * POST reaches — the instance shared inbox where followers publish one, and
   * a relay's own inbox — and each group's outcome is written against every
   * actor behind it.
   */
  async function fanOut(
    context: Context<FederationContextData>,
    activity: Activity,
    about: {
      activityId: string;
      activityType: string;
      objectId: string;
      /** The post it was about, or `null` for an activity about the actor. */
      slug: string | null;
    },
  ): Promise<DeliveryReport> {
    const deliveries: Delivery[] = [];

    for (const target of deliveryTargets(admin)) {
      let status: DeliveryStatus = synchronous ? 'sent' : 'queued';
      let error: string | null = null;

      try {
        await context.sendActivity(
          { identifier: SITE_ACTOR_IDENTIFIER },
          target.recipients,
          activity,
          // The object id keeps a post's activities in order per server, so a
          // follower cannot be shown an Update of something it has not been
          // told about yet.
          { preferSharedInbox: true, orderingKey: about.objectId },
        );
      } catch (thrown) {
        status = 'failed';
        error = messageOf(thrown);
        logger.warn(`Could not deliver ${about.activityId} to ${target.inboxId}: ${error}`);
      }

      for (const actorId of target.actorIds) {
        deliveries.push(
          admin.recordDelivery({
            ...about,
            actorId,
            inboxId: target.inboxId,
            status,
            error,
          }),
        );
      }
    }

    return {
      activityId: about.activityId,
      activityType: about.activityType,
      objectId: about.objectId,
      deliveries,
    };
  }

  return {
    async handle(change) {
      // A full scan is a rebuild of the index, not news about the site.
      if (change.origin === 'scan') return;

      const now = store.now();
      const before = federatedOrUndefined(change.previous, now);
      const after = federatedOrUndefined(change.next, now);
      if (before === undefined && after === undefined) return;

      const context = deliveryContext();

      if (after === undefined) {
        // Unpublished, trashed or deleted; `before` is the post as it last
        // stood, and the only version there is to build a Tombstone from.
        if (before === undefined) return;
        const deleted = new Date().toISOString();
        queue(() => send(context, postDeleteActivity(context, before, deleted), before));
        return;
      }

      {
        const stamped = await stamp(after);

        if (before === undefined) {
          queue(() => send(context, postCreateActivity(context, stamped), stamped));
          return;
        }

        // Almost always the same id, because the stamped one follows the post
        // through a rename. When it is not — a post federated before this
        // version, renamed since — the old object is withdrawn rather than
        // left standing under an id nothing answers to any more.
        const previousId = articleObjectId(context, before).href;
        if (previousId === articleObjectId(context, stamped).href) {
          queue(() => send(context, postUpdateActivity(context, stamped), stamped));
          return;
        }

        const deleted = new Date().toISOString();
        queue(() => send(context, postDeleteActivity(context, before, deleted), before));
        queue(() => send(context, postCreateActivity(context, stamped), stamped));
      }
    },

    async updateActor() {
      // Building the actor loads — and on a cold database generates — the key
      // pairs, so a site with nowhere to send a profile update does not pay
      // for one. A relay counts: it is holding a copy of the profile too.
      if (deliveryTargets(admin).length === 0) return undefined;

      return await enqueue(async () => {
        const context = deliveryContext();
        const actorId = context.getActorUri(SITE_ACTOR_IDENTIFIER);
        const actor = await siteActor(context, SITE_ACTOR_IDENTIFIER, {
          settings: readSiteSettings(config.contentDir),
          baseUrl: config.baseUrl,
        });

        // The revision is the moment rather than a hash of the profile: an
        // avatar removed and put back is the same profile twice, and both
        // times the followers have to be told rather than recognise an id
        // they have already seen and skip it.
        const activityId = updateActivityId(actorId, new Date().toISOString());
        const activity = new Update({
          id: activityId,
          actor: actorId,
          object: actor,
          to: PUBLIC_COLLECTION,
          cc: context.getFollowersUri(SITE_ACTOR_IDENTIFIER),
        });

        return await fanOut(context, activity, {
          activityId: activityId.href,
          activityType: 'Update',
          // The object is the actor, not a post, and there is no slug to
          // record: that is what keeps an actor Update out of the federation
          // screen's per-post delivery table, which is built from the posts
          // the content index holds.
          objectId: actorId.href,
          slug: null,
        });
      }).catch((thrown: unknown) => {
        // A profile update is a side effect of saving the settings, and losing
        // it must not lose the save.
        logger.warn(`The actor update could not be delivered: ${messageOf(thrown)}`);
        return undefined;
      });
    },

    async resend(slug) {
      const document = postBySlug(store, slug);
      if (document === undefined) return undefined;

      // Read before the queue rather than inside it, so a post with nothing to
      // send answers `undefined` rather than joining a queue to find that out.
      const published = isFederatedDocument(document, store.now());
      const announced = (document.activitypub?.published ?? '') !== '';
      if (!published && !announced) return undefined;

      return await enqueue(async () => {
        const context = deliveryContext();

        if (!published) {
          // A draft, a trashed post, or one re-dated into the future: every
          // one of them is gone as far as a follower is concerned, and the
          // file still carries the id their copy is filed under.
          return await send(
            context,
            postDeleteActivity(context, document, new Date().toISOString()),
            document,
          );
        }

        const stamped = await stamp(document);
        if (!announced) {
          return await send(context, postCreateActivity(context, stamped), stamped);
        }

        // The moment rather than the content hash, which is what a save uses:
        // the point of a resend is that the followers hear about a revision
        // they have already been sent and ignored, or never received at all,
        // and an activity id a peer has seen is one it is entitled to drop.
        return await send(
          context,
          postUpdateActivity(context, stamped, new Date().toISOString()),
          stamped,
        );
      });
    },

    settled() {
      return chain.then(ignore);
    },
  };

  /**
   * Put one delivery on the queue and stop caring about its result.
   *
   * Nothing is waiting for a delivery that a change set off, so a rejection
   * here has nowhere to go but the log; the per-follower failures are already
   * in the database by the time one gets this far.
   */
  function queue(task: () => Promise<unknown>): void {
    enqueue(task).catch((thrown: unknown) => {
      logger.warn(`A delivery failed: ${messageOf(thrown)}`);
    });
  }
}

/**
 * One inbox a POST goes to, and who is behind it.
 *
 * The unit a fan-out works in. A follower group and a relay are the same thing
 * from here — an inbox, the recipients Fedify addresses it with, and the actors
 * whose delivery rows the outcome is written to — which is what lets a relay
 * be recorded like a follower without pretending to be one.
 */
export interface DeliveryTarget {
  /** The inbox one POST reaches: a shared inbox, a personal one, or a relay's. */
  readonly inboxId: string;
  /** What Fedify is handed to address it. */
  readonly recipients: Recipient[];
  /** Whose outcome rows this delivery writes: the followers, or the relay. */
  readonly actorIds: readonly string[];
}

/**
 * Everywhere one public activity goes: the followers, grouped by the inbox
 * they share, and every accepted relay.
 *
 * A relay is one target of its own rather than a member of a group, because it
 * is one inbox with one actor behind it and no shared inbox to fold into. A
 * pending or rejected relay is not here at all — {@link acceptedRelays} is
 * where that rule lives.
 */
export function deliveryTargets(admin: AdminStore): DeliveryTarget[] {
  const targets: DeliveryTarget[] = [];

  for (const [inboxId, members] of groupByInbox(admin.listFollowers())) {
    targets.push({
      inboxId,
      recipients: members.map(followerRecipient),
      actorIds: members.map((member) => member.actorId),
    });
  }

  for (const relay of acceptedRelays(admin)) {
    targets.push({
      inboxId: relay.inboxId,
      recipients: [relayRecipient(relay)],
      // The relay's own id, so its outcomes sit in the same table as a
      // follower's and the screen can find them. It has one by the time it is
      // accepted; the inbox is the fallback for a record from somewhere else.
      actorIds: [relay.actorId ?? relay.inboxId],
    });
  }

  return targets;
}

/**
 * Followers keyed by the inbox one POST to which reaches them: the instance's
 * shared inbox where it published one, and the follower's own where it did not.
 */
export function groupByInbox(followers: readonly Follower[]): Map<string, Follower[]> {
  const groups = new Map<string, Follower[]>();

  for (const follower of followers) {
    const inbox = follower.sharedInboxId ?? follower.inboxId;
    const group = groups.get(inbox);
    if (group === undefined) groups.set(inbox, [follower]);
    else group.push(follower);
  }

  return groups;
}

/**
 * The post a slug names, the trash included, or `undefined`.
 *
 * The index's slug lookup answers across both kinds and both states and takes
 * the newest, which is the post nine times out of ten. The federated list is
 * the fallback for the tenth — a page, or a live post of the same name,
 * standing in front of a trashed one — and it is the right fallback because a
 * post that was never announced is not one a resend has anything to say about.
 */
function postBySlug(store: ContentStore, slug: string): Document | undefined {
  const direct = store.getBySlug(slug);
  if (direct?.type === 'post') return direct;
  return store.listFederated().find((document) => document.slug === slug);
}

/** The document, when it is one this site federates, and `undefined` otherwise. */
function federatedOrUndefined(document: Document | undefined, now: Date): Document | undefined {
  if (document === undefined) return undefined;
  return isFederatedDocument(document, now) ? document : undefined;
}

/** An activity's short type name — `Create`, `Update`, `Delete` — from its type URI. */
function typeNameOf(activity: Activity): string {
  const typeId = getTypeId(activity);
  return typeId.hash === '' ? typeId.href : typeId.hash.slice(1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ignore(): void {
  // Deliberately empty: the chain must not reject, and a failure has already
  // been recorded against the followers it happened to.
}
