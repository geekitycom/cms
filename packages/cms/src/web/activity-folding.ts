import { avatarHref } from '../avatars/avatars.ts';
import { heldComment } from '../comments/conversation.ts';
import type { Interaction, InteractionAuthor, InteractionKind } from '../comments/conversation.ts';
import { repliesKey } from '../content/guids.ts';
import { RSVP_LABELS } from '../content/rsvp.ts';
import type { RsvpValue } from '../content/rsvp.ts';
import { sanitizeCommentHtml } from '../content/sanitize.ts';
import type { ObjectIds } from '../federation/object-ids.ts';
import { readAllQuoteAuthorizations } from '../federation/quotes.ts';
import type { QuoteAuthorizationRecord } from '../federation/quotes.ts';
import type { ActorProfile, AdminStore, InboxActivity, PostComment } from '../store/admin-store.ts';
import {
  actorHandle,
  guessedName,
  quoteFrom,
  replyFrom,
  REPLY_ACTIVITY_TYPE,
} from '../store/inbox-replies.ts';
import type { Reading } from './conversation-context.ts';

/**
 * Turning what the fediverse sent into the thread's own shape: the logged
 * activities around a post folded into replies, reactions and RSVPs, and the
 * quotes the site vouches for into mentions.
 */

export type Group = 'written' | 'likes' | 'boosts' | 'mentions' | 'answers';

/**
 * A repost joins the boosts, because a reader looking at the page is being
 * told the same thing by both; a mention is its own group, because it is
 * neither an answer nor a reaction.
 */
export const GROUP_OF: Readonly<Record<InteractionKind, Group>> = {
  reply: 'written',
  like: 'likes',
  boost: 'boosts',
  repost: 'boosts',
  mention: 'mentions',
};

/** What one source says about a post, sorted into groups. */
export interface Part {
  readonly said: readonly (readonly [Group, Interaction])[];
  readonly held?: ReadonlyMap<string, Interaction>;
  readonly withdrawn?: ReadonlySet<string>;
}

/** The two reactions, as the activity types they arrive as. */
const REACTIONS: Readonly<Record<string, InteractionKind | undefined>> = {
  Like: 'like',
  Announce: 'boost',
};

const RSVP_ACTIVITIES: Readonly<Record<string, RsvpValue | undefined>> = {
  Accept: 'yes',
  TentativeAccept: 'maybe',
  Reject: 'no',
};

/** The logged activities around one post, read once for every fold over them. */
export interface Heard {
  /** What a top-level answer names. */
  readonly root: string;
  /** Every object id the post has had. */
  readonly named: ReadonlySet<string>;
  readonly activities: readonly InboxActivity[];
  /** The ids of what an actor has taken back. */
  readonly withdrawn: ReadonlySet<string>;
}

export function heardAbout(
  context: Reading,
  root: string,
  objectIds: ObjectIds,
  stored: readonly PostComment[],
): Heard {
  // What was imported from the fediverse is walked from too: an answer to an
  // imported note names the note, which no logged activity may carry.
  const origins = stored.flatMap((comment) =>
    comment.source === 'activitypub' && comment.origin !== undefined ? [comment.origin] : [],
  );
  const activities = activitiesAround(context.admin, [...objectIds, ...origins]);
  return { root, named: new Set(objectIds), activities, withdrawn: withdrawnBy(activities) };
}

function aboutPost(heard: Heard, activity: InboxActivity): boolean {
  return activity.objectId !== null && heard.named.has(activity.objectId);
}

function taken(heard: Heard, activityId: string | null): boolean {
  return activityId !== null && heard.withdrawn.has(activityId);
}

/** The replies and reactions among the activities around a post. */
export function fromActivities(
  context: Reading,
  heard: Heard,
  stored: readonly PostComment[],
  naming: (actorId: string) => InteractionAuthor,
): Part {
  // One like per actor, so a like imported from the site this one replaced
  // and the same person's like delivered here are one.
  const reacted = new Set(stored.flatMap(storedReaction));
  const said: [Group, Interaction][] = [];

  for (const activity of heard.activities) {
    const kind = REACTIONS[activity.activityType];
    if (kind === undefined) {
      const reply = replyIn(context, heard, activity, naming);
      if (reply !== undefined) said.push(['written', reply]);
      continue;
    }

    // Only a reaction to the post itself: a like of one of the replies
    // belongs to that reply's own conversation, wherever it is shown.
    if (!aboutPost(heard, activity)) continue;
    // One like per actor, however many times it was delivered, and none
    // at all once its actor has taken it back.
    const key = reactionKey(kind, activity.actorId);
    if (reacted.has(key) || taken(heard, activity.activityId)) continue;
    if (
      activity.activityId !== null &&
      heldComment(context.admin, activity.activityId) !== undefined
    ) {
      continue;
    }
    reacted.add(key);
    said.push([
      GROUP_OF[kind],
      { ...reaction(activity, naming, `${activity.actorId}#${kind}`), kind },
    ]);
  }
  return { said, withdrawn: heard.withdrawn };
}

