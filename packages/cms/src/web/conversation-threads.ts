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

interface Threading {
  readonly said: Gathered;
  readonly under: string;
  readonly shown: ReadonlyMap<string, Interaction>;
  readonly targets: ReadonlyMap<string, string>;
  readonly top: ThreadReply[];
  readonly placeholders: Map<string, WithheldReply | undefined>;
}

export function threadOf(said: Gathered, under: string = said.root): ThreadReply[] {
  const threading = startThreading(said, under);
  for (const reply of threading.shown.values()) {
    const native = reply.source !== 'activitypub';
    listJoinedBy(threading, threading.targets.get(reply.id), reply.id, native)?.push(reply);
  }
  return threading.top;
}

function startThreading(said: Gathered, under: string): Threading {
  const shown = new Map<string, Interaction>();
  const targets = new Map<string, string>();
  for (const reply of said.written) {
    targets.set(reply.id, reply.inReplyTo ?? said.root);
    if (!said.withdrawn.has(reply.id)) shown.set(reply.id, reply);
  }
  return { said, under, shown, targets, top: [], placeholders: new Map() };
}

function listJoinedBy(
  threading: Threading,
  target: string | undefined,
  self: string,
  native: boolean,
): ThreadReply[] | undefined {
  const { said, under, shown, targets } = threading;
  const stepLimitAgainstCycles = targets.size + 1;
  for (let step = 0; step < stepLimitAgainstCycles; step += 1) {
    if (target === undefined) return undefined;
    if (target === under) return threading.top;
    if (target === said.root) return undefined;

    const parent = shown.get(target);
    if (parent !== undefined) return parent.id === self ? undefined : parent.replies;
    if (answersHiddenComment(threading, target, native)) {
      return placeholderFor(threading, target)?.replies;
    }
    target = targets.get(target);
  }
  return undefined;
}

function answersHiddenComment(threading: Threading, target: string, native: boolean): boolean {
  const heldBackComment = threading.said.held.has(target);
  const deletedNativeComment = native && !threading.targets.has(target);
  return heldBackComment || deletedNativeComment;
}

function placeholderFor(threading: Threading, id: string): WithheldReply | undefined {
  const { placeholders } = threading;
  if (placeholders.has(id)) return placeholders.get(id);
  placeholders.set(id, undefined);
  const list = listJoinedBy(threading, hiddenCommentTarget(threading.said, id), id, true);
  if (list === undefined) return undefined;
  const entry = withheldReply(id);
  list.push(entry);
  placeholders.set(id, entry);
  return entry;
}

function hiddenCommentTarget(said: Gathered, id: string): string {
  return said.held.get(id)?.inReplyTo ?? said.root;
}

function withheldReply(id: string): WithheldReply {
  const key = isKey(id) ? id : repliesKey(id);
  return { id, key, withheld: true, replies: [] };
}

export function byPublished(left: Interaction, right: Interaction): number {
  return left.published.getTime() - right.published.getTime();
}

function startOf(reply: ThreadReply): number {
  if (!isWithheld(reply)) return reply.published.getTime();
  const [first] = reply.replies;
  return first === undefined ? 0 : startOf(first);
}

export function sortThread(replies: ThreadReply[]): void {
  for (const reply of replies) sortThread(reply.replies);
  replies.sort((left, right) => startOf(left) - startOf(right));
}

export function countReplies(replies: readonly ThreadReply[]): number {
  let total = 0;
  for (const reply of replies) total += (isWithheld(reply) ? 0 : 1) + countReplies(reply.replies);
  return total;
}

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

export function saidIn(conversation: Conversation): Placed[] {
  return [
    ...conversation.mentions.map((mention) => ({ ...mention, parent: null })),
    ...placed(conversation.replies),
  ];
}

export function conversational(entry: Interaction): boolean {
  return !entry.migrated && (entry.kind === 'reply' || entry.kind === 'mention');
}

function placed(replies: readonly ThreadReply[], parent: Interaction | null = null): Placed[] {
  return directReplies(replies).flatMap((reply) => [
    { ...reply, parent },
    ...placed(reply.replies, reply),
  ]);
}

function directReplies(replies: readonly ThreadReply[]): Interaction[] {
  return replies.flatMap((reply) => (isWithheld(reply) ? directReplies(reply.replies) : [reply]));
}

export function repliesFed(replies: readonly ThreadReply[]): Interaction[] {
  return directReplies(replies).filter(conversational);
}
