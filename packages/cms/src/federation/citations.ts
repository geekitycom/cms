/**
 * How a like or a repost federates: as the `Like` or `Announce`
 * of the fediverse object it cites, when what it cites is one. Every other
 * post, a bookmark included, federates as the `Note` or `Article` it is, whose
 * content links the page it cites.
 */

import { FetchError } from '@fedify/fedify';
import type { Context, DocumentLoader } from '@fedify/fedify';
import { Announce, isActor, Like, PUBLIC_COLLECTION, Undo } from '@fedify/vocab';
import type { Actor } from '@fedify/vocab';

import { citationOf } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { postTypeOf, replyTarget } from '../content/post-type.ts';
import type { User } from '../site/users.ts';
import { messageOf } from '../util/errors.ts';
import { actorId, senderKeyPairs } from './actor.ts';
import { articleObjectId, documentAuthor, toInstant } from './article.ts';
import type { FederationContextData } from './federation.ts';
import { recordResolvedTarget, resolvedTarget } from './reply-targets.ts';

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
 * fetch ({@link resolveCited}).
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
  const object = await resolveCited(context, user, target);
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

export interface CitedObject {
  readonly id: URL;
  readonly author: Actor | undefined;
}

export async function repliedTo(
  context: Context<FederationContextData>,
  document: Document,
): Promise<CitedObject | undefined> {
  const target = replyTarget(document);
  const user = documentAuthor(context, document);
  if (target === undefined || user === undefined) return undefined;
  if (new URL(target).origin === new URL(context.data.config.baseUrl).origin) return undefined;
  return await resolveCited(context, user, target);
}

/**
 * What a post cites, as a fediverse object, or `undefined` when it is none.
 * Which activity a post sends turns on the answer, so a server that cannot be
 * reached right now does not count as one: the answer last recorded stands
 * in, without the author it no longer names, and with none recorded the
 * delivery fails rather than send what may be the wrong activity.
 */
async function resolveCited(
  context: Context<FederationContextData>,
  user: User,
  target: string,
): Promise<CitedObject | undefined> {
  const { contentDir } = context.data.config;
  const looked = await lookupCited(context, user, target);
  if (looked.kind === 'unreachable') {
    const recorded = resolvedTarget(contentDir, target);
    if (recorded === undefined) {
      throw new Error(
        `${target} could not be looked up (${messageOf(looked.error)}), so nothing was sent ` +
          'for the post that cites it. Save or resend the post once it answers.',
      );
    }
    return recorded === null ? undefined : { id: new URL(recorded), author: undefined };
  }
  await recordResolvedTarget(contentDir, target, looked.object?.id.href ?? null);
  return looked.object;
}

type Lookup =
  | { readonly kind: 'answered'; readonly object: CitedObject | undefined }
  | { readonly kind: 'unreachable'; readonly error: unknown };

/**
 * The object is named by the id its server gives it, not by the URL the post
 * cites, because a status's page and its id are often two URLs. The fetch is
 * signed as the post's author, as a server in authorized fetch mode needs.
 */
async function lookupCited(
  context: Context<FederationContextData>,
  user: User,
  target: string,
): Promise<Lookup> {
  const [key] = await senderKeyPairs(context, user);
  const load = key === undefined ? context.documentLoader : context.getDocumentLoader(key);
  // `lookupObject` answers `null` for a fetch that failed however it failed,
  // so the failure is caught on its way through the loader.
  let failure: { readonly error: unknown } | undefined;
  const documentLoader: DocumentLoader = async (url, options) => {
    try {
      return await load(url, options);
    } catch (error) {
      if (!answersNoObject(error)) failure ??= { error };
      throw error;
    }
  };
  const loaders = { documentLoader, contextLoader: context.contextLoader };
  let object;
  try {
    object = await context.lookupObject(target, loaders);
  } catch {
    object = null;
  }
  if (object === null && failure !== undefined) return { kind: 'unreachable', ...failure };
  if (object === null || isActor(object) || object.id === null) {
    return { kind: 'answered', object: undefined };
  }

  try {
    const attributed = await object.getAttribution(loaders);
    const author = isActor(attributed) && attributed.inboxId !== null ? attributed : undefined;
    return { kind: 'answered', object: { id: object.id, author } };
  } catch {
    return { kind: 'answered', object: { id: object.id, author: undefined } };
  }
}

/**
 * Whether a failed fetch is the server's settled answer that there is no
 * ActivityPub document there: gone, not found, or a page that is not one.
 * A timeout, a refusal, a rate limit or a server error says nothing either way.
 */
function answersNoObject(error: unknown): boolean {
  if (error instanceof SyntaxError) return true;
  if (!(error instanceof FetchError) || error.response === undefined) return false;
  const { status } = error.response;
  return status === 404 || status === 410 || (status >= 200 && status < 300);
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
