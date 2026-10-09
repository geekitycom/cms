import { createHash } from 'node:crypto';

import type { Context } from '@fedify/fedify';
import { Activity, getTypeId, PUBLIC_COLLECTION } from '@fedify/vocab';
import type { Actor, Object as ActivityObject, Recipient } from '@fedify/vocab';

import { listUsers } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import { readSiteSettings } from '../admin/settings.ts';
import type { AdminStore, Delivery, DeliveryStatus, Follower } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import { holdOutbound } from '../dev-mode.ts';
import { citationsOf } from '../content/citation.ts';
import type { CitedPage } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { isMigrated } from '../content/migrated.ts';
import { pinnedAt } from '../content/pinned.ts';
import { replyTarget } from '../content/post-type.ts';
import { saveDocument } from '../content/save.ts';
import type { ContentStore } from '../content/store.ts';
import type { DocumentChange } from '../content/sync.ts';
import { visibilityOf } from '../content/visibility.ts';
import { documentContent } from '../content/writer.ts';
import { authorNames } from '../web/authors.ts';
import { ActorUpdate, actorId, senderKeyPairs, userActor } from './actor.ts';
import {
  articleObjectId,
  documentAuthor,
  isFederatedDocument,
  postCreateActivity,
  postDeleteActivity,
  postObject,
  postPinActivity,
  postUpdateActivity,
} from './article.ts';
import type { FederationContextData, SiteFederation } from './federation.ts';
import { citingActivity, repliedTo, undoActivity } from './citations.ts';
import type { Citing, CitedObject } from './citations.ts';
import { followerRecipient } from './followers.ts';
import { mentionedAccounts } from './handles.ts';
import { updateActivityId } from './paths.ts';
import { acceptedRelays, relayRecipient } from './relays.ts';

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
  /** What the federation context carries for the inbox; nothing here calls it. */
  actorProfiles: FederationContextData['actorProfiles'];
  /** What the federation context carries for the post objects. */
  cited: FederationContextData['cited'];
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
  function deliveryContext(
    cited: FederationContextData['cited'] = options.cited,
  ): Context<FederationContextData> {
    return federation.createContext(new URL(config.baseUrl), {
      admin,
      store,
      config,
      actorProfiles: options.actorProfiles,
      cited,
    });
  }

  const sentThisProcess = new Map<string, string>();

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
    also: readonly DeliveryTarget[] = [],
  ): Promise<DeliveryReport> {
    const activityId = activity.id?.href;
    if (activityId === undefined) {
      throw new TypeError('An activity cannot be delivered without an id.');
    }
    return await fanOut(
      context,
      requireSender(context, about),
      activity,
      {
        activityId,
        activityType: typeNameOf(activity),
        objectId: articleObjectId(context, about).href,
        slug: about.slug,
      },
      also,
      { relays: visibilityOf(about) === 'public' },
    );
  }

  /**
   * What a version of a post is to a peer: the `Like` or `Announce` of the
   * fediverse object it cites, or the object it is (decision-28), with the
   * status it replies to when it answers one (TASK-240). Asked of the post as
   * it reads now, so a target that stops answering makes it the object again.
   */
  async function shapeOf(
    context: Context<FederationContextData>,
    document: Document,
  ): Promise<Shape> {
    const citing = await citingActivity(context, document);
    if (citing !== undefined) {
      return { kind: 'citing', id: citing.activity.id?.href ?? '', citing };
    }
    return {
      kind: 'object',
      id: articleObjectId(context, document).href,
      replyTo: await repliedTo(context, document),
    };
  }

  /** Tell the peers a post is out: its `Create`, or its `Like` or `Announce`. */
  async function announce(
    context: Context<FederationContextData>,
    document: Document,
    shape: Shape,
  ): Promise<DeliveryReport> {
    if (shape.kind === 'object') {
      return await sendAndRecordObject(
        context,
        postCreateActivity(context, document, shape.replyTo),
        document,
        shape,
      );
    }
    return await send(context, shape.citing.activity, document, citedAuthor(shape.citing.author));
  }

  /** Take a post back: a `Delete` of its object, or an `Undo` of its `Like` or `Announce`. */
  async function withdraw(
    context: Context<FederationContextData>,
    document: Document,
    shape: Shape,
  ): Promise<DeliveryReport> {
    const deleted = new Date().toISOString();
    if (shape.kind === 'object') {
      return await send(
        context,
        postDeleteActivity(context, document, deleted),
        document,
        objectTargets(document, shape.replyTo, config.contentDir),
      );
    }
    return await send(
      context,
      undoActivity(shape.citing.activity, deleted),
      document,
      citedAuthor(shape.citing.author),
    );
  }

  async function revise(
    context: Context<FederationContextData>,
    document: Document,
    shape: Shape & { kind: 'object' },
    revision?: string,
  ): Promise<DeliveryReport> {
    return await sendAndRecordObject(
      context,
      postUpdateActivity(context, document, revision, shape.replyTo),
      document,
      shape,
    );
  }

  function contentRevision(hash: string): string {
    return hash.slice(0, 16);
  }

  async function sendAndRecordObject(
    context: Context<FederationContextData>,
    activity: Activity,
    document: Document,
    shape: Shape & { kind: 'object' },
  ): Promise<DeliveryReport> {
    const report = await send(
      context,
      activity,
      document,
      objectTargets(document, shape.replyTo, config.contentDir),
    );
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
   * saying which follower did not get it, which is the thing decision-5
   * promised to record. So the recipients are grouped into the inboxes one
   * POST reaches — the instance shared inbox where followers publish one, and
   * a relay's own inbox — and each group's outcome is written against every
   * actor behind it. It is also why the sender is an explicit key pair list
   * rather than `{ identifier }`: doc-8 makes that the one shape a stored
   * actor id can sign under.
   */
  async function fanOut(
    context: Context<FederationContextData>,
    sender: User,
    activity: Activity,
    about: {
      activityId: string;
      activityType: string;
      objectId: string;
      /** The post it was about, or `null` for an activity about the actor. */
      slug: string | null;
    },
    also: readonly DeliveryTarget[] = [],
    { relays = true }: { relays?: boolean } = {},
  ): Promise<DeliveryReport> {
    const deliveries: Delivery[] = [];
    const targets = deliveryTargets(admin, sender.username, { relays });
    // One POST to an inbox the followers already share is enough.
    const reached = new Set(targets.map((target) => target.inboxId));
    targets.push(...also.filter((target) => !reached.has(target.inboxId)));
    const held =
      targets.length > 0 &&
      holdOutbound(config, {
        kind: 'activitypub',
        what: `${about.activityType} ${about.objectId}`,
        to: targets.map((target) => target.inboxId),
      });
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
      let status: DeliveryStatus = synchronous ? 'sent' : 'queued';
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

    return report;
  }

  /**
   * Tell the followers a published post went into its author's featured
   * collection or came out of it (TASK-207), after the activity that
   * announced the post itself, so a peer never meets the pin of an object it
   * has not been sent.
   *
   * `before` is the post as followers last knew it, or `undefined` when they
   * are about to meet it for the first time. Whether it is featured *now* is
   * the collection's own answer, so a pin past the limit is never announced as
   * one. A post that stops being published sends no `Remove`: its `Delete`
   * already takes the pin with it on Mastodon, and the collection drops it.
   */
  function queuePinChange(
    context: Context<FederationContextData>,
    before: Document | undefined,
    after: Document,
  ): void {
    const author = documentAuthor(context, after);
    const names = author === undefined ? [] : authorNames(listUsers(config.dataDir), author);
    const featured = store.listPinnedByAuthor(names).some((post) => post.path === after.path);
    const wasPinned = before !== undefined && pinnedAt(before) !== undefined;

    if (featured && !wasPinned) {
      const revision = pinnedAt(after) ?? new Date().toISOString();
      queue(() => send(context, postPinActivity(context, after, 'pin', revision), after));
    } else if (!featured && wasPinned) {
      const revision = new Date().toISOString();
      queue(() => send(context, postPinActivity(context, after, 'unpin', revision), after));
    }
  }

  return {
    async handle(change) {
      // A full scan is a rebuild of the index, not news about the site.
      if (change.origin === 'scan') return;

      const now = store.now();
      const before = federatedOrUndefined(change.previous, now);
      const after = federatedOrUndefined(change.next, now);
      if (before === undefined && after === undefined) return;
      const subject = change.next ?? change.previous;
      if (subject !== undefined && isMigrated(subject)) {
        const followersHoldIt = wasAnnounced(subject);
        const comingIntoView = before === undefined;
        if (!followersHoldIt || comingIntoView) return;
      }

      const context = deliveryContext();
      if (subject === undefined || documentAuthor(context, subject) === undefined) return;

      if (after === undefined) {
        // Unpublished, trashed or deleted; `before` is the post as it last
        // stood, and the only version there is to build a Tombstone from.
        if (before === undefined) return;
        queue(async () => await withdraw(context, before, await shapeOf(context, before)));
        return;
      }

      const stamped = await stamp(after);
      // The same object after a save is an `Update`, or nothing at all for a
      // like or a repost, which has no content of its own to update. Anything
      // else, a rename or a change of what it cites, takes the old version back
      // before the new one goes out.
      const sameId = before !== undefined && sameObject(context, before, stamped);
      queue(async () => {
        const is = await shapeOf(context, stamped);
        if (before === undefined) return await announce(context, stamped, is);
        const was = await shapeOf(context, before);
        if (was.kind === is.kind && was.id === is.id) {
          if (is.kind === 'citing') return undefined;
          return await revise(context, stamped, is);
        }
        await withdraw(context, before, was);
        return await announce(context, stamped, is);
      });
      queuePinChange(context, sameId ? before : undefined, stamped);
    },

    async updateActor(user) {
      // Building the actor loads — and on a cold database generates — the key
      // pairs, so a user with nowhere to send a profile update does not pay
      // for one. A relay counts: it is holding a copy of the profile too.
      if (deliveryTargets(admin, user.username).length === 0) return undefined;

      return await enqueue(async () => {
        const context = deliveryContext();
        const id = actorId(context, user);
        const actor = await userActor(context, user, { baseUrl: config.baseUrl });

        // The revision is the moment rather than a hash of the profile: an
        // avatar removed and put back is the same profile twice, and both
        // times the followers have to be told rather than recognise an id
        // they have already seen and skip it.
        const activityId = updateActivityId(id, new Date().toISOString());
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
      const announced = wasAnnounced(document);
      if (!announced && (!published || isMigrated(document))) return undefined;

      return await enqueue(async () => {
        const context = deliveryContext();

        if (!published) {
          // A draft, a trashed post, or one re-dated into the future: every
          // one of them is gone as far as a follower is concerned, and the
          // file still carries the id their copy is filed under.
          return await withdraw(context, document, await shapeOf(context, document));
        }

        requireSender(context, document);
        const stamped = await stamp(document);
        const shape = await shapeOf(context, stamped);
        // A like or a repost is sent again as it is: its id is one a peer
        // that already holds it recognises, and one that missed it does not.
        if (!announced || shape.kind === 'citing') return await announce(context, stamped, shape);

        // The moment rather than the content hash, which is what a save uses:
        // the point of a resend is that the followers hear about a revision
        // they have already been sent and ignored, or never received at all,
        // and an activity id a peer has seen is one it is entitled to drop.
        return await revise(context, stamped, shape, new Date().toISOString());
      });
    },

    citedPageStored(target, previous) {
      queue(async () => {
        const now = store.now();
        const context = deliveryContext();
        const before = deliveryContext((url) => (url === target ? previous : options.cited(url)));
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
 * What a version of a post is to a peer (decision-28), and the id that names
 * it: the post's object id, or its `Like` or `Announce`'s activity id, which
 * carries the id of what it cites.
 */
type Shape =
  | { readonly kind: 'object'; readonly id: string; readonly replyTo: CitedObject | undefined }
  | { readonly kind: 'citing'; readonly id: string; readonly citing: Citing };

/** The author of what a post likes, reposts or replies to, as one more inbox to tell. */
function citedAuthor(author: Actor | undefined): DeliveryTarget[] {
  if (author?.id == null || author.inboxId === null) return [];
  return [
    {
      inboxId: (author.endpoints?.sharedInbox ?? author.inboxId).href,
      recipients: [author],
      actorIds: [author.id.href],
    },
  ];
}

function objectTargets(
  document: Document,
  replyTo: CitedObject | undefined,
  contentDir: string,
): DeliveryTarget[] {
  const byInbox = new Map<string, DeliveryTarget>();
  const mentioned = mentionedAccounts(document.body, contentDir).map(({ account }) => ({
    inboxId: account.sharedInbox ?? account.inbox,
    recipients: [
      {
        id: new URL(account.actor),
        inboxId: new URL(account.inbox),
        endpoints:
          account.sharedInbox === undefined ? null : { sharedInbox: new URL(account.sharedInbox) },
      },
    ],
    actorIds: [account.actor],
  }));
  for (const target of [...citedAuthor(replyTo?.author), ...mentioned]) {
    const held = byInbox.get(target.inboxId);
    if (held === undefined) {
      byInbox.set(target.inboxId, target);
    } else if (!held.actorIds.some((id) => target.actorIds.includes(id))) {
      byInbox.set(target.inboxId, {
        inboxId: target.inboxId,
        recipients: [...held.recipients, ...target.recipients],
        actorIds: [...held.actorIds, ...target.actorIds],
      });
    }
  }
  return [...byInbox.values()];
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

/** Whether two versions of a post are one object to a peer: the same id. */
function sameObject(
  context: Context<FederationContextData>,
  before: Document,
  after: Document,
): boolean {
  return articleObjectId(context, before).href === articleObjectId(context, after).href;
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
 * Everywhere one public activity goes: one user's followers, grouped by the
 * inbox they share, and every accepted relay.
 *
 * The followers are one person's (decision-14) and the relays are the site's:
 * a relay subscribes to everything public this site sends, whoever wrote it,
 * so it is a target of every author's activities.
 *
 * A relay is one target of its own rather than a member of a group, because it
 * is one inbox with one actor behind it and no shared inbox to fold into. A
 * pending or rejected relay is not here at all — {@link acceptedRelays} is
 * where that rule lives.
 */
export function deliveryTargets(
  admin: AdminStore,
  username: string,
  { relays = true }: { relays?: boolean } = {},
): DeliveryTarget[] {
  const targets: DeliveryTarget[] = [];

  for (const [inboxId, members] of groupByInbox(admin.listFollowers(username))) {
    targets.push({
      inboxId,
      recipients: members.map(followerRecipient),
      actorIds: members.map((member) => member.actorId),
    });
  }

  for (const relay of relays ? acceptedRelays(admin) : []) {
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

function wasAnnounced(document: Document): boolean {
  return (document.activitypub?.published ?? '') !== '';
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
