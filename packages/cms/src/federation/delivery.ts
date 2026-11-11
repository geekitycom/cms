import { createHash } from 'node:crypto';

import type { Context } from '@fedify/fedify';
import { Activity, getTypeId, PUBLIC_COLLECTION } from '@fedify/vocab';
import type { Object as ActivityObject } from '@fedify/vocab';

import type { AdminStore, Delivery, DeliveryStatus } from '../store/admin-store.ts';
import { NO_LIMIT } from '../store/rows.ts';
import type { ResolvedConfig } from '../config.ts';
import { holdOutbound } from '../dev-mode.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { citationsOf } from '../content/citation.ts';
import type { CitedPage, CitedPageReader } from '../content/citation.ts';
import type { ConversationSite } from '../comments/conversation.ts';
import type { Document } from '../content/document.ts';
import { isWebUrl } from '../content/enclosure.ts';
import { postObjectId } from '../content/guids.ts';
import { isMigrated } from '../content/migrated.ts';
import { replyTarget } from '../content/post-type.ts';
import { addPublishedStamp, withDocumentWrites } from '../content/save.ts';
import type { IndexWriter } from '../content/store.ts';
import type { DocumentChange } from '../content/sync.ts';
import { visibilityOf } from '../content/visibility.ts';
import { SITE } from '../site/namespace.ts';
import { listUsers } from '../site/users.ts';
import type { User } from '../site/users.ts';
import { messageOf, oneLineMessageOf } from '../util/errors.ts';
import { createSerialQueue } from '../util/queue.ts';
import { authorNames } from '../content/authors.ts';
import { ActorUpdate, actorId, senderKeyPairs, userActor } from './actor.ts';
import {
  articleObjectId,
  documentAuthor,
  postCreateActivity,
  postDeleteActivity,
  postObject,
  postPinActivity,
  postUpdateActivity,
} from './article.ts';
import { isFederatedDocument } from '../content/served.ts';
import type { FederationContextData, SiteFederation } from './federation.ts';
import { citingActivity, repliedTo, undoActivity } from './citations.ts';
import {
  audienceTargets,
  citedAuthor,
  deliveryChange,
  deliveryRows,
  earlierTargets,
  fanOutTargets,
  objectTargets,
  pinChange,
  revisionStep,
  stampFor,
  wasAnnounced,
} from './delivery-plan.ts';
import type { ActivityAbout, DeliveryTarget, ObjectShape, Shape } from './delivery-plan.ts';
import { mentionedAccounts } from './handles.ts';
import { updateActivityId } from './paths.ts';
import { claimObjectId, readObjectIds, recordDeleted } from './object-ids.ts';
import { isDuplicateDelivery } from './outbox-observer.ts';
import { acceptedRelays } from './relays.ts';

/** What one activity's delivery came to, recipient by recipient. */
export interface DeliveryReport {
  /** The activity that went out. */
  readonly activityId: string;
  /** `Create`, `Update` or `Delete`. */
  readonly activityType: string;
  /**
   * The ActivityStreams id of what it was about: a post, or a user's own actor
   * when the profile itself was what moved.
   */
  readonly objectId: string;
  /**
   * One row per follower and per accepted relay, as recorded. Empty when the
   * author has no followers and the site has no relay.
   */
  readonly deliveries: readonly Delivery[];
  /** Whether dev mode held it, in which case nobody was sent anything. */
  readonly held: boolean;
}

