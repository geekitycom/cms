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

export type Group = 'written' | 'likes' | 'boosts' | 'mentions' | 'answers';

export const GROUP_OF: Readonly<Record<InteractionKind, Group>> = {
  reply: 'written',
  like: 'likes',
  boost: 'boosts',
  repost: 'boosts',
  mention: 'mentions',
};

export interface Part {
  readonly said: readonly (readonly [Group, Interaction])[];
  readonly held?: ReadonlyMap<string, Interaction>;
  readonly withdrawn?: ReadonlySet<string>;
}

const REACTIONS: Readonly<Record<string, InteractionKind | undefined>> = {
  Like: 'like',
  Announce: 'boost',
};

const RSVP_ACTIVITIES: Readonly<Record<string, RsvpValue | undefined>> = {
  Accept: 'yes',
  TentativeAccept: 'maybe',
  Reject: 'no',
};

export interface Heard {
  readonly root: string;
  readonly named: ReadonlySet<string>;
  readonly activities: readonly InboxActivity[];
  readonly withdrawn: ReadonlySet<string>;
}

export function heardAbout(
  context: Reading,
  root: string,
  objectIds: ObjectIds,
  stored: readonly PostComment[],
): Heard {
  const origins = stored.flatMap((comment) =>
    comment.source === 'activitypub' && comment.origin !== undefined ? [comment.origin] : [],
  );
  const activities = activitiesAround(context.admin, [...objectIds, ...origins]);
  return { root, named: new Set(objectIds), activities, withdrawn: withdrawnByOwner(activities) };
}

function aboutPost(heard: Heard, activity: InboxActivity): boolean {
  return activity.objectId !== null && heard.named.has(activity.objectId);
}

function taken(heard: Heard, activityId: string | null): boolean {
  return activityId !== null && heard.withdrawn.has(activityId);
}

export function fromActivities(
  context: Reading,
  heard: Heard,
  stored: readonly PostComment[],
  naming: (actorId: string) => InteractionAuthor,
): Part {
  const reacted = new Set(stored.flatMap(storedReaction));
  const said: [Group, Interaction][] = [];

  for (const activity of heard.activities) {
    const kind = REACTIONS[activity.activityType];
    if (kind === undefined) {
      const reply = replyIn(context, heard, activity, naming);
      if (reply !== undefined) said.push(['written', reply]);
      continue;
    }

    if (!aboutPost(heard, activity)) continue;
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

// FEP-044f: a quote its author never approved should not be displayed.
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
      break;
    }
  }
  return quotes;
}

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

  return [...collected.values()].sort((left, right) => left.id - right.id);
}

function withdrawnByOwner(activities: readonly InboxActivity[]): Set<string> {
  const owners = ownersOf(activities);
  const withdrawn = new Set<string>();
  for (const activity of activities) {
    if (activity.activityType !== 'Undo' && activity.activityType !== 'Delete') continue;
    if (activity.objectId === null) continue;
    if (!sentByOwner(activity.actorId, activity.objectId, owners)) continue;
    withdrawn.add(activity.objectId);
  }
  return withdrawn;
}

function ownersOf(activities: readonly InboxActivity[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const activity of activities) {
    if (activity.activityId !== null) owners.set(activity.activityId, activity.actorId);
    if (activity.objectId !== null && activity.activityType === REPLY_ACTIVITY_TYPE) {
      owners.set(activity.objectId, activity.actorId);
    }
  }
  return owners;
}

function sentByOwner(
  actorId: string,
  objectId: string,
  owners: ReadonlyMap<string, string>,
): boolean {
  return owners.get(objectId) === actorId;
}

export function authorNaming(admin: AdminStore): (actorId: string) => InteractionAuthor {
  const known = new Map<string, InteractionAuthor>();
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
