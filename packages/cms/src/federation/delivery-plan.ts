import type { Actor, Recipient } from '@fedify/vocab';

import type { DeliveryStatus, Follower, NewDelivery, Relay } from '../admin/store.ts';
import type { Document } from '../content/document.ts';
import { isMigrated } from '../content/migrated.ts';
import { pinnedAt } from '../content/pinned.ts';
import type { DocumentChange } from '../content/sync.ts';
import { isFederatedDocument } from './article.ts';
import type { Citing, CitedObject } from './citations.ts';
import { followerRecipient } from './followers.ts';
import type { MentionedAccount } from './handles.ts';
import { relayRecipient } from './relays.ts';

/**
 * The rules a delivery follows, as functions of what they are given: which
 * inboxes an activity goes to, what a post is stamped with, and which activity
 * a change calls for. The delivery service reads the store and the files,
 * calls these, and does what they answer.
 */

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

/** What an activity was, as every outcome row about it records. */
export interface ActivityAbout {
  readonly activityId: string;
  readonly activityType: string;
  readonly objectId: string;
  /** The post it was about, or `null` for an activity about the actor. */
  readonly slug: string | null;
}

/**
 * What a version of a post is to a peer (decision-28), and the id that names
 * it: the post's object id, or its `Like` or `Announce`'s activity id, which
 * carries the id of what it cites.
 */
export type Shape = ObjectShape | CitingShape;

export interface ObjectShape {
  readonly kind: 'object';
  readonly id: string;
  readonly replyTo: CitedObject | undefined;
}