export interface ResendRecipients {
  readonly actors: ReadonlySet<string>;
  readonly missedAnnouncement: boolean;
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
  store: FederationContextData['store'] & IndexWriter;
  /** Config after defaults and environment overrides. */
  config: ResolvedConfig;
  settings: SettingsRegistry;
  /** What the federation context carries for the inbox; nothing here calls it. */
  actorProfiles: FederationContextData['actorProfiles'];
  /** What the federation context carries for the post objects. */
  cited: (site: ConversationSite) => CitedPageReader;
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
   * Consider one index change, and queue whatever it implies. Resolves once
   * the activity is queued, not once it has been delivered or the post has
   * been stamped, which is what {@link DeliveryService.settled} is for.
   */
  handle(change: DocumentChange): Promise<void>;
  /**
   * Tell one user's followers that their profile has moved: an `Update` whose
   * object is their actor, which is how a peer learns that the name, the
   * summary or the avatar it cached is out of date.
   *
   * `undefined` when that user has no followers and the site has no accepted
   * relay, in which case nothing is built and nothing is recorded: there is no
   * cached profile anywhere to refresh.
   */
  updateActor(user: User): Promise<DeliveryReport | undefined>;
  /**
   * Send one post as it now reads to every follower and every accepted relay
   * the site has.
   *
   * Not "send that activity again": the activity is built from the post as it
   * stands when the resend's turn in the delivery queue comes, so a follower
   * whose server was down
   * ends up holding the post as it stands rather than the revision that failed
   * to reach it. Which activity that is follows the same rule a save does — a
   * published post no follower has been told about is a `Create` and is
   * stamped, a published post they have is an `Update`, a draft or a trashed
   * one is a `Delete` of a `Tombstone` — so a resend and an ordinary publish
   * produce the same shapes.
   *
   * `undefined` when there is nothing to send: no post is at that content path,
   * or the post is one nobody outside the site has ever been told about and is
   * not published now, so there is neither a copy to withdraw nor anything to
   * announce.
   *
   * Recipients in `to` that missed the announcement are sent it again rather
   * than an `Update`, which a peer drops for a post it never stored.
   */
  resend(path: string, to?: ResendRecipients): Promise<DeliveryReport | undefined>;
  /**
   * Send `actors` the pin change for one post as it now stands: the `Add` to
   * its author's featured collection when it is pinned, the `Remove` when it
   * is not. `undefined` when no published post is at that content path.
   */
  resendPin(path: string, actors: ReadonlySet<string>): Promise<DeliveryReport | undefined>;
  /**
   * Bring the followers' copies of the posts that cite a page up to date with
   * its newly stored context: an `Update` for each served, announced post
   * whose object now reads differently from the one they were last sent.
   * Queued like a save's own delivery.
   */
  citedPageStored(target: string, previous: CitedPage | undefined): void;
  /** Resolve once every queued delivery has finished, however it finished. */
  settled(): Promise<void>;
}

/**
 * Build the delivery service for one site.
 *
 * The delivery policy is simple: a post that becomes
 * published is a `Create`, an edit to a published post is an `Update`, and a
 * post that stops being published — draft, trashed or deleted, which are one
 * thing from outside — is a `Delete` of a `Tombstone`.
 *
 * Nothing is delivered for a full scan. The boot scan reports a cold index as
 * a directory full of creations, so federating them would announce the whole
 * archive to every follower every time somebody deleted the database.
 */
