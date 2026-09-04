import type { AdminStore } from '../admin/store.ts';
import type { Document } from '../content/document.ts';
import type { ContentStore } from '../content/store.ts';
import { FEDERATION_PREFIX } from '../federation/paths.ts';
import { replyFrom } from '../federation/replies.ts';
import type { Reply } from '../federation/replies.ts';
import { activityStreamsId } from './documents.ts';

/**
 * The comments a site has, which are the replies its inbox was sent.
 *
 * This CMS stores no comments of its own. A fediverse reply names the post it
 * answers by the post's ActivityStreams object id, so the whole of this module
 * is that one join: from a logged `Create` to the document it belongs to, and
 * back the other way for a count.
 */

/** One reply, with the post it answers. */
export interface Comment extends Reply {
  /** The post it answers, which the site-wide feed names on every item. */
  post: Document;
}

/**
 * How many candidates a site-wide page reads for each one it keeps.
 *
 * Replies to a post that has since been unpublished are dropped after the
 * database has already counted them, so the query has to over-read. Four is
 * generous for a site whose posts mostly stay published and bounded for one
 * whose posts do not.
 */
const OVERSCAN = 4;

/** What the comment queries need to reach: both indexes and the site's origin. */
export interface CommentContext {
  /** Where the replies are logged. */
  admin: AdminStore;
  /** Where the posts are. */
  store: ContentStore;
  /** The site's public origin, for the object ids. */
  baseUrl: string;
}

/**
 * One post's replies, newest first.
 *
 * A post that has never been delivered has no object id, and so can have no
 * replies: nothing in the fediverse has a name for it yet.
 */
export function postComments(context: CommentContext, document: Document, limit: number): Reply[] {
  const objectId = activityStreamsId(document, context.baseUrl);
  if (objectId === undefined) return [];

  const naming = authorNaming(context.admin);
  return context.admin
    .listRepliesTo(objectId, { limit })
    .map((activity) => replyFrom(activity, naming))
    .filter((reply) => reply !== undefined);
}

/**
 * Every post's replies, newest first, each with the post it answers.
 *
 * A reply to a post that has since been unpublished or trashed is left out,
 * because the post it is about is not there to read: the feed would be showing
 * a conversation about nothing. That filtering happens after the database has
 * paged, so the pages are read until enough survive.
 */
export function siteComments(context: CommentContext, limit: number): Comment[] {
  const naming = authorNaming(context.admin);
  const posts = new PostsByObjectId(context);
  const comments: Comment[] = [];

  for (let offset = 0; comments.length < limit;) {
    const page = context.admin.listReplies({ limit: limit * OVERSCAN, offset });
    if (page.length === 0) break;
    offset += page.length;

    for (const activity of page) {
      const reply = replyFrom(activity, naming);
      if (reply === undefined) continue;
      const post = posts.get(reply.inReplyTo);
      if (post === undefined) continue;

      comments.push({ ...reply, post });
      if (comments.length === limit) break;
    }
  }

  return comments;
}

/**
 * How many replies each of these documents has, by permalink.
 *
 * Resolved rather than counted on demand, because the number goes into the
 * feed's own validator: a feed whose comment counts moved is a changed feed,
 * and a reader holding the old one should be told so.
 */
export function commentCounts(
  context: CommentContext,
  documents: readonly Document[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const document of documents) {
    const objectId = activityStreamsId(document, context.baseUrl);
    counts.set(
      document.permalink,
      objectId === undefined ? 0 : context.admin.countRepliesTo(objectId),
    );
  }
  return counts;
}

/** The name to show for an actor: the follower profile the site holds, if any. */
function authorNaming(admin: AdminStore): (actorId: string) => string | undefined {
  const known = new Map<string, string | undefined>();
  return (actorId) => {
    if (!known.has(actorId)) {
      const follower = admin.getFollower(actorId);
      known.set(actorId, follower?.name ?? follower?.handle ?? undefined);
    }
    return known.get(actorId);
  };
}

/**
 * The public post an ActivityStreams object id names, memoised.
 *
 * Almost every id is the one the slug implies, so the slug is tried first and
 * the answer is checked against the document's own id — a post that has been
 * renamed keeps the id it was first delivered under, which no slug spells any
 * more. Only when that fails is the whole index read, once, to find it.
 */
class PostsByObjectId {
  readonly #context: CommentContext;
  readonly #found = new Map<string, Document | undefined>();
  #all: Map<string, Document> | undefined;

  constructor(context: CommentContext) {
    this.#context = context;
  }

  get(objectId: string): Document | undefined {
    if (!this.#found.has(objectId)) this.#found.set(objectId, this.#resolve(objectId));
    return this.#found.get(objectId);
  }

  #resolve(objectId: string): Document | undefined {
    const slug = slugOfObjectId(objectId, this.#context.baseUrl);
    if (slug !== undefined) {
      const document = this.#context.store.getBySlug(slug);
      if (
        document !== undefined &&
        activityStreamsId(document, this.#context.baseUrl) === objectId
      ) {
        return document;
      }
    }
    return this.#everything().get(objectId);
  }

  #everything(): Map<string, Document> {
    if (this.#all === undefined) {
      this.#all = new Map();
      for (const document of this.#context.store.listPosts()) {
        const id = activityStreamsId(document, this.#context.baseUrl);
        if (id !== undefined) this.#all.set(id, document);
      }
    }
    return this.#all;
  }
}

/**
 * The slug an object id names, when it is one this site would have minted.
 *
 * An id from another host, or one under some other path, belongs to no post
 * here however it is spelled.
 */
function slugOfObjectId(objectId: string, baseUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(objectId);
  } catch {
    return undefined;
  }
  if (url.origin !== new URL(baseUrl).origin) return undefined;

  const prefix = `${FEDERATION_PREFIX}/posts/`;
  if (!url.pathname.startsWith(prefix)) return undefined;

  const slug = url.pathname.slice(prefix.length);
  if (slug === '' || slug.includes('/')) return undefined;
  try {
    return decodeURIComponent(slug);
  } catch {
    return undefined;
  }
}
