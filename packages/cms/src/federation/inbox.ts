import { randomUUID } from 'node:crypto';

import type { InboxContext } from '@fedify/fedify';
import { Accept, Follow, Reject } from '@fedify/vocab';
import type {
  Activity,
  Actor,
  Announce,
  Create,
  Delete,
  Like,
  QuoteRequest,
  Undo,
} from '@fedify/vocab';

import { listUsers, primaryUser } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import type { NewFollower } from '../admin/store.ts';
import { actorId, senderKeyPairs, userByUsername } from './actor.ts';
import { documentAuthor, isFederatedDocument, postByObjectId } from './article.ts';
import { postObjectId } from '../web/documents.ts';
import type { FederationContextData } from './federation.ts';
import { authorizeQuote, quoteAuthorization, revokeQuotes } from './quotes.ts';
import { profileFrom } from './profiles.ts';
import { addFollower, appendInboxActivity, removeFollower } from './records.ts';
import type { FederationRecords } from './records.ts';
import { acceptRelay, rejectRelay } from './relays.ts';

/** What an inbox handler is handed: a Fedify context over the CMS's stores. */
export type SiteInboxContext = InboxContext<FederationContextData>;

/**
 * Handle a `Follow`: store the follower under the user it named, and reply
 * `Accept` as that user.
 *
 * A `Follow` of anything but one of this site's users is ignored rather than
 * refused — a peer that asked to follow a post has not done anything wrong, it
 * has merely addressed something that does not accept followers. The reply
 * goes to the follower's own inbox rather than through the followers
 * collection, because at this moment the follow is not yet a fact for anybody
 * but us.
 *
 * Following twice is a no-op beyond refreshing the stored profile: the store
 * is keyed by the pair (user, actor) and keeps the original follow time, so a
 * redelivered or repeated `Follow` cannot turn one follower into two. One
 * actor may follow two of this site's users, and that is two rows.
 */
export async function handleFollow(context: SiteInboxContext, follow: Follow): Promise<void> {
  const followed = followedUser(context, follow);
  await logActivity(context, follow, followed?.username);
  if (follow.id === null || follow.objectId === null || followed === undefined) return;

  const actor = await follow.getActor(dereference(context));
  if (actor === null) return;
  const follower = await followerFrom(context, actor);
  if (follower === undefined) return;

  await addFollower(recordsOf(context), followed.username, follower);

  await context.sendActivity(
    await senderKeyPairs(context, followed),
    actor,
    new Accept({
      // A fresh id every time: an actor may follow, unfollow and follow again,
      // and those are three activities rather than one repeated.
      id: new URL(`#accept/${randomUUID()}`, actorId(context, followed)),
      // The user's own id rather than the URL the `Follow` happened to name.
      // They are the same thing for almost everybody, but a user with a stored
      // actor id may be followed at either of two URLs, and the `Accept` has to
      // come from the one their actor document publishes — it is what a peer
      // matches against the account it is waiting to hear about, and the owner
      // of the key that signed the reply.
      actor: actorId(context, followed),
      object: follow,
    }),
  );
}

/**
 * The user a `Follow` is a follow of, or `undefined` when it names none.
 *
 * `parseUri` is what decides whether the object is one of this site's actors:
 * comparing strings would have to know how Fedify spells an actor's URL, and
 * this asks Fedify instead. The identifier it answers with is the username
 * (decision-14), and a username nobody has is not a follow of anybody.
 *
 * A stored actor id is the other way in, and the commoner one for a migrated
 * site: it is the `id` the actor document publishes, so it is what a peer that
 * just read the document names, and Fedify's router cannot parse it because it
 * is not a path Fedify dispatches (doc-8). Matched on the whole URL, as it is
 * everywhere else.
 */