export function createDeliveryService(options: CreateDeliveryServiceOptions): DeliveryService {
  const { federation, admin, store, config, settings } = options;
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

  const deliveryQueue = createSerialQueue();

  /** A context outside any request, which is where a delivery happens from. */
  async function deliveryContext(cited?: CitedPageReader): Promise<Context<FederationContextData>> {
    const site = await settings.values(SITE);
    return federation.createContext(new URL(config.baseUrl), {
      admin,
      store,
      config,
      settings,
      actorProfiles: options.actorProfiles,
      site,
      cited: cited ?? options.cited(site),
    });
  }

  const sentThisProcess = new Map<string, string>();

  /**
   * Add {@link stampFor}'s `activitypub.published` to the post's file.
   *
   * The stamp lands after the save that set it off has answered, so it goes
   * into the post as the index holds it now, which keeps an edit saved
   * meanwhile: that edit's own change is queued behind this one and finds the
   * stamp. A file that no longer reads as the indexed version is left alone,
   * because no change for what it holds has been queued yet, and the one that
   * will be announces it itself. So is a post no longer at that path.
   *
   * No id is minted — the post's id is its permalink, so there is nothing to
   * freeze — and an `activitypub.id` the file already carries is left exactly
   * where it is, because it is the name the post's followers already hold.
   *
   * The write corrects the index in the same breath, so the watcher's re-read
   * of the file finds a hash that already matches and this write federates
   * nothing of its own.
   */
  async function stamp(path: string): Promise<void> {
    await withDocumentWrites(config.contentDir, async () => {
      const document = store.getByPath(path);
      if (document === undefined) return;
      const published = stampFor(document, store.now());
      if (published === undefined) return;

      await addPublishedStamp({
        contentDir: config.contentDir,
        store,
        path,
        published,
        hash: document.hash,
      });
    });
  }

  /**
   * The version the followers were told about, when an announce queued ahead
   * of this change stamped the post after the change was seen. The edit is
   * then an `Update` of what they hold, not a second `Create`.
   */
  function announcedSince(previous: Document | undefined, after: Document): Document | undefined {
    if (previous === undefined || wasAnnounced(previous)) return undefined;
    if (!isFederatedDocument(previous, store.now())) return undefined;
    const current = store.getByPath(after.path);
    return current !== undefined && wasAnnounced(current) ? previous : undefined;
  }

  function requireSender(context: Context<FederationContextData>, document: Document): User {
    const author = documentAuthor(context, document);
    if (author === undefined) {
      throw new Error(
        `The post "${document.slug}" cannot be delivered: the site has no accounts, ` +
          'and decision-14 makes a user the actor a post is announced by.',
      );
    }
    return author;
  }

  /** Fan one activity about one post out to the followers. */
  async function send(
    context: Context<FederationContextData>,
    activity: Activity,
    about: Document,
    also: readonly DeliveryTarget[] = [],
    to?: ReadonlySet<string>,
  ): Promise<DeliveryReport> {
    const activityId = activity.id?.href;
    if (activityId === undefined) {
      throw new TypeError('An activity cannot be delivered without an id.');
    }
    const activityType = typeNameOf(activity);
    const objectId = articleObjectId(context, about).href;
    const earlier = reachesEarlierRecipients(activityType)
      ? admin.searchDeliveries({ objectIds: [objectId] }, { limit: NO_LIMIT }).items
      : [];
    return await fanOut(
      context,
      requireSender(context, about),
      activity,
      { activityId, activityType, objectId, slug: about.slug },
      also,
      { relays: visibilityOf(about) === 'public', to, earlier },
    );
  }

  /**
   * What a version of a post is to a peer: the `Like` or `Announce` of the
   * fediverse object it cites, or the object it is, with the
   * status it replies to when it answers one. Asked of the post as
   * it reads now, so a target that stops answering makes it the object again.
   */
  async function shapeOf(
    context: Context<FederationContextData>,
    document: Document,
  ): Promise<Shape> {
    const actor = requireSender(context, document).username;
    const citing = await citingActivity(context, document);
    if (citing !== undefined) {
      return { kind: 'citing', id: citing.activity.id?.href ?? '', actor, citing };
    }
    return {
      kind: 'object',
      id: articleObjectId(context, document).href,
      actor,
      replyTo: await repliedTo(context, document),
    };
  }

  /**
   * Tell the peers a post is out: its `Create`, or its `Like` or `Announce`.
   *
   * The post is stamped only once its delivery rows are written and the
   * activity is in Fedify's hands. A fan-out that throws or that dev mode
   * holds leaves no stamp, so the next save or resend announces it again
   * rather than sending an `Update` of something no follower holds.
   */
  async function announce(
    context: Context<FederationContextData>,
    document: Document,
    shape: Shape,
    to?: ReadonlySet<string>,
  ): Promise<DeliveryReport> {
    let report: DeliveryReport;
    if (shape.kind === 'object') {
      const id = await claimObjectId(config.contentDir, postObjectId(document, config.baseUrl));
      report = await sendAndRecordObject(
        context,
        postCreateActivity(context, document, shape.replyTo),
        document,
        { ...shape, id },
        to,
      );
    } else {
      report = await send(
        context,
        shape.citing.activity,
        document,
        citedAuthor(shape.citing.author),
        to,
      );
    }
    if (!report.held) await stamp(document.path);
    return report;
  }

  /** Take a post back: a `Delete` of its object, or an `Undo` of its `Like` or `Announce`. */
  async function withdraw(
    context: Context<FederationContextData>,
    document: Document,
    shape: Shape,
    to?: ReadonlySet<string>,
  ): Promise<DeliveryReport> {
    const deleted = store.now().toISOString();
    if (shape.kind === 'object') {
      // Recorded before the first POST rather than after the last, so a crash
      // in between never leaves a tombstoned id looking reusable. A Delete
      // held in dev mode or sent to nobody is recorded too, which costs the
      // post a revision it did not strictly need when it comes back.
      await recordDeleted(config.contentDir, shape.id);
      return await send(
        context,
        postDeleteActivity(context, document, deleted),
        document,
        postTargets(document, shape),
        to,
      );
    }
    return await send(
      context,
      undoActivity(shape.citing.activity, deleted),
      document,
      citedAuthor(shape.citing.author),
      to,
    );
  }

  function wasDeleted(objectId: string): boolean {
    return readObjectIds(config.contentDir).deleted.includes(objectId);
  }

  function postTargets(document: Document, shape: ObjectShape): DeliveryTarget[] {
    return objectTargets(
      shape.replyTo?.author,
      mentionedAccounts(document.body, config.contentDir),
    );
  }

  async function revise(
    context: Context<FederationContextData>,
    document: Document,
    shape: ObjectShape,
    revision?: string,
    to?: ReadonlySet<string>,
  ): Promise<DeliveryReport> {
    return await sendAndRecordObject(
      context,
      postUpdateActivity(context, document, revision, shape.replyTo),
      document,
      shape,
      to,
    );
  }

  function contentRevision(hash: string): string {
    return hash.slice(0, 16);
  }

  async function sendAndRecordObject(
    context: Context<FederationContextData>,
    activity: Activity,
    document: Document,
    shape: ObjectShape,
    to?: ReadonlySet<string>,
  ): Promise<DeliveryReport> {
    const report = await send(context, activity, document, postTargets(document, shape), to);
    const object = await activity.getObject();
    if (object !== null) sentThisProcess.set(shape.id, await fingerprint(object));
    return report;
  }

  /**
   * Deliver one activity to every follower and every accepted relay, one inbox
   * at a time.
   *
   * Fedify's own `sendActivity(…, 'followers', …)` would reach the follower
   * inboxes in one call, but it answers `void`: there would be no way of
   * saying which follower did not get it, which is the thing the delivery log
   * records. So the recipients are grouped into the inboxes one
   * POST reaches — the instance shared inbox where followers publish one, and
   * a relay's own inbox — and each group's outcome is written against every
   * actor behind it. It is also why the sender is an explicit key pair list
   * rather than `{ identifier }`: that is the one shape a stored actor id can
   * sign under.
   */
  async function fanOut(
    context: Context<FederationContextData>,
    sender: User,
    activity: Activity,
    about: ActivityAbout,
    also: readonly DeliveryTarget[] = [],
    {
      relays = true,
      to,
      earlier = [],
    }: {
      relays?: boolean;
      to?: ReadonlySet<string> | undefined;
      earlier?: readonly Delivery[];
    } = {},
  ): Promise<DeliveryReport> {
    const deliveries: Delivery[] = [];
    const current = fanOutTargets(deliveryTargets(admin, sender.username, { relays }), also);
    const targets = fanOutTargets(current, earlierTargets(earlier, current)).filter(
      (target) => to === undefined || target.actorIds.some((actor) => to.has(actor)),
    );
    const held =
      targets.length > 0 &&
      (await holdOutbound(settings, config, {
        kind: 'activitypub',
        what: `${about.activityType} ${about.objectId}`,
        to: targets.map((target) => target.inboxId),
      }));
    const report = {
      activityId: about.activityId,
      activityType: about.activityType,
      objectId: about.objectId,
      deliveries,
      held,
    };
    if (held) return report;
    const keys = await senderKeyPairs(context, sender);

    for (const target of targets) {
      if (!isWebUrl(target.inboxId)) {
        // Fedify skips such an inbox without a word, or reaches it through a
        // gateway under another address, so no outcome would ever come back
        // for this row.
        record(target, 'failed', `No http(s) inbox to deliver to: ${target.inboxId}`);
        continue;
      }
      if (!synchronous) record(target, 'queued', null);
      let status: DeliveryStatus = 'sent';
      let error: string | null = null;

      try {
        await context.sendActivity(
          keys,
          target.recipients,
          activity,
          // The object id keeps a post's activities in order per server, so a
          // follower cannot be shown an Update of something it has not been
          // told about yet.
          { preferSharedInbox: true, orderingKey: about.objectId },
        );
      } catch (thrown) {
        if (!isDuplicateDelivery(thrown)) {
          status = 'failed';
          error = messageOf(thrown);
          logger.warn(
            `Could not deliver ${about.activityId} to ${target.inboxId}: ${oneLineMessageOf(thrown)}`,
          );
        }
      }

      if (synchronous || status === 'failed') record(target, status, error);
    }

    return report;

    function record(target: DeliveryTarget, status: DeliveryStatus, error: string | null): void {
      for (const row of deliveryRows(about, target, { status, error })) {
        const recorded = admin.recordDelivery(row);
        const at = deliveries.findIndex((one) => one.actorId === recorded.actorId);
        if (at === -1) deliveries.push(recorded);
        else deliveries[at] = recorded;
      }
    }
  }

  /**
   * Tell the followers what {@link pinChange} says moved, after the activity
   * that announced the post itself, so a peer never meets the pin of an object
   * it has not been sent. A post that stops being published sends no
   * `Remove`: its `Delete` already takes the pin with it on Mastodon, and the
   * collection drops it.
   */
  function queuePinChange(
    context: Context<FederationContextData>,
    before: Document | undefined,
    after: Document,
  ): void {
    const pin = pinChange(isFeatured(context, after), before, after, store.now());
    if (pin === undefined) return;
    queue(() => send(context, postPinActivity(context, after, pin.action, pin.revision), after));
  }

  function isFeatured(context: Context<FederationContextData>, document: Document): boolean {
    const author = documentAuthor(context, document);
    const names = author === undefined ? [] : authorNames(listUsers(config.dataDir), author);
    return store.listPinnedByAuthor(names).some((post) => post.path === document.path);
  }

  return {
    async handle(change) {
      const delivery = deliveryChange(change, store.now());
      if (delivery === undefined) return;

      const context = await deliveryContext();
      if (documentAuthor(context, delivery.subject) === undefined) return;

      if (delivery.kind === 'withdraw') {
        // `before` is the post as it last stood, and the only version there is
        // to build a Tombstone from.
        const { before } = delivery;
        queue(async () => await withdraw(context, before, await shapeOf(context, before)));
        return;
      }

      const { after } = delivery;
      const sameId = delivery.before !== undefined && sameObject(context, delivery.before, after);
      queue(async () => {
        const before = delivery.before ?? announcedSince(change.previous, after);
        const is = await shapeOf(context, after);
        if (before === undefined) return await announce(context, after, is);
        const was = await shapeOf(context, before);
        const step = revisionStep(was, is);
        if (step.kind === 'none') return undefined;
        if (step.kind === 'revise') return await revise(context, after, step.shape);
        await withdraw(context, before, was);
        return await announce(context, after, is);
      });
      queuePinChange(context, sameId ? delivery.before : undefined, after);
    },

    async updateActor(user) {
      // Building the actor loads — and on a cold database generates — the key
      // pairs, so a user with nowhere to send a profile update does not pay
      // for one. A relay counts: it is holding a copy of the profile too.
      if (deliveryTargets(admin, user.username).length === 0) return undefined;

      return await deliveryQueue
        .run(async () => {
          const context = await deliveryContext();
          const id = actorId(context, user);
          const actor = await userActor(context, user, { baseUrl: config.baseUrl });

          // The revision is the moment rather than a hash of the profile: an
          // avatar removed and put back is the same profile twice, and both
          // times the followers have to be told rather than recognise an id
          // they have already seen and skip it.
          const activityId = updateActivityId(id, store.now().toISOString());
          const activity = new ActorUpdate({
            id: activityId,
            actor: id,
            object: actor,
            to: PUBLIC_COLLECTION,
            cc: context.getFollowersUri(user.username),
          });

          return await fanOut(context, user, activity, {
            activityId: activityId.href,
            activityType: 'Update',
            // The object is the actor, not a post, and there is no slug to
            // record: that is what keeps an actor Update out of the federation
            // screen's per-post delivery table, which is built from the posts
            // the content index holds.
            objectId: id.href,
            slug: null,
          });
        })
        .catch((thrown: unknown) => {
          // A profile update is a side effect of saving the settings, and losing
          // it must not lose the save.
          logger.warn(`The actor update could not be delivered: ${oneLineMessageOf(thrown)}`);
          return undefined;
        });
    },

    async resend(path, to) {
      // Read inside the queue, so a post edited, moved or trashed while the
      // resend waited is sent as it now stands.
      return await deliveryQueue.run(async () => {
        const document = store.getByPath(path);
        if (document?.type !== 'post') return undefined;

        const published = isFederatedDocument(document, store.now());
        const announced = wasAnnounced(document);
        if (!announced && (!published || isMigrated(document))) return undefined;

        const context = await deliveryContext();

        if (!published) {
          // A draft, a trashed post, or one re-dated into the future: every
          // one of them is gone as far as a follower is concerned, and the
          // file still carries the id their copy is filed under.
          return await withdraw(context, document, await shapeOf(context, document), to?.actors);
        }

        requireSender(context, document);
        const shape = await shapeOf(context, document);
        // A like or a repost is sent again as it is: its id is one a peer
        // that already holds it recognises, and one that missed it does not.
        if (
          !announced ||
          to?.missedAnnouncement === true ||
          shape.kind === 'citing' ||
          wasDeleted(shape.id)
        ) {
          return await announce(context, document, shape, to?.actors);
        }

        // The moment rather than the content hash, which is what a save uses:
        // the point of a resend is that the followers hear about a revision
        // they have already been sent and ignored, or never received at all,
        // and an activity id a peer has seen is one it is entitled to drop.
        return await revise(context, document, shape, store.now().toISOString(), to?.actors);
      });
    },

    async resendPin(path, actors) {
      return await deliveryQueue.run(async () => {
        const document = store.getByPath(path);
        if (document?.type !== 'post' || !isFederatedDocument(document, store.now())) {
          return undefined;
        }
        const context = await deliveryContext();
        const change = isFeatured(context, document) ? 'pin' : 'unpin';
        // A fresh id, because a peer may drop an activity id it has seen.
        const revision = store.now().toISOString();
        const activity = postPinActivity(context, document, change, revision);
        return await send(context, activity, document, [], actors);
      });
    },

    citedPageStored(target, previous) {
      queue(async () => {
        const now = store.now();
        const context = await deliveryContext();
        const cited = context.data.cited;
        const before = await deliveryContext((url) => (url === target ? previous : cited(url)));
        const citing = store
          .listFederated()
          .filter(
            (document) =>
              isFederatedDocument(document, now) &&
              cites(document, target) &&
              documentAuthor(context, document) !== undefined,
          );

        for (const document of citing) {
          const shape = await shapeOf(context, document);
          if (shape.kind !== 'object') continue;
          const current = await fingerprint(postObject(context, document, shape.replyTo));
          const sent =
            sentThisProcess.get(shape.id) ??
            (await fingerprint(postObject(before, document, shape.replyTo)));
          if (current === sent) continue;
          await revise(context, document, shape, contentRevision(current));
        }
      });
    },

    settled() {
      return deliveryQueue.settled();
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
    deliveryQueue.run(task).catch((thrown: unknown) => {
      logger.warn(`A delivery failed: ${oneLineMessageOf(thrown)}`);
    });
  }
}

async function fingerprint(object: ActivityObject): Promise<string> {
  const json = JSON.stringify(await object.toJsonLd());
  return createHash('sha256').update(json).digest('hex');
}

function cites(document: Document, target: string): boolean {
  return (
    replyTarget(document) === target ||
    citationsOf(document.extra).some((citation) => citation.url === target)
  );
}

function reachesEarlierRecipients(activityType: string): boolean {
  return activityType === 'Update' || activityType === 'Delete' || activityType === 'Undo';
}

function sameObject(
  context: Context<FederationContextData>,
  before: Document,
  after: Document,
): boolean {
  return (
    articleObjectId(context, before).href === articleObjectId(context, after).href &&
    documentAuthor(context, before)?.username === documentAuthor(context, after)?.username
  );
}

/**
 * Everywhere one public activity goes: one user's followers, grouped by the
 * inbox they share, and every accepted relay.
 *
 * The followers are one person's and the relays are the site's:
 * a relay subscribes to everything public this site sends, whoever wrote it,
 * so it is a target of every author's activities. A pending or rejected relay
 * is not here at all — {@link acceptedRelays} is where that rule lives.
 */
export function deliveryTargets(
  admin: AdminStore,
  username: string,
  { relays = true }: { relays?: boolean } = {},
): DeliveryTarget[] {
  return audienceTargets(admin.listFollowers(username), relays ? acceptedRelays(admin) : []);
}

/** An activity's short type name — `Create`, `Update`, `Delete` — from its type URI. */
function typeNameOf(activity: Activity): string {
  const typeId = getTypeId(activity);
  return typeId.hash === '' ? typeId.href : typeId.hash.slice(1);
}
