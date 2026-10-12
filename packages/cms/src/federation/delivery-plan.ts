import type { Actor, Recipient } from '@fedify/vocab';

import type { DeliveryStatus, Follower, NewDelivery, Relay } from '../store/admin-store.ts';
import type { Document } from '../content/document.ts';
import { isMigrated } from '../content/migrated.ts';
import { pinnedAt } from '../content/pinned.ts';
import type { DocumentChange } from '../content/sync.ts';
import { isFederatedDocument } from '../content/served.ts';
import type { Citing, CitedObject } from './citations.ts';
import { followerRecipient } from './followers.ts';
import type { MentionedAccount } from './handles.ts';
import { relayRecipient } from './relays.ts';

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

export function followerTargets(followers: readonly Follower[]): DeliveryTarget[] {
  return [...groupByInbox(followers)].map(([inboxId, members]) => ({
    inboxId,
    recipients: members.map(followerRecipient),
    actorIds: members.map((member) => member.actorId),
  }));
}

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

export function stampFor(document: Document, now: Date): string | undefined {
  const existing = document.activitypub?.published;
  const published = existing ?? document.date ?? now.toISOString();
  return existing === published ? undefined : published;
}

export function wasAnnounced(document: Document): boolean {
  return (document.activitypub?.published ?? '') !== '';
}

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
  if (isMigrated(subject) && !editsACopyFollowersHold(subject, before)) return undefined;

  if (after === undefined) {
    return before === undefined ? undefined : { kind: 'withdraw', before, subject };
  }
  return { kind: 'publish', before, after, subject };
}

function editsACopyFollowersHold(subject: Document, before: Document | undefined): boolean {
  return wasAnnounced(subject) && before !== undefined;
}

function federatedOrUndefined(document: Document | undefined, now: Date): Document | undefined {
  if (document === undefined) return undefined;
  return isFederatedDocument(document, now) ? document : undefined;
}

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
