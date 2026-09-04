import { randomUUID } from 'node:crypto';

import type { InboxContext } from '@fedify/fedify';
import { Accept, Follow } from '@fedify/vocab';
import type {
  Activity,
  Actor,
  Announce,
  Create,
  Delete,
  Like,
  Link,
  Reject,
  Undo,
} from '@fedify/vocab';

import type { NewFollower } from '../admin/store.ts';
import type { FederationContextData } from './federation.ts';
import { SITE_ACTOR_IDENTIFIER } from './keys.ts';
import { addFollower, appendInboxActivity, removeFollower } from './records.ts';
import type { FederationRecords } from './records.ts';
import { acceptRelay, rejectRelay } from './relays.ts';

/** What an inbox handler is handed: a Fedify context over the CMS's stores. */
export type SiteInboxContext = InboxContext<FederationContextData>;

/**
 * Handle a `Follow`: store the follower and reply `Accept`.
 *
 * A `Follow` of anything but the site actor is ignored rather than refused —
 * a peer that asked to follow a post has not done anything wrong, it has
 * merely addressed something that does not accept followers. The reply goes
 * to the follower's own inbox rather than through the followers collection,
 * because at this moment the follow is not yet a fact for anybody but us.
 *
 * Following twice is a no-op beyond refreshing the stored profile: the store
 * is keyed by actor id and keeps the original follow time, so a redelivered
 * or repeated `Follow` cannot turn one follower into two.
 */
export async function handleFollow(context: SiteInboxContext, follow: Follow): Promise<void> {
  await logActivity(context, follow);
  if (follow.id === null || follow.objectId === null) return;

  // `parseUri` is what decides whether the object is this actor: comparing
  // strings would have to know how Fedify spells the actor's URL, and this
  // asks Fedify instead.
  const parsed = context.parseUri(follow.objectId);
  if (parsed?.type !== 'actor' || parsed.identifier !== SITE_ACTOR_IDENTIFIER) return;

  const actor = await follow.getActor(dereference(context));
  if (actor === null) return;
  const follower = await followerFrom(context, actor);
  if (follower === undefined) return;

  await addFollower(recordsOf(context), follower);

  await context.sendActivity(
    { identifier: SITE_ACTOR_IDENTIFIER },
    actor,
    new Accept({
      // A fresh id every time: an actor may follow, unfollow and follow again,
      // and those are three activities rather than one repeated.
      id: new URL(`#accept/${randomUUID()}`, context.getActorUri(SITE_ACTOR_IDENTIFIER)),
      actor: follow.objectId,
      object: follow,
    }),
  );
}

/**
 * Handle an `Undo`: an undone `Follow` removes the follower.
 *
 * Only the actor that sent the `Follow` may undo it. Without that check any
 * signed actor could unfollow the site on somebody else's behalf, since the
 * activity carrying the instruction is signed by its sender and says nothing
 * about who the follow belonged to.
 */
export async function handleUndo(context: SiteInboxContext, undo: Undo): Promise<void> {
  await logActivity(context, undo);

  const object = await undo.getObject(dereference(context));
  if (!(object instanceof Follow)) return;

  const undoer = undo.actorId;
  const follower = object.actorId;
  if (undoer === null || follower === null || undoer.href !== follower.href) return;

  await removeFollower(recordsOf(context), follower.href);
}

/**
 * Handle a `Delete`: an actor deleting itself stops being a follower.
 *
 * The only `Delete` acted on is the one whose object is its own actor, which
 * is how an instance announces that an account is gone. A `Delete` of a note
 * or an article is logged and left alone; the site holds no copy of a remote
 * object to remove.
 */
export async function handleDelete(context: SiteInboxContext, activity: Delete): Promise<void> {
  await logActivity(context, activity);

  const actor = activity.actorId;
  const object = activity.objectId;
  if (actor === null || object === null || actor.href !== object.href) return;

  await removeFollower(recordsOf(context), object.href);
}

