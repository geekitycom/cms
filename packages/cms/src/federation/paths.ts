import type { FederationOrigin } from '@fedify/fedify';

/**
 * Where the ActivityPub endpoints live, under one prefix so they never
 * collide with a permalink. doc-4 puts post objects at `/ap/posts/{slug}`;
 * the actor is its sibling.
 */
export const FEDERATION_PREFIX = '/ap';

/**
 * The actor's path template.
 *
 * The identifier is a template variable because Fedify requires one, but only
 * the site actor's sentinel identifier ever answers: a site is one actor.
 * Because that identifier is a constant rather than the handle, the actor's id
 * is `{baseUrl}/ap/actor` however often the handle is renamed.
 */
export const ACTOR_PATH = `${FEDERATION_PREFIX}/{identifier}` as const;

/** The actor's inbox, its outbox and its two follow collections. */
export const INBOX_PATH = `${ACTOR_PATH}/inbox` as const;
export const OUTBOX_PATH = `${ACTOR_PATH}/outbox` as const;
export const FOLLOWERS_PATH = `${ACTOR_PATH}/followers` as const;
export const FOLLOWING_PATH = `${ACTOR_PATH}/following` as const;
/** The instance-wide inbox, which a peer may use to deliver to every actor at once. */
export const SHARED_INBOX_PATH = `${FEDERATION_PREFIX}/shared-inbox` as const;

/**
 * A post's object path template.
 *
 * The slug, not the permalink, is what names the object, exactly as doc-4
 * asks: a post moved from `/2026/09/hello/` to `/notes/hello/` keeps its
 * ActivityStreams id, so the followers who already have the object are not
 * handed a second one.
 */
export const POST_OBJECT_PATH = `${FEDERATION_PREFIX}/posts/{slug}` as const;

/** Where the NodeInfo 2.1 document lives; `/.well-known/nodeinfo` points at it. */
export const NODEINFO_PATH = '/nodeinfo/2.1';

/** The path a post's ActivityStreams object is served at. */
export function postObjectPath(slug: string): string {
  return `${FEDERATION_PREFIX}/posts/${encodeURIComponent(slug)}`;
}

/**
 * A post's ActivityStreams id, as an absolute URL.
 *
 * It is built on the {@link federationOrigin} rather than on the whole base
 * URL, because that is where Fedify serves the object from: a site in a
 * subdirectory keeps its pages under that directory, but its federation
 * endpoints — this one included — are host-rooted.
 */
export function postObjectId(slug: string, baseUrl: string): string {
  return new URL(postObjectPath(slug), federationOrigin(baseUrl).webOrigin).href;
}

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
