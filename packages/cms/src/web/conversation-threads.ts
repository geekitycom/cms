import { isWithheld } from '../comments/conversation.ts';
import type {
  Conversation,
  Interaction,
  Placed,
  RsvpGroup,
  ThreadReply,
  WithheldReply,
} from '../comments/conversation.ts';
import { isKey, repliesKey } from '../content/guids.ts';
import { RSVP_LABELS } from '../content/rsvp.ts';
import type { RsvpValue } from '../content/rsvp.ts';
import type { Gathered } from './conversation-gather.ts';

const RSVP_GROUP_ORDER: readonly RsvpValue[] = ['yes', 'maybe', 'interested', 'no'];

/**
 * The replies as a thread: those answering `under` at the top, each carrying
 * the replies that answer it, oldest first at every level. `under` is the
 * post, or one reply for that reply's own page.
 *
 * Four things decide where a reply goes, and all four are what somebody
 * reading the page would expect:
 *
 * - A reply whose target is gone — deleted by its author — is shown under
 *   whatever *that* was answering, rather than disappearing with it. The
 *   conversation stays readable and only the withdrawn note is missing.
 * - A reply answering a native comment a reader may not see is
 *   shown under a placeholder for it, the way the reply's own page shows it.
 *   A comment waiting for a moderator or filed as spam still says what it
 *   answers, and the placeholder goes there; a deleted one is known by
 *   nothing, so its placeholder goes under the post. A hidden comment nobody
 *   visible answered gets no placeholder at all.
 * - A reply answering something that is no part of this conversation is left
 *   out. The log holds it because it named something this walk asked about — a
 *   note answering the like of a post is the shape of that — but the post is
 *   not what it is talking about.
 * - A note the site was told about twice is one reply, because the map is
 *   keyed by the note's own id.
 *
 * The walk is bounded by the number of notes, and a placeholder is made once,
 * so a log carrying a cycle — two notes each claiming to answer the other,
 * which nothing stops a remote server from sending — ends rather than hangs.
 */
export function threadOf(said: Gathered, under: string = said.root): ThreadReply[] {
  const shown = new Map<string, Interaction>();
  const targets = new Map<string, string>();
  for (const reply of said.written) {
    targets.set(reply.id, reply.inReplyTo ?? said.root);
    if (!said.withdrawn.has(reply.id)) shown.set(reply.id, reply);
  }

  const top: ThreadReply[] = [];
  const withheld = new Map<string, WithheldReply | undefined>();

  // The list an entry answering `target` joins, or `undefined` for one that
  // belongs somewhere else. Only a native entry can answer a deleted comment:
  // a fediverse note naming an unknown id is answering something else.
  const siblings = (
    target: string | undefined,
    self: string,
    native: boolean,
  ): ThreadReply[] | undefined => {
    for (let step = 0; step <= targets.size; step += 1) {
      if (target === undefined) return undefined;
      if (target === under) return top;
      if (target === said.root) return undefined;

      const parent = shown.get(target);
      if (parent !== undefined) return parent.id === self ? undefined : parent.replies;
      if (said.held.has(target) || (native && !targets.has(target))) {
        return placeholder(target)?.replies;
      }
      target = targets.get(target);
    }
    return undefined;
  };

  const placeholder = (id: string): WithheldReply | undefined => {
    if (withheld.has(id)) return withheld.get(id);
    withheld.set(id, undefined);
    const list = siblings(said.held.get(id)?.inReplyTo ?? said.root, id, true);
    if (list === undefined) return undefined;
    const key = isKey(id) ? id : repliesKey(id);
    const entry: WithheldReply = { id, key, withheld: true, replies: [] };
    list.push(entry);
    withheld.set(id, entry);
    return entry;
  };

  for (const reply of shown.values()) {
    siblings(targets.get(reply.id), reply.id, reply.source !== 'activitypub')?.push(reply);
  }

  return top;
}

/** Oldest first, which is the order a conversation reads in. */
export function byPublished(left: Interaction, right: Interaction): number {
  return left.published.getTime() - right.published.getTime();
}

/**
 * When a thread entry starts: a reply's own date, and a placeholder's first
 * visible reply's, since the date of a hidden comment is not the reader's.
 */