/**
 * Handle an `Accept`: a relay agreeing to the subscription the site asked for.
 *
 * The site follows nothing but relays (doc-4 keeps its `following` collection
 * empty), so an `Accept` addressed to it is an answer to one of the `Follow`
 * activities TASK-40 sends — or a stray, which {@link acceptRelay} recognises
 * as one and leaves alone.
 */
export async function handleAccept(context: SiteInboxContext, accept: Accept): Promise<void> {
  await logActivity(context, accept);
  acceptRelay(context.data.admin, accept);
}

/**
 * Handle a `Reject`: a relay refusing the subscription, with whatever it said
 * about why, which the federation screen shows beside the relay.
 */
export async function handleReject(context: SiteInboxContext, reject: Reject): Promise<void> {
  await logActivity(context, reject);
  rejectRelay(context.data.admin, reject);
}

/**
 * Handle a `Like`, an `Announce` or a `Create`: record it and do nothing else.
 *
 * doc-4 keeps these so a later phase can surface likes, boosts and comments.
 * Nothing about them is interpreted here, because what that phase will want
 * out of an activity is not knowable yet — which is also why the row keeps the
 * whole JSON-LD rather than a few columns of it.
 */
export async function handleLoggedActivity(
  context: SiteInboxContext,
  activity: Like | Announce | Create,
): Promise<void> {
  await logActivity(context, activity);
}

/**
 * Write one inbound activity to the log.
 *
 * Every handled activity goes through here, the follow traffic included, so
 * the log is a complete record of what the inbox was told rather than of what
 * the inbox ignored. An activity with no actor is dropped: Fedify has already
 * refused anything whose signature does not match its actor, so an activity
 * without one is malformed rather than anonymous.
 */
export async function logActivity(context: SiteInboxContext, activity: Activity): Promise<void> {
  const actorId = activity.actorId;
  if (actorId === null) return;

  const json = await activity.toJsonLd({
    format: 'compact',
    contextLoader: context.contextLoader,
  });

  await appendInboxActivity(recordsOf(context), JSON.stringify(json));
}

/** The files this inbox writes, and the index over them. */
function recordsOf(context: SiteInboxContext): FederationRecords {
  return { admin: context.data.admin, contentDir: context.data.config.contentDir };
}

/**
 * A remote actor as the follower row that describes it, or `undefined` when
 * it is not deliverable.
 *
 * An actor with no id or no inbox is dropped rather than stored: a follower
 * the site could never deliver to is a row that would only ever fail, and
 * both are the minimum ActivityPub asks of an actor.
 */
export async function followerFrom(
  context: SiteInboxContext,
  actor: Actor,
): Promise<NewFollower | undefined> {
  if (actor.id === null || actor.inboxId === null) return undefined;

  const icon = await actor.getIcon({ ...dereference(context), suppressError: true });

  return {
    actorId: actor.id.href,
    inboxId: actor.inboxId.href,
    sharedInboxId: actor.endpoints?.sharedInbox?.href ?? null,
    handle: actorHandle(actor),
    name: actor.name === null ? null : actor.name.toString(),
    iconUrl: linkHref(icon?.url ?? null) ?? actor.iconId?.href ?? null,
    url: linkHref(actor.url) ?? null,
  };
}

/**
 * `@name@host` for an actor, built from what the actor document says rather
 * than from WebFinger.
 *
 * A canonical handle would take a WebFinger round trip per follow to confirm
 * the host, and this is display data: the id is what identifies the follower,
 * and the id is what every other part of the system keys on.
 */
function actorHandle(actor: Actor): string | null {
  const username = actor.preferredUsername;
  if (username === null || actor.id === null) return null;
  return `@${username.toString()}@${actor.id.host}`;
}

/** A `URL` or a `Link` as a plain href, or `null`. */
function linkHref(value: URL | Link | null): string | null {
  if (value === null) return null;
  return value instanceof URL ? value.href : (value.href?.href ?? null);
}

/** The loaders a vocabulary getter needs to follow a link off this context. */
function dereference(context: SiteInboxContext): {
  documentLoader: SiteInboxContext['documentLoader'];
  contextLoader: SiteInboxContext['contextLoader'];
} {
  return { documentLoader: context.documentLoader, contextLoader: context.contextLoader };
}
