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

type SiteContext = Context<FederationContextData>;

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
 * Only the sender's own server can name one of its activities, so an `Undo`
 * from anywhere else is ignored.
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

export async function withdrawQuotes(
  context: SiteContext,
  revoked: readonly QuoteAuthorizationRecord[],
): Promise<void> {
  for (const record of revoked)
    await context.data.notices?.undone(QUOTES_NOTIFICATION, record.quote);
}

function isRelay(context: SiteContext, actor: string): boolean {
  return context.data.admin.listRelays().some((relay) => relay.actorId === actor);
}

function named(actor: string, profile: ActorProfile | undefined): NoticeItem['actor'] {
  return {
    name: profile?.name ?? profile?.handle ?? guessedName(actor),
    url: profile?.url ?? actor,
  };
}

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