function startOf(reply: ThreadReply): number {
  if (!isWithheld(reply)) return reply.published.getTime();
  const [first] = reply.replies;
  return first === undefined ? 0 : startOf(first);
}

/** Put every level of a thread in time order, all the way down. */
export function sortThread(replies: ThreadReply[]): void {
  for (const reply of replies) sortThread(reply.replies);
  replies.sort((left, right) => startOf(left) - startOf(right));
}

/** How many visible replies a thread holds, counting all the way down. */
export function countReplies(replies: readonly ThreadReply[]): number {
  let total = 0;
  for (const reply of replies) total += (isWithheld(reply) ? 0 : 1) + countReplies(reply.replies);
  return total;
}

/**
 * What a reply answers, from the top of the thread down to its parent.
 *
 * An ancestor a reader may not see is a `null`, and the walk goes on through
 * what that one answered when the site still knows it: a pending or spam
 * comment is in the index, and a withdrawn note is still in the log. A deleted
 * comment is known by nothing, so the chain stops at it and goes straight to
 * the post. Each id is visited once, so a cycle ends.
 */
export function ancestorsOf(said: Gathered, reply: Interaction): (Interaction | null)[] {
  const all = new Map(said.written.map((entry) => [entry.id, entry]));
  const chain: (Interaction | null)[] = [];
  const seen = new Set<string>([reply.id]);

  for (let target = reply.inReplyTo; target !== null && target !== said.root;) {
    if (seen.has(target)) break;
    seen.add(target);

    const known = all.get(target);
    if (known !== undefined && !said.withdrawn.has(target)) {
      chain.unshift(known);
      target = known.inReplyTo;
      continue;
    }

    chain.unshift(null);
    target = (known ?? said.held.get(target))?.inReplyTo ?? null;
  }

  return chain;
}

export function rsvpGroups(answers: readonly Interaction[]): RsvpGroup[] {
  const people = latestAnswerPerPerson(answers);
  return RSVP_GROUP_ORDER.map((value) => ({
    value,
    label: RSVP_LABELS[value],
    people: people.filter((person) => person.rsvp?.value === value),
  })).filter((group) => group.people.length > 0);
}

function latestAnswerPerPerson(answers: readonly Interaction[]): Interaction[] {
  const latest = new Map<string, Interaction>();
  for (const answer of [...answers].sort(byPublished)) {
    const { author } = answer;
    latest.set(author.actorId ?? author.url ?? answer.id, answer);
  }
  return [...latest.values()].sort(byPublished);
}

/** The mentions and every visible reply of a conversation, each with its parent. */
export function saidIn(conversation: Conversation): Placed[] {
  return [
    ...conversation.mentions.map((mention) => ({ ...mention, parent: null })),
    ...placed(conversation.replies),
  ];
}

/**
 * Whether a feed carries it and a reply count counts it: somebody's
 * words, a reply or a mention, said here. A like, a boost or a repost says
 * nothing — "@ada liked this" would be an item with an empty body — and a
 * migrated entry was published before the site came here, so a reader must
 * not see it as new.
 */
export function conversational(entry: Interaction): boolean {
  return !entry.migrated && (entry.kind === 'reply' || entry.kind === 'mention');
}

/** Every visible reply of a thread at any depth, each with the reply it sits under. */
function placed(replies: readonly ThreadReply[], parent: Interaction | null = null): Placed[] {
  return directReplies(replies).flatMap((reply) => [
    { ...reply, parent },
    ...placed(reply.replies, reply),
  ]);
}

/**
 * The visible replies directly under an entry of a thread: a
 * hidden comment's visible replies count as its parent's, as {@link Placed}
 * says, so every visible reply is directly under exactly one thing.
 */
function directReplies(replies: readonly ThreadReply[]): Interaction[] {
  return replies.flatMap((reply) => (isWithheld(reply) ? directReplies(reply.replies) : [reply]));
}

/** The direct replies a feed carries and a count advertises. */
export function repliesFed(replies: readonly ThreadReply[]): Interaction[] {
  return directReplies(replies).filter(conversational);
}
