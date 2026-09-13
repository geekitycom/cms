import type { FederationOrigin } from '@fedify/fedify';

import { AUTHOR_BASE, INBOX_BASE } from '../web/authors.ts';

/**
 * Where a user's ActivityPub endpoints live: at their author URL, and under it.
 *
 * decision-14 makes every user an actor whose id is their author archive,
 * `{baseUrl}/author/{username}/`, so there is no prefix of its own any more —
 * the actor is a page in a browser and an actor to a peer, exactly as a post
 * is its permalink to both (decision-13). The collections are the archive's
 * children, with the trailing slashes every URL on this site has, and Fedify
 * builds each id from these templates so nothing has to guess the form.
 *
 * A GET of `/author/ada` without the slash is a Fedify 404 that falls through
 * to the public site's own canonical redirect, which is where a browser that
 * followed an actor id without its slash lands (doc-8).
 */
export const ACTOR_PATH = `/${AUTHOR_BASE}/{identifier}/` as const;

/** The actor's inbox, its outbox and its two follow collections. */
export const INBOX_PATH = `${ACTOR_PATH}inbox/` as const;
export const OUTBOX_PATH = `${ACTOR_PATH}outbox/` as const;
export const FOLLOWERS_PATH = `${ACTOR_PATH}followers/` as const;
export const FOLLOWING_PATH = `${ACTOR_PATH}following/` as const;

/**
 * The instance-wide inbox, which a peer may use to deliver to every actor at
 * once.
 *
 * A reserved top-level path (decision-14), which is why `inbox` is one of the
 * two names `web/authors.ts` keeps a user from taking.
 */
export const SHARED_INBOX_PATH = `/${INBOX_BASE}/` as const;

/** Where a user's mention-style short URL lives: `/@ada`, WordPress's alias. */
export function handleHref(username: string): string {
  return `/@${encodeURIComponent(username)}`;
}

/** Where the NodeInfo 2.1 document lives; `/.well-known/nodeinfo` points at it. */
export const NODEINFO_PATH = '/nodeinfo/2.1';

/**
 * The id of the `Create` that announced an object.
 *
 * A fragment of the object's own id, so it is derivable from the article
 * without a second lookup and stable for as long as the article's id is. An
 * activity is not dereferenceable on its own here; naming it is what lets a
 * peer recognise the same announcement twice.
 */
export function createActivityId(objectId: URL | string): URL {
  return new URL(`${objectId.toString()}#create`);
}

/**
 * The id of the `Update` that announced one revision of an object.
 *
 * A `Create` happens once and so needs no revision in its id; an `Update`
 * happens as often as the post is edited, and an activity id a peer has
 * already seen is one it is entitled to ignore. The revision is the document's
 * content hash, which makes the id deterministic — the same edit redelivered
 * is the same activity rather than a second one — and unique, because the sync
 * only reports an update when the hash has moved.
 */
export function updateActivityId(objectId: URL | string, revision: string): URL {
  return new URL(`${objectId.toString()}#update/${encodeURIComponent(revision)}`);
}

/**
 * The id of the `Delete` that withdrew an object.
 *
 * The revision is when the deletion happened, because a post can be
 * unpublished, published again and unpublished again, and each of those is a
 * `Delete` a peer should act on rather than recognise and skip.
 */
export function deleteActivityId(objectId: URL | string, revision: string): URL {
  return new URL(`${objectId.toString()}#delete/${encodeURIComponent(revision)}`);
}

/**
 * The origin a base URL federates under: its host for handles, its scheme and
 * authority for ids.
 *
 * The path is dropped, and has to be. WebFinger and NodeInfo are defined at
 * `/.well-known/…` on the host, not under whatever directory a site happens to
 * be mounted in, so a site at `https://example.com/blog` is still the actor
 * `@blog@example.com` and still answers discovery at the host root. Its posts
 * keep their base path; only the federation endpoints ignore it.
 */
export function federationOrigin(baseUrl: string): FederationOrigin {
  const url = new URL(baseUrl);
  return { handleHost: url.host, webOrigin: url.origin };
}
