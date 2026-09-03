import type { Context, PageItems } from '@fedify/fedify';
import type { Recipient } from '@fedify/vocab';

import type { Follower } from '../admin/store.ts';
import type { FederationContextData } from './federation.ts';

/**
 * How many followers one page of the collection holds.
 *
 * A constant for the same reason the outbox's is: a page URL is something a
 * peer may come back to, and deriving the size from a setting would move every
 * page boundary the moment somebody changed it.
 */
export const FOLLOWERS_PAGE_SIZE = 20;

/**
 * A stored follower as the {@link Recipient} Fedify delivers to.
 *
 * The shared inbox is offered when the follower published one, because that is
 * what lets a post addressed to a hundred followers on one instance become one
 * POST instead of a hundred. Fedify renders a recipient in the collection as
 * its `id` alone, so the inbox columns cost the collection nothing and are
 * what `ctx.sendActivity(…, 'followers', …)` needs.
 */
export function followerRecipient(follower: Follower): Recipient {
  return {
    id: new URL(follower.actorId),
    inboxId: new URL(follower.inboxId),
    endpoints: {
      sharedInbox: follower.sharedInboxId === null ? null : new URL(follower.sharedInboxId),
    },
  };
}

/**
 * The followers collection, newest follow first: one page of it, or all of it.
 *
 * A cursor is the offset into the list as a decimal string, exactly as the
 * outbox's is, so the two collections page the same way and a cursor keeps
 * meaning what it meant when it was minted.
 *
 * A `null` cursor is not the first page: it is Fedify asking for the whole
 * collection at once, which is what it does before fanning an activity out to
 * the followers. Answering it with a page would strand every follower past the
 * first one silently, so this answers with all of them. The collection a peer
 * reads never arrives here with `null`, because the first cursor is registered
 * and a registered first cursor is what makes the collection paged.
 */
export function followersPage(
  context: Context<FederationContextData>,
  cursor: string | null,
): PageItems<Recipient> {
  const { admin } = context.data;

  if (cursor === null) {
    return { items: admin.listFollowers().map(followerRecipient) };
  }

  const offset = cursorOffset(cursor);
  const followers = admin.listFollowers({ limit: FOLLOWERS_PAGE_SIZE, offset });
  const total = admin.countFollowers();
  const next = offset + FOLLOWERS_PAGE_SIZE;

  return {
    items: followers.map(followerRecipient),
    nextCursor: next < total ? String(next) : null,
    prevCursor: offset <= 0 ? null : String(Math.max(0, offset - FOLLOWERS_PAGE_SIZE)),
  };
}

/**
 * The cursor of the last page of the followers collection: the offset the
 * final whole page starts at, and `0` for a site nobody follows yet.
 */
export function lastFollowersCursor(total: number): string {
  return String(
    total === 0 ? 0 : Math.floor((total - 1) / FOLLOWERS_PAGE_SIZE) * FOLLOWERS_PAGE_SIZE,
  );
}

/** A cursor as an offset. Anything unreadable starts at the beginning. */
function cursorOffset(cursor: string | null): number {
  if (cursor === null || !/^[0-9]+$/.test(cursor)) return 0;
  return Number(cursor);
}