function followedUser(context: SiteInboxContext, follow: Follow): User | undefined {
  if (follow.objectId === null) return undefined;

  const parsed = context.parseUri(follow.objectId);
  if (parsed?.type === 'actor') {
    return userByUsername(context.data.config.dataDir, parsed.identifier);
  }

  const wanted = follow.objectId.href;
  return listUsers(context.data.config.dataDir).find((user) => user.actorId === wanted);
}

/**
 * Handle an `Undo`: an undone `Follow` removes the follower, and an undone
 * `QuoteRequest` withdraws the quote approval it was given.
 *
 * Only the actor that sent the `Follow` may undo it. Without that check any
 * signed actor could unfollow the site on somebody else's behalf, since the
 * activity carrying the instruction is signed by its sender and says nothing
 * about who the follow belonged to.
 */
export async function handleUndo(context: SiteInboxContext, undo: Undo): Promise<void> {
  // A withdrawn QuoteRequest takes its approval with it. Matched on the ids
  // alone, so an Undo naming the request by a URL nobody can fetch still counts.
  const undoer = undo.actorId?.href;
  const undone = undo.objectId?.href;
  if (undoer !== undefined && undone !== undefined) {
    await revokeQuotes(
      context.data.config.contentDir,
      (record) => record.request === undone && record.actor === undoer,
    );
  }

  const object = await undo.getObject(dereference(context));
  const followed = object instanceof Follow ? followedUser(context, object) : undefined;
  await logActivity(context, undo, followed?.username);

  if (!(object instanceof Follow)) return;

  const follower = object.actorId;
  if (undoer === undefined || follower === null || undoer !== follower.href) return;

  // An `Undo` that names which actor was followed unfollows exactly that one;
  // one that does not — the object arrived as a bare id nothing could
  // dereference — unfollows everybody, which is what "I do not want your
  // posts" means when it says nothing more.
  await forget(context, follower.href, followed?.username);
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
  await logActivity(context, activity, context.recipient ?? undefined);

  const actor = activity.actorId;
  const object = activity.objectId;
  if (actor === null || object === null) return;

  if (actor.href !== object.href) {
    // A quote its author deleted is no longer one this site vouches for.
    await revokeQuotes(
      context.data.config.contentDir,
      (record) => record.quote === object.href && record.actor === actor.href,
    );
    return;
  }

  // An account that is gone is gone from everybody's followers, whichever
  // inbox the announcement happened to reach.
  await forget(context, object.href);
}

/**
 * Take one actor off a user's followers, or off every user's.
 *
 * Which users to touch is asked of the index rather than of the file listing,
 * because the index is the one place that already knows which of this site's
 * people an actor follows; `removeFollower` then rewrites each file and
 * corrects the index inside the same lock, so the two cannot disagree.
 */
async function forget(
  context: SiteInboxContext,
  actorHref: string,
  username?: string,
): Promise<void> {
  const records = recordsOf(context);
  if (username !== undefined) {
    await removeFollower(records, username, actorHref);
    return;
  }

  const usernames = new Set(
    context.data.admin
      .listFollowers()
      .filter((follower) => follower.actorId === actorHref)
      .map((follower) => follower.username),
  );
  for (const name of usernames) await removeFollower(records, name, actorHref);
}

/**
 * Handle a `QuoteRequest` (FEP-044f): approve a quote of a post this site
 * federates, and refuse anything else.
 *
 * Every federated post is public and advertises `canQuote` for anybody (see
 * `postObject`), so approval is automatic and the one rule is whether the
 * quoted object is such a post. The quote has to live on the requester's own
 * server too, as Mastodon insists of any activity: otherwise anybody could
 * obtain a stamp for somebody else's post. An approval is stored, then sent
 * as the `result` of an `Accept`; a refusal is a `Reject` and stores nothing.
 * Either way the answer comes from the post's author, to the requester.
 */
