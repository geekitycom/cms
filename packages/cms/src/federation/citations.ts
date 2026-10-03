/**
 * How a like or a repost federates (decision-28): as the `Like` or `Announce`
 * of the fediverse object it cites, when what it cites is one. Every other
 * post, a bookmark included, federates as the `Note` or `Article` it is, whose
 * content links the page it cites. A reply to a fediverse status names that
 * status by its id and mentions its author (TASK-240).
 */

import type { Context } from '@fedify/fedify';
import { Announce, isActor, Like, PUBLIC_COLLECTION, Undo } from '@fedify/vocab';
import type { Actor } from '@fedify/vocab';

import type { User } from '../admin/accounts.ts';
import { citationOf } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { postTypeOf, replyTarget } from '../content/post-type.ts';
import { actorId, senderKeyPairs } from './actor.ts';
import { articleObjectId, documentAuthor, toInstant } from './article.ts';
import type { FederationContextData } from './federation.ts';

export type CitingActivity = Like | Announce;

/** A like or a repost of a fediverse object, and the author it goes to. */
export interface Citing {
  readonly activity: CitingActivity;
  /** Who wrote the object, when they say, so they hear about it. */
  readonly author: Actor | undefined;
}

/**
 * The `Like` or `Announce` a post sends, or `undefined` for a post that is no
 * like or repost, or whose target is not a fediverse object this site can
 * fetch ({@link lookupCited}).
 *
 * The activity id carries the object's id, so a like moved to another target
 * is a second activity rather than one a peer has already seen.
 */
export async function citingActivity(
  context: Context<FederationContextData>,
  document: Document,
): Promise<Citing | undefined> {
  const postType = postTypeOf(document);
  if (postType !== 'like' && postType !== 'repost') return undefined;
  const target = citationOf(document, postType === 'like' ? 'like-of' : 'repost-of');
  const user = documentAuthor(context, document);
  if (target === undefined || user === undefined) return undefined;
  const object = await lookupCited(context, user, target);
  if (object === undefined) return undefined;
  const { author } = object;

  const actor = actorId(context, user);
  const followers = context.getFollowersUri(user.username);
  const authorId = author?.id ?? undefined;
  const postId = articleObjectId(context, document);
  const common = {
    actor,
    object: object.id,
    published: toInstant(document.date) ?? null,
  };
  const of = encodeURIComponent(object.id.href);
  // A repost is public, as a boost is; a like is addressed to the one who
  // wrote what it likes, and copied to the followers as every activity is.
  const activity =
    postType === 'repost'
      ? new Announce({
          ...common,
          id: new URL(`${postId.href}#announce/${of}`),
          to: PUBLIC_COLLECTION,
          ccs: authorId === undefined ? [followers] : [followers, authorId],
        })
      : new Like({
          ...common,
          id: new URL(`${postId.href}#like/${of}`),
          tos: authorId === undefined ? [] : [authorId],
          cc: followers,
        });
  return { activity, author };
}

/** A fediverse object a post cites, by the id its server gives it, and who wrote it. */
export interface CitedObject {
  readonly id: URL;
  readonly author: Actor | undefined;
}

/**
 * The fediverse status a reply answers (TASK-240), or `undefined` for a reply
 * to anything else, which federates with the URL it names as its `inReplyTo`.
 *
 * A reply to one of the site's own pages is not looked up: its URL is already
 * the object's id, and its author is this site, which needs no telling.
 */
export async function repliedTo(
  context: Context<FederationContextData>,
  document: Document,
): Promise<CitedObject | undefined> {
  const target = replyTarget(document);
  const user = documentAuthor(context, document);
  if (target === undefined || user === undefined) return undefined;
  if (new URL(target).origin === new URL(context.data.config.baseUrl).origin) return undefined;
  return await lookupCited(context, user, target);
}

/**
 * What `target` is as a fediverse object, or `undefined` when it is none this
 * site can fetch: a page with no ActivityPub form, an actor, or a host that
 * does not answer.
 *
 * The object is named by the id its server gives it, not by the URL the post
 * cites, because a status's page and its id are often two URLs. The fetch is
 * signed as the post's author, as a server in authorized fetch mode needs.
 */
async function lookupCited(
  context: Context<FederationContextData>,
  user: User,
  target: string,
): Promise<CitedObject | undefined> {
  const [key] = await senderKeyPairs(context, user);
  const loaders = {
    documentLoader: key === undefined ? context.documentLoader : context.getDocumentLoader(key),
    contextLoader: context.contextLoader,
  };
  let object;
  try {
    object = await context.lookupObject(target, loaders);
  } catch {
    return undefined;
  }
  if (object === null || isActor(object) || object.id === null) return undefined;

  try {
    const attributed = await object.getAttribution(loaders);
    const author = isActor(attributed) && attributed.inboxId !== null ? attributed : undefined;
    return { id: object.id, author };
  } catch {
    return { id: object.id, author: undefined };
  }
}

/**
 * The `Undo` that takes a like or a repost back, addressed as the activity
 * it undoes was. `revision` is the moment, as a `Delete`'s is, since a post
 * can be liked, taken back and liked again.
 */
export function undoActivity(activity: CitingActivity, revision: string): Undo {
  if (activity.id === null || activity.actorId === null) {
    throw new TypeError('Only an activity with an id and an actor can be undone.');
  }
  return new Undo({
    id: new URL(`${activity.id.href.replace(/#.*$/, '')}#undo/${encodeURIComponent(revision)}`),
    actor: activity.actorId,
    object: activity,
    tos: activity.toIds,
    ccs: activity.ccIds,
  });
}