export interface CitingShape {
  readonly kind: 'citing';
  readonly id: string;
  readonly citing: Citing;
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

/** One user's followers as targets, one per inbox they share. */
export function followerTargets(followers: readonly Follower[]): DeliveryTarget[] {
  return [...groupByInbox(followers)].map(([inboxId, members]) => ({
    inboxId,
    recipients: members.map(followerRecipient),
    actorIds: members.map((member) => member.actorId),
  }));
}

/**
 * The accepted relays as targets. A relay is one target of its own rather
 * than a member of a group, because it is one inbox with one actor behind it
 * and no shared inbox to fold into.
 */
export function relayTargets(relays: readonly Relay[]): DeliveryTarget[] {
  return relays.map((relay) => ({
    inboxId: relay.inboxId,
    recipients: [relayRecipient(relay)],
    // The relay's own id, so its outcomes sit in the same table as a
    // follower's and the screen can find them. It has one by the time it is
    // accepted; the inbox is the fallback for a record from somewhere else.
    actorIds: [relay.actorId ?? relay.inboxId],
  }));
}

/** The followers' and relays' targets, then each extra one they do not already reach. */
export function fanOutTargets(
  targets: readonly DeliveryTarget[],
  also: readonly DeliveryTarget[],
): DeliveryTarget[] {
  // One POST to an inbox the followers already share is enough.
  const reached = new Set(targets.map((target) => target.inboxId));
  return [...targets, ...also.filter((target) => !reached.has(target.inboxId))];
}

/** The author of what a post likes, reposts or replies to, as one more inbox to tell. */
export function citedAuthor(author: Actor | undefined): DeliveryTarget[] {
  if (author?.id == null || author.inboxId === null) return [];
  return [
    {
      inboxId: (author.endpoints?.sharedInbox ?? author.inboxId).href,
      recipients: [author],
      actorIds: [author.id.href],
    },
  ];
}

/**
 * Who a post's own object goes to beyond the followers: the author of what it
 * replies to and the accounts its body mentions, one target per inbox.
 */
export function objectTargets(
  replyAuthor: Actor | undefined,
  mentioned: readonly MentionedAccount[],
): DeliveryTarget[] {
  const byInbox = new Map<string, DeliveryTarget>();
  const mentionTargets = mentioned.map(({ account }) => ({
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
  for (const target of [...citedAuthor(replyAuthor), ...mentionTargets]) {
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

/**
 * The rows one POST's outcome is written as: one per actor behind the inbox.
 *
 * What the activity was is written onto every row rather than into a table of
 * its own, because the activity itself is not kept: it is rebuilt from the
 * file whenever it is wanted again (decision-9).
 */
export function deliveryRows(
  about: ActivityAbout,
  target: DeliveryTarget,
  outcome: { readonly status: DeliveryStatus; readonly error: string | null },
): NewDelivery[] {
  return target.actorIds.map((actorId) => ({
    ...about,
    actorId,
    inboxId: target.inboxId,
    ...outcome,
  }));
}

/**
 * The `activitypub.published` a post should carry once it is announced, or
 * `undefined` when the file already carries it.
 *
 * That one key is the whole of the record: it says the post has been
 * announced and when, which is what decides `Create` against `Update` and what
 * a resend needs.
 */
export function stampFor(document: Document, now: Date): string | undefined {
  const existing = document.activitypub?.published;
  const published = existing ?? document.date ?? now.toISOString();
  return existing === published ? undefined : published;
}

/** Whether the followers have been told about a post. */
export function wasAnnounced(document: Document): boolean {
  return (document.activitypub?.published ?? '') !== '';
}

/**
 * What one index change asks of the followers, or `undefined` for nothing.
 *
 * A post that becomes published is published, a post that stops being
 * published — draft, trashed or deleted, which are one thing from outside — is
 * withdrawn, and anything else is nobody's business. A full scan is a rebuild
 * of the index, not news about the site, and a migrated post is only ever
 * delivered as an edit to a copy its followers already hold.
 *
 * `subject` is the post whose author sends it: the file as it now reads, or as
 * it last read when it is gone.
 */
export function deliveryChange(
  change: DocumentChange,
  now: Date,
):
  | { readonly kind: 'withdraw'; readonly before: Document; readonly subject: Document }
  | {
      readonly kind: 'publish';
      readonly before: Document | undefined;
      readonly after: Document;
      readonly subject: Document;
    }
  | undefined {
  if (change.origin === 'scan') return undefined;

  const before = federatedOrUndefined(change.previous, now);
  const after = federatedOrUndefined(change.next, now);
  const subject = change.next ?? change.previous;
  if (subject === undefined || (before === undefined && after === undefined)) return undefined;
  if (isMigrated(subject) && (!wasAnnounced(subject) || before === undefined)) return undefined;

  if (after === undefined) {
    return before === undefined ? undefined : { kind: 'withdraw', before, subject };
  }
  return { kind: 'publish', before, after, subject };
}

function federatedOrUndefined(document: Document | undefined, now: Date): Document | undefined {
  if (document === undefined) return undefined;
  return isFederatedDocument(document, now) ? document : undefined;
}

/**
 * What a save of a post the followers already hold sends, from what it was to
 * a peer and what it is now: an `Update` of the same object, nothing for the
 * same like or repost, which has no content of its own to update, and for
 * anything else — a rename, or a change of what it cites — the old version
 * taken back before the new one goes out.
 */
export function revisionStep(
  was: Shape,
  is: Shape,
):
  | { readonly kind: 'revise'; readonly shape: ObjectShape }
  | { readonly kind: 'none' }
  | { readonly kind: 'replace' } {
  if (was.kind !== is.kind || was.id !== is.id) return { kind: 'replace' };
  return is.kind === 'citing' ? { kind: 'none' } : { kind: 'revise', shape: is };
}

/**
 * Whether a published post went into its author's featured collection or came
 * out of it (TASK-207), and the revision its activity is named by.
 *
 * `featured` is the collection's own answer for the post now, so a pin past
 * the limit is never announced as one. `before` is the post as followers last
 * knew it, or `undefined` when they are about to meet it for the first time.
 */
export function pinChange(
  featured: boolean,
  before: Document | undefined,
  after: Document,
  now: Date,
): { readonly action: 'pin' | 'unpin'; readonly revision: string } | undefined {
  const wasPinned = before !== undefined && pinnedAt(before) !== undefined;
  if (featured && !wasPinned) {
    return { action: 'pin', revision: pinnedAt(after) ?? now.toISOString() };
  }
  if (!featured && wasPinned) return { action: 'unpin', revision: now.toISOString() };
  return undefined;
}
