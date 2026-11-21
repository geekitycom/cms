import type { Context } from '@fedify/fedify';
import { Announce, Link, Object as APObject } from '@fedify/vocab';
import type { Actor, Like, QuoteRequest } from '@fedify/vocab';

import { postLabel } from '../content/post-type.ts';
import { sanitizeCommentHtml } from '../content/sanitize.ts';
import { htmlToText } from '../content/search.ts';
import {
  FOLLOWERS_NOTIFICATION,
  QUOTES_NOTIFICATION,
  REACTIONS_NOTIFICATION,
} from '../notifications/activity.ts';
import type { NoticeItem } from '../notifications/notice-log.ts';
import type { User } from '../site/users.ts';
import type { ActorProfile } from '../store/profiles.ts';
import { guessedName } from '../store/inbox-replies.ts';
import { absoluteUrl } from '../util/url.ts';
import { actorId } from './actor.ts';
import { postByObjectId } from './article.ts';
import type { FederationContextData } from './federation.ts';
import { profileFrom } from './profiles.ts';
import type { QuoteAuthorizationRecord } from './quotes.ts';

/**
 * What the inbox tells the activity notices, worked out from what it was
 * sent: who did it, named the way a person knows them, and which of the
 * site's posts or accounts they did it to.
 *
 * Each is called once, where the inbox first knows the thing is new: a like
 * whose id the log has not seen, a follow that added a follower, a quote the
 * site had not approved before. A redelivery is none of those, so it tells
 * nobody twice.
 */

type SiteContext = Context<FederationContextData>;

/**
 * A like or a boost of one of the site's posts, the first time the log holds
 * it. A relay is not somebody boosting a post: it is the subscription doing
 * what it is for.
 */
export async function noticeReaction(
  context: SiteContext,
  activity: Like | Announce,
): Promise<void> {
  const { notices, store, config, admin } = context.data;
  const actor = activity.actorId;
  if (notices === undefined || actor === null || activity.objectId === null) return;
  if (isRelay(context, actor.href)) return;
  const post = postByObjectId(store, activity.objectId.href, config);
  if (post === undefined || !(await notices.wanted(REACTIONS_NOTIFICATION))) return;

  const known =
    admin.listFollowers().find((one) => one.actorId === actor.href) ??
    admin.getActorProfile(actor.href) ??
    (await fetchedProfile(context, activity));

  await notices.happened(REACTIONS_NOTIFICATION, {
    key:
      activity.id?.href ??
      `${activity instanceof Announce ? 'Announce' : 'Like'} ${actor.href} ${activity.objectId.href}`,
    actor: named(actor.href, known),
    action: activity instanceof Announce ? 'boosted' : 'liked',
    post: {
      title: postLabel(post, context.data.cited),
      url: absoluteUrl(post.permalink, config.baseUrl),
    },
  });
}

/** Somebody who was not following a user of the site now is. */
export async function noticeFollower(
  context: SiteContext,
  followId: string,
  followed: User,
  follower: ActorProfile,
): Promise<void> {
  const { notices, config } = context.data;
  if (notices === undefined || isRelay(context, follower.actorId)) return;

  await notices.happened(FOLLOWERS_NOTIFICATION, {
    key: followId,
    actor: named(follower.actorId, follower),
    action: 'followed',
    post: {
      title: `@${followed.username}@${new URL(config.baseUrl).host}`,
      url: actorId(context, followed).href,
    },
  });
}

/** A quote the site has just approved for the first time. */
export async function noticeQuote(
  context: SiteContext,
  record: QuoteAuthorizationRecord,
  quoted: { title: string; url: string },
  requester: Actor,
  request: QuoteRequest,
): Promise<void> {
  const { notices } = context.data;
  if (notices === undefined || !(await notices.wanted(QUOTES_NOTIFICATION))) return;

  const quote = await request
    .getInstrument({
      documentLoader: context.documentLoader,
      contextLoader: context.contextLoader,
      suppressError: true,
    })
    .catch(() => null);
  const words =
    quote instanceof APObject && quote.content !== null
      ? htmlToText(sanitizeCommentHtml(quote.content.toString())).trim()
      : '';

  await notices.happened(QUOTES_NOTIFICATION, {
    key: record.quote,
    actor: named(record.actor, await profileFrom(requester, context)),
    action: 'quoted',
    post: quoted,
    text: words === '' ? undefined : words,
    url: quote instanceof APObject ? (hrefOf(quote.url) ?? record.quote) : record.quote,
  });
}

/**
 * An `Undo` took back a like, a boost or a follow: whichever it was, it
 * leaves any digest that has not gone. Only the sender's own server can name
 * one of its activities, so an `Undo` from anywhere else is ignored.
 */
export async function withdrawUndone(
  context: SiteContext,
  undoer: string,
  undone: string,
): Promise<void> {
  const { notices } = context.data;
  if (notices === undefined || !sameOrigin(undoer, undone)) return;
  await notices.undone(REACTIONS_NOTIFICATION, undone);
  await notices.undone(FOLLOWERS_NOTIFICATION, undone);
}

/** Quotes whose approval was withdrawn leave any digest that has not gone. */
export async function withdrawQuotes(
  context: SiteContext,
  revoked: readonly QuoteAuthorizationRecord[],
): Promise<void> {
  for (const record of revoked)
    await context.data.notices?.undone(QUOTES_NOTIFICATION, record.quote);
}

/** Whether this actor is a relay the site subscribes to rather than a person. */
function isRelay(context: SiteContext, actor: string): boolean {
  return context.data.admin.listRelays().some((relay) => relay.actorId === actor);
}

function named(actor: string, profile: ActorProfile | undefined): NoticeItem['actor'] {
  return {
    name: profile?.name ?? profile?.handle ?? guessedName(actor),
    url: profile?.url ?? actor,
  };
}

/**
 * The profile of an actor the site has heard nothing of yet, read now rather
 * than by the background capture, because the notice is written now.
 */
async function fetchedProfile(
  context: SiteContext,
  activity: Like | Announce,
): Promise<ActorProfile | undefined> {
  const actor = await activity
    .getActor({
      documentLoader: context.documentLoader,
      contextLoader: context.contextLoader,
      suppressError: true,
    })
    .catch(() => null);
  return actor === null ? undefined : await profileFrom(actor, context);
}

function hrefOf(value: URL | Link | null): string | undefined {
  if (value === null) return undefined;
  return value instanceof URL ? value.href : value.href?.href;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