/**
 * A logged note as a reply in the post's thread: one answering the post by
 * any of its ids answers the root, and one answering a held native comment
 * answers it by the comment's own id.
 */
function replyIn(
  context: Reading,
  heard: Heard,
  activity: InboxActivity,
  naming: (actorId: string) => InteractionAuthor,
): Interaction | undefined {
  const found = replyFrom(activity);
  if (found === undefined || heldComment(context.admin, found.id) !== undefined) return undefined;
  const reply = heard.named.has(found.inReplyTo) ? { ...found, inReplyTo: heard.root } : found;
  const parent = heldComment(context.admin, reply.inReplyTo);
  return federatedInteraction(
    parent === undefined ? reply : { ...reply, inReplyTo: parent.id },
    naming(activity.actorId),
  );
}

/** The RSVPs to an event among the activities around it. */
export function fromAnswers(heard: Heard, naming: (actorId: string) => InteractionAuthor): Part {
  const said: [Group, Interaction][] = [];
  for (const activity of heard.activities) {
    const answer = RSVP_ACTIVITIES[activity.activityType];
    if (answer === undefined || !aboutPost(heard, activity)) continue;
    if (taken(heard, activity.activityId)) continue;
    said.push([
      'answers',
      {
        ...reaction(activity, naming, `${activity.actorId}#rsvp`),
        kind: 'reply',
        rsvp: { value: answer, label: RSVP_LABELS[answer] },
      },
    ]);
  }
  return { said };
}

function storedReaction({ kind, actor }: PostComment): string[] {
  const group = GROUP_OF[kind];
  return actor === undefined || (group !== 'likes' && group !== 'boosts')
    ? []
    : [reactionKey(kind, actor)];
}

function reactionKey(kind: InteractionKind, actor: string): string {
  return `${GROUP_OF[kind]}\0${actor}`;
}

function reaction(
  activity: InboxActivity,
  naming: (actorId: string) => InteractionAuthor,
  fallbackId: string,
): Omit<Interaction, 'kind'> {
  const author = naming(activity.actorId);
  return {
    ...unstored(activity.activityId ?? fallbackId),
    source: 'activitypub',
    author,
    url: author.url,
    content: '',
    published: new Date(activity.receivedAt),
    inReplyTo: null,
    status: 'published',
    replies: [],
  };
}

export function fromQuotes(
  context: Reading,
  objectIds: readonly string[],
  naming: (actorId: string) => InteractionAuthor,
): Part {
  const approvals = readAllQuoteAuthorizations(context.contentDir);
  return {
    said: quotesOf(context.admin, approvals, objectIds, naming).map(
      (quote) => ['mentions', quote] as const,
    ),
  };
}

/**
 * The approved quotes of one post, as mentions, in no order.
 *
 * The approval is what makes a quote showable (FEP-044f: a quote its author
 * never approved should not be displayed), so the approvals are walked and the
 * log is asked for each one's note, rather than the other way about. The note
 * has to be the approved one, by the approved actor, quoting this post: an
 * approval of one quote vouches for nothing else. Both are files,
 * so a rebuilt index shows exactly what the live one did.
 */
export function quotesOf(
  admin: AdminStore,
  approvals: readonly QuoteAuthorizationRecord[],
  objectIds: readonly string[],
  naming: (actorId: string) => InteractionAuthor,
): Interaction[] {
  const quotes: Interaction[] = [];
  for (const approval of approvals) {
    if (!objectIds.includes(approval.post)) continue;

    for (const activity of admin.listActivitiesAbout([approval.quote])) {
      if (activity.actorId !== approval.actor) continue;
      const quote = quoteFrom(activity);
      if (quote?.id !== approval.quote || !objectIds.includes(quote.quoted)) continue;

      quotes.push({
        ...unstored(quote.id),
        source: 'activitypub',
        kind: 'mention',
        author: naming(quote.actorId),
        url: quote.url,
        content: sanitizeCommentHtml(quote.html),
        published: quote.published,
        inReplyTo: null,
        status: 'published',
        replies: [],
      });
      // The first `Create` of the note is the one shown: a redelivery is the
      // same quote again.
      break;
    }
  }
  return quotes;
}

