import type { AdminStore, PostComment } from '../admin/store.ts';
import { commentAnchor } from '../comments/conversation.ts';
import type { Document } from '../content/document.ts';
import type { ContentStore } from '../content/store.ts';
import { FEDERATION_PREFIX } from '../federation/paths.ts';
import { replyFrom } from '../federation/replies.ts';
import { activityStreamsId, isPublicDocument } from './documents.ts';
import type { FeedComment } from './feeds.ts';
import { absoluteUrl } from './negotiate.ts';

/**
 * The comments a site has, in the two shapes it has them: replies its inbox
 * was sent, and comments people left on the page itself.
 *
 * A fediverse reply names the post it answers by the post's ActivityStreams
 * object id, and lives in the inbox log; a native comment names the post by
 * its slug and lives in `content/_data/comments/` (TASK-50). This module is
 * where the two meet for the feeds: a reader subscribed to a post's comments
 * should hear about an answer whichever door it came in by, and
 * `source:comments` should count what a reader would actually see.
 *
 * Only approved native comments are here. One waiting for a moderator and one
 * filed as spam are both stored and neither is anything to publish.
 */

/** One comment, with the post it answers. */
export interface Comment extends FeedComment {
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
 * One post's comments, newest first, from both sources.
 *
 * A post that has never been delivered has no object id and so can have no
 * fediverse replies — nothing out there has a name for it yet — but it can
 * still have native ones, which are found by its slug.
 */
export function postComments(
  context: CommentContext,
  document: Document,
  limit: number,
): FeedComment[] {
  const objectId = activityStreamsId(document, context.baseUrl);
  const naming = authorNaming(context.admin);
  const federated =
    objectId === undefined
      ? []
      : context.admin
          .listRepliesTo(objectId, { limit })
          .map((activity) => replyFrom(activity, naming))
          .filter((reply) => reply !== undefined);

  return newestFirst([...federated, ...nativeComments(context, document)], limit);
}

/**
 * Every post's comments, newest first, each with the post it answers.
 *
 * One about a post that has since been unpublished or trashed is left out,
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

  // The native comments are over-read for the same reason the replies are: one
  // on a post that has since been unpublished is dropped after the index has
  // already counted it.
  for (const stored of context.admin.listComments({
    status: 'approved',
    limit: limit * OVERSCAN,
  })) {
    const post = context.store.getBySlug(stored.slug);
    if (post === undefined || !isPublicDocument(post, context.store.now())) continue;
    comments.push({ ...feedCommentOf(stored, post, context.baseUrl), post });
  }

  return newestFirst(comments, limit);
}

/**
 * How many comments each of these documents has, by permalink: the fediverse
 * replies and the approved native ones together, which is what a reader
 * following `source:comments` would actually find on the page.
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
    const federated = objectId === undefined ? 0 : context.admin.countRepliesTo(objectId);
    counts.set(
      document.permalink,
      federated + context.admin.countCommentsFor(document.slug, 'approved'),
    );
  }
  return counts;
}

/** One post's approved native comments, in the shape a feed item wants. */
function nativeComments(context: CommentContext, document: Document): FeedComment[] {
  return context.admin
    .listCommentsFor(document.slug)
    .filter((comment) => comment.status === 'approved')
    .map((comment) => feedCommentOf(comment, document, context.baseUrl));
}

/**
 * One stored comment as a feed item.
 *
 * Its `url` is where a reader can actually read it — this page, at the
 * comment's own anchor — and its `id` is the comment's own name, which is what
 * a `guid isPermaLink="false"` is for: a reader that has seen it once does not
 * see it again if the post moves.
 */
function feedCommentOf(comment: PostComment, post: Document, baseUrl: string): FeedComment {
  return {
    id: comment.id,
    url: `${absoluteUrl(post.permalink, baseUrl)}#${commentAnchor(comment.id)}`,
    author: comment.author.name,
    published: new Date(comment.submitted),
    html: comment.content.html,
  };
}

/** The newest `limit` of a mixed list, which is the order every feed shows. */
function newestFirst<T extends { published: Date }>(comments: T[], limit: number): T[] {
  return comments
    .sort((left, right) => right.published.getTime() - left.published.getTime())
    .slice(0, limit);
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