export async function handleQuoteRequest(
  context: SiteInboxContext,
  request: QuoteRequest,
): Promise<void> {
  const { config, store } = context.data;
  const post =
    request.objectId === null
      ? undefined
      : postByObjectId(store, request.objectId.href, config.baseUrl);
  const author =
    post === undefined
      ? (userByUsername(config.dataDir, context.recipient ?? '') ?? primaryUser(config.dataDir))
      : documentAuthor(context, post);
  await logActivity(context, request, author?.username);
  if (request.id === null || author === undefined) return;

  const requester = await request.getActor(dereference(context));
  if (requester === null || requester.id === null) return;

  const quote = request.instrumentId;
  const quotable =
    post !== undefined &&
    isFederatedDocument(post, store.now()) &&
    quote !== null &&
    quote.origin === requester.id.origin;

  const sender = await senderKeyPairs(context, author);
  const from = actorId(context, author);
  if (!quotable) {
    await context.sendActivity(
      sender,
      requester,
      new Reject({ id: new URL(`#reject/${randomUUID()}`, from), actor: from, object: request }),
    );
    return;
  }

  const record = await authorizeQuote(config.contentDir, author.username, {
    quote: quote.href,
    post: postObjectId(post, config.baseUrl),
    request: request.id.href,
    actor: requester.id.href,
  });
  const stamp = quoteAuthorization(context, author, record);
  await context.sendActivity(
    sender,
    requester,
    new Accept({
      id: new URL(`#accept/${randomUUID()}`, from),
      actor: from,
      object: request,
      result: stamp,
    }),
  );
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
 * Handle a `Like`, an `Announce` or a `Create`: record it, and ask for the
 * profile of whoever sent it.
 *
 * Nothing about the activity is interpreted here: the conversation reads it
 * back out of the log, which is why the row keeps the whole JSON-LD rather
 * than a few columns of it. The profile is what a conversation names the
 * sender by when they are not a follower (TASK-184), and it is fetched in the
 * background, so the inbox answers without waiting for it.
 */
export async function handleLoggedActivity(
  context: SiteInboxContext,
  activity: Like | Announce | Create,
): Promise<void> {
  await logActivity(context, activity);
  if (activity.actorId !== null) context.data.actorProfiles.capture(activity.actorId.href);
}

/**
 * Write one inbound activity to the log, attributed to the user it was
 * addressed to.
 *
 * Every handled activity goes through here, the follow traffic included, so
 * the log is a complete record of what the inbox was told rather than of what
 * the inbox ignored. An activity with no actor is dropped: Fedify has already
 * refused anything whose signature does not match its actor, so an activity
 * without one is malformed rather than anonymous.
 *
 * The recipient defaults to the inbox the delivery arrived at —
 * `context.recipient` is the username for a personal inbox and `null` for the
 * shared one — and a caller that has worked out the addressee for itself, as
 * `handleFollow` has, names it instead (decision-14).
 */
export async function logActivity(
  context: SiteInboxContext,
  activity: Activity,
  recipient: string | undefined = context.recipient ?? undefined,
): Promise<void> {
  const sender = activity.actorId;
  if (sender === null) return;

  const json = await activity.toJsonLd({
    format: 'compact',
    contextLoader: context.contextLoader,
  });

  await appendInboxActivity(recordsOf(context), JSON.stringify(json), { recipient });
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
): Promise<Omit<NewFollower, 'username'> | undefined> {
  if (actor.inboxId === null) return undefined;
  const profile = await profileFrom(actor, dereference(context));
  if (profile === undefined) return undefined;

  return {
    ...profile,
    inboxId: actor.inboxId.href,
    sharedInboxId: actor.endpoints?.sharedInbox?.href ?? null,
  };
}

/** The loaders a vocabulary getter needs to follow a link off this context. */
function dereference(context: SiteInboxContext): {
  documentLoader: SiteInboxContext['documentLoader'];
  contextLoader: SiteInboxContext['contextLoader'];
} {
  return { documentLoader: context.documentLoader, contextLoader: context.contextLoader };
}