/** One logged fediverse reply as the thread's own shape. */
export function federatedInteraction(
  reply: { id: string; url: string; html: string; published: Date; inReplyTo: string },
  author: InteractionAuthor,
): Interaction {
  return {
    ...unstored(reply.id),
    source: 'activitypub',
    kind: 'reply',
    author,
    url: reply.url,
    // Sanitised here, at the edge of the site, so the page and the feed
    // republish the same checked markup rather than each checking for itself.
    content: sanitizeCommentHtml(reply.html),
    published: reply.published,
    inReplyTo: reply.inReplyTo,
    status: 'published',
    replies: [],
  };
}

export function unstored(id: string): Pick<Interaction, 'id' | 'key' | 'guid' | 'migrated'> {
  return { id, key: repliesKey(id), guid: id, migrated: false };
}

/**
 * Every logged activity that has anything to do with a post, oldest first.
 *
 * The log is walked outwards rather than queried once: a reply names the post,
 * a reply to that reply names the reply, and a `Delete` or an `Undo` names the
 * activity it takes back. Each round asks about everything the last round
 * turned up — the object an activity carried and the activity's own id — and
 * stops when a round finds nothing new, which it must, because a row is
 * collected once and there are finitely many.
 */
function activitiesAround(admin: AdminStore, objectIds: readonly string[]): InboxActivity[] {
  const collected = new Map<number, InboxActivity>();
  const asked = new Set<string>(objectIds);
  let frontier: string[] = [...asked];

  while (frontier.length > 0) {
    const next: string[] = [];

    for (const activity of admin.listActivitiesAbout(frontier)) {
      if (collected.has(activity.id)) continue;
      collected.set(activity.id, activity);

      for (const id of [activity.objectId, activity.activityId]) {
        if (id === null || asked.has(id)) continue;
        asked.add(id);
        next.push(id);
      }
    }

    frontier = next;
  }

  // Row ids are the order things arrived in, and the rounds above return them
  // out of that order.
  return [...collected.values()].sort((left, right) => left.id - right.id);
}

/**
 * The ids of everything an actor has taken back: the likes and boosts undone,
 * and the notes deleted.
 *
 * Only by the actor that did it in the first place. Without that check any
 * signed actor could delete somebody else's comment off this page, since the
 * activity carrying the instruction is signed by its sender and says nothing
 * about who the thing it names belonged to — which is the rule the inbox
 * already applies to an `Undo(Follow)`.
 */
function withdrawnBy(activities: readonly InboxActivity[]): Set<string> {
  const owners = new Map<string, string>();
  for (const activity of activities) {
    if (activity.activityId !== null) owners.set(activity.activityId, activity.actorId);
    if (activity.objectId !== null && activity.activityType === REPLY_ACTIVITY_TYPE) {
      owners.set(activity.objectId, activity.actorId);
    }
  }

  const withdrawn = new Set<string>();
  for (const activity of activities) {
    if (activity.activityType !== 'Undo' && activity.activityType !== 'Delete') continue;
    if (activity.objectId === null) continue;
    if (owners.get(activity.objectId) !== activity.actorId) continue;
    withdrawn.add(activity.objectId);
  }
  return withdrawn;
}

/**
 * How an actor is named, memoised for the length of one conversation.
 *
 * A follower is named from the profile it published when it followed, and
 * anybody else from the profile the site fetched when they were first heard
 * from. Both are read from the database: nothing is fetched while a
 * page is drawn. Only an actor neither knows is named by a guess from their
 * URL, which is their server when the URL ends in a number.
 */
export function authorNaming(admin: AdminStore): (actorId: string) => InteractionAuthor {
  const known = new Map<string, InteractionAuthor>();
  // Read once, on the first unknown actor, rather than per actor: the
  // followers are one row per (user, actor) now, so the same
  // stranger may be on the list several times and any of those rows names them
  // the same way — the columns read here are the actor's own name and picture.
  let followers: Map<string, ActorProfile> | undefined;

  return (actorId) => {
    const held = known.get(actorId);
    if (held !== undefined) return held;

    followers ??= new Map(admin.listFollowers().map((entry) => [entry.actorId, entry]));
    const profile = followers.get(actorId) ?? admin.getActorProfile(actorId);
    const handle = profile?.handle ?? actorHandle(actorId) ?? null;
    const icon = profile?.iconUrl ?? null;
    const author: InteractionAuthor = {
      name: profile?.name ?? handle ?? guessedName(actorId),
      handle,
      url: profile?.url ?? actorId,
      avatar: icon === null ? null : avatarHref(icon),
      actorId,
      feed: null,
      username: null,
    };
    known.set(actorId, author);
    return author;
  };
}
