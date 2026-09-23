import type { AdminStore, Follower, InboxActivity, PostComment } from '../admin/store.ts';
import type { Document } from '../content/document.ts';
import { postLabel } from '../content/post-type.ts';
import type { ContentStore } from '../content/store.ts';
import { actorHandle, replyFrom, REPLY_ACTIVITY_TYPE } from '../federation/replies.ts';
import { activityStreamsId, isPublicDocument } from './documents.ts';
import type { FeedComment } from './feeds.ts';
import { absoluteUrl } from './negotiate.ts';
import { sanitizeCommentHtml } from './sanitize.ts';

/**
 * The conversation under a post, in one shape whatever it is made of, and the
 * one reader everything that shows a conversation asks.
 *
 * The fediverse is only the first thing that can answer a post: native
 * comments and webmentions land in the same thread, so nothing here is spelled
 * in ActivityPub's vocabulary. An {@link Interaction} says where it came from
 * (`source`) and what it is (`kind`), and everything else about it is the same
 * whether a Mastodon note, a form on this site or somebody else's blog post
 * produced it.
 *
 * Two indexes hold the raw material — `ap_inbox` for what remote servers sent
 * and `comments` for what the files under `content/_data/comments/` say — and
 * this module is the only place outside the comment intake that reads either
 * of them to show somebody a conversation. That is the point of it: the thread
 * under the post, the post's own comments feed, `/comments/feed/` and the
 * `source:comments` count on a post feed used to merge the same two indexes in
 * two implementations, which is two chances to disagree about what a reader
 * may see. Now there is one {@link ConversationReader}, and the page and the
 * feed are the same reading.
 */

/**
 * Where an interaction came from.
 *
 * `activitypub` is a reply, a like or a boost the site's inbox was sent.
 * `comment` is the form under the post (TASK-50). `webmention` is another
 * site's post pointing at this one (TASK-51). All three are the same shape and
 * thread together, which is the whole point of naming the source rather than
 * keeping three lists.
 */
export type InteractionSource = 'activitypub' | 'comment' | 'webmention';

/**
 * What an interaction is.
 *
 * `reply` is something somebody wrote; `like` and `boost` are the two ways the
 * fediverse can point at a post without writing anything. `repost` is a
 * webmention's word for a boost and is grouped with them, because to a reader
 * they are the same act under two vocabularies. `mention` is the one thing
 * none of the others is: somebody's page linking to this one without answering
 * it (TASK-51).
 */
export type InteractionKind = 'reply' | 'like' | 'boost' | 'repost' | 'mention';

/**
 * Where an interaction stands with the moderator.
 *
 * Everything a remote server sends is `published`: it was published there
 * before it arrived here, and this site did not decide it. A native comment
 * carries the status its file gives it, and only an `approved` one is ever put
 * in a conversation — `pending` and `spam` are named here because that is what
 * the file can say, not because a template will ever be handed one.
 */
export type InteractionStatus = 'published' | 'pending' | 'approved' | 'spam';

/** Who wrote something, as much as the site knows. */
export interface InteractionAuthor {
  /** The best name available: their display name, else their handle, else their id. */
  readonly name: string;
  /** `@user@host`, when the source knows or can imply one. */
  readonly handle: string | null;
  /** Their profile page, for a reader following the link. */
  readonly url: string | null;
  /** Their avatar, when the site knows one. */
  readonly avatar: string | null;
  /** Their id, which is what identifies them however they are named. */
  readonly actorId: string | null;
}

/** One thing somebody did to a post: a reply, a like or a boost. */
export interface Interaction {
  /** What it is called: the note's id, and what a reply to it names. */
  readonly id: string;
  /** Where it came from. */
  readonly source: InteractionSource;
  /** Which of the three it is. */
  readonly kind: InteractionKind;
  /** Who did it. */
  readonly author: InteractionAuthor;
  /** Where it can be read on its own server, or `null` for one with no page. */
  readonly url: string | null;
  /** What it says, sanitised and ready to print. Empty for a like or a boost. */
  readonly content: string;
  /** When it was published, or when it arrived if it did not say. */
  readonly published: Date;
  /** What it answers: the post, or another interaction. `null` for a reaction. */
  readonly inReplyTo: string | null;
  /** Whether a reader may see it. */
  readonly status: InteractionStatus;
  /** The replies to this one, oldest first. */
  readonly replies: Interaction[];
}

/** How many of each a conversation holds. */
export interface InteractionCounts {
  /** Replies, counted through the whole thread rather than the top of it. */
  readonly replies: number;
  /** Likes. */
  readonly likes: number;
  /** Boosts, reposts included. */
  readonly boosts: number;
  /** Mentions: pages that linked to this one without answering it. */
  readonly mentions: number;
  /** All four added up: zero is what "no conversation" means. */
  readonly total: number;
}

/** Everything under one post. */
export interface Conversation {
  /** The replies to the post itself, oldest first, each carrying its own. */
  readonly replies: Interaction[];
  /** The likes, oldest first. */
  readonly likes: Interaction[];
  /** The boosts and the reposts, oldest first and in one list. */
  readonly boosts: Interaction[];
  /** The pages that linked here without answering, oldest first. */
  readonly mentions: Interaction[];
  /** How many of each. */
  readonly counts: InteractionCounts;
}

/** One interaction with the post it is about, which a site-wide list needs. */
export interface SiteInteraction extends Interaction {
  /** The post it answers. */
  readonly post: Document;
}

/** What reading a conversation needs: both indexes and the site's origin. */
export interface ConversationContext {
  /** Where the fediverse interactions are logged. */
  readonly admin: AdminStore;
  /**
   * Where the posts are, for the site-wide reading: an answer is only worth
   * showing while the post it is about is there to read.
   */
  readonly store: ContentStore;
  /** The site's public origin, for the post's object id. */
  readonly baseUrl: string;
}

/**
 * The three questions anything showing a conversation asks.
 *
 * Every one of them is answered from both indexes at once, because a reader
 * does not care which door an answer came in by. The moderation screen and the
 * notices are not conversation display and keep their own queries: they are
 * about what a moderator has to decide, which is the one thing a reader never
 * sees.
 */
export interface ConversationReader {
  /** Everything said about one post, threaded. */
  readonly thread: (document: Document) => Conversation;
  /**
   * How many answers each of these posts has, by permalink: the fediverse
   * replies and the approved native ones together, which is what a reader
   * following `source:comments` would actually find on the page.
   *
   * Counted off the indexes rather than by reading each thread, because the
   * number goes into a feed's own validator: a feed whose comment counts moved
   * is a changed feed, and that has to be cheap for every item of a page.
   */
  readonly counts: (documents: readonly Document[]) => Map<string, number>;
  /**
   * The site's latest answers, newest first, each with the post it answers.
   *
   * One about a post that has since been unpublished or trashed is left out,
   * because the post it is about is not there to read: the feed would be
   * showing a conversation about nothing. That filtering happens after the
   * indexes have paged, so the pages are read until enough survive.
   */
  readonly latest: (limit: number) => SiteInteraction[];
}

/**
 * The reader over one site's two indexes.
 *
 * The methods are properties rather than prototype methods so that one of them
 * can be handed out on its own — the renderer is given `conversation.thread`
 * and nothing else — without anybody having to wrap it in a closure to keep
 * `this`.
 */
export function createConversation(context: ConversationContext): ConversationReader {
  return {
    thread: (document) => postConversation(context, document),
    counts: (documents) => commentCounts(context, documents),
    latest: (limit) => siteConversation(context, limit),
  };
}

/** A conversation with nothing in it, which is what most posts have. */
const NOTHING: Conversation = {
  replies: [],
  likes: [],
  boosts: [],
  mentions: [],
  counts: { replies: 0, likes: 0, boosts: 0, mentions: 0, total: 0 },
};

/**
 * The conversation under one post: everything said about it, from every source
 * the site has, threaded into one.
 *
 * A post that has never been delivered has no ActivityStreams id and so can
 * have no fediverse replies — nothing out there has a name for it yet — but it
 * can still have native comments, which hang off its permalink instead.
 */
function postConversation(context: ConversationContext, document: Document): Conversation {
  const objectId = activityStreamsId(document, context.baseUrl);
  // What a top-level answer names. The object id when the post has one, and
  // the permalink otherwise: a post that has never been delivered can still
  // have native comments, and they have to hang off something.
  const root = objectId ?? document.permalink;

  const activities = objectId === undefined ? [] : activitiesAround(context.admin, objectId);
  const native = approvedComments(context.admin, document);
  if (activities.length === 0 && native.length === 0) return NOTHING;

  const naming = authorNaming(context.admin);
  const withdrawn = withdrawnBy(activities);
  const written: Interaction[] = [];
  const likes: Interaction[] = [];
  const boosts: Interaction[] = [];
  const mentions: Interaction[] = [];
  const reacted = new Set<string>();

  for (const activity of activities) {
    const kind = REACTIONS[activity.activityType];
    if (kind !== undefined) {
      // Only a reaction to the post itself: a like of one of the replies
      // belongs to that reply's own conversation, wherever it is shown.
      if (activity.objectId !== objectId) continue;
      // One like per actor, however many times it was delivered, and none at
      // all once its actor has taken it back.
      const key = `${kind}\0${activity.actorId}`;
      if (reacted.has(key)) continue;
      if (activity.activityId !== null && withdrawn.has(activity.activityId)) continue;
      reacted.add(key);

      const author = naming(activity.actorId);
      (kind === 'like' ? likes : boosts).push({
        id: activity.activityId ?? `${activity.actorId}#${kind}`,
        source: 'activitypub',
        kind,
        author,
        url: author.url,
        content: '',
        published: new Date(activity.receivedAt),
        inReplyTo: null,
        status: 'published',
        replies: [],
      });
      continue;
    }

    const reply = replyFrom(activity);
    if (reply === undefined) continue;
    written.push(federatedInteraction(reply, naming(activity.actorId)));
  }

  for (const comment of native) {
    // A repost joins the boosts, because a reader looking at the page is being
    // told the same thing by both; a mention is its own group, because it is
    // neither an answer nor a reaction.
    const group =
      comment.kind === 'reply'
        ? written
        : comment.kind === 'like'
          ? likes
          : comment.kind === 'mention'
            ? mentions
            : boosts;
    group.push({ ...comment, replies: [] });
  }

  // Sorted before threading rather than after, because a thread is built by
  // walking this list: two sources' entries would otherwise interleave in the
  // order the code happened to read them rather than in the order they were
  // written.
  written.sort(byPublished);
  const replies = threadOf(written, root, withdrawn);
  sortThread(replies);
  likes.sort(byPublished);
  boosts.sort(byPublished);
  mentions.sort(byPublished);
  const counted = countReplies(replies);

  return {
    replies,
    likes,
    boosts,
    mentions,
    counts: {
      replies: counted,
      likes: likes.length,
      boosts: boosts.length,
      mentions: mentions.length,
      total: counted + likes.length + boosts.length + mentions.length,
    },
  };
}

/**
 * The whole site's latest answers, newest first, each with its post.
 *
 * Read per source and merged rather than threaded: a site-wide list is a list
 * of what has just been said, and an answer to an answer is as much news as an
 * answer to a post. Both sides are over-read for the same reason — one about a
 * post that has since been unpublished is dropped after the index has already
 * counted it — and the merged list is cut to size at the end.
 */
function siteConversation(context: ConversationContext, limit: number): SiteInteraction[] {
  const naming = authorNaming(context.admin);
  const posts = new PostsByObjectId(context);
  const said: SiteInteraction[] = [];

  for (let offset = 0; said.length < limit;) {
    const page = context.admin.listReplies({ limit: limit * OVERSCAN, offset });
    if (page.length === 0) break;
    offset += page.length;

    for (const activity of page) {
      const reply = replyFrom(activity);
      if (reply === undefined) continue;
      const post = posts.get(reply.inReplyTo);
      if (post === undefined) continue;

      said.push({ ...federatedInteraction(reply, naming(activity.actorId)), post });
      if (said.length === limit) break;
    }
  }

  for (const stored of context.admin.listComments({
    status: 'approved',
    limit: limit * OVERSCAN,
  })) {
    const post = context.store.getBySlug(stored.slug);
    if (post === undefined || !isPublicDocument(post, context.store.now())) continue;
    said.push({ ...interactionOf(stored, post.permalink), post });
  }

  return newestFirst(said, limit);
}

/** How many answers each of these posts has, by permalink. */
function commentCounts(
  context: ConversationContext,
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

/**
 * How many candidates a site-wide page reads for each one it keeps.
 *
 * Answers to a post that has since been unpublished are dropped after the
 * index has already counted them, so the query has to over-read. Four is
 * generous for a site whose posts mostly stay published and bounded for one
 * whose posts do not.
 */
const OVERSCAN = 4;

/** One logged fediverse reply as the thread's own shape. */
function federatedInteraction(
  reply: { id: string; url: string; html: string; published: Date; inReplyTo: string },
  author: InteractionAuthor,
): Interaction {
  return {
    id: reply.id,
    source: 'activitypub',
    kind: 'reply',
    author,
    url: reply.url,
    // Sanitised here, at the edge of the site, so the page and the feed
    // republish the same checked markup rather than each checking for itself.
    content: sanitizeCommentHtml(reply.html),
    published: reply.published,
    inReplyTo: reply.inReplyTo,
    status: 'published',
    replies: [],
  };
}

/**
 * The approved native comments on a post, as interactions, oldest first.
 *
 * Only approved ones. A comment waiting for a moderator and one filed as spam
 * are both in the file and both in the index, and neither is anything a reader
 * should be shown — which is the whole difference between this and what the
 * moderation screen asks for.
 */
function approvedComments(admin: AdminStore, document: Document): Interaction[] {
  return admin
    .listCommentsFor(document.slug)
    .filter((comment) => comment.status === 'approved')
    .map((comment) => interactionOf(comment, document.permalink));
}

/** One stored comment as the thread's own shape. */
function interactionOf(comment: PostComment, permalink: string): Interaction {
  return {
    id: comment.id,
    source: comment.source,
    kind: comment.kind,
    author: {
      name: comment.author.name,
      // A commenter has no fediverse identity: they gave a name, maybe a
      // website, and nothing that names them anywhere else.
      handle: null,
      url: comment.author.url,
      // Only a webmention has one: it came out of the source page's `h-card`,
      // and a form asks nobody for a picture.
      avatar: comment.author.avatar,
      actorId: null,
    },
    // Where it can be read. A comment written here lives here, at its own
    // anchor; a webmention lives on the page it was sent from, and its `url`
    // says so. A theme that prints `url` for a fediverse reply prints a
    // working link for either, and so does a feed.
    url: comment.url ?? `${permalink}#${commentAnchor(comment.id)}`,
    content: comment.content.html,
    published: new Date(comment.submitted),
    inReplyTo: comment.inReplyTo,
    status: comment.status,
    replies: [],
  };
}

/**
 * The `id` a comment is anchored at on the page.
 *
 * Prefixed rather than bare so a comment can never collide with a heading
 * anchor the post's own Markdown produced.
 */
export function commentAnchor(id: string): string {
  return `comment-${id}`;
}

/**
 * Everything said in a conversation, at every depth and in no order: the
 * replies and the mentions.
 *
 * The likes and the boosts are left out because they say nothing. A feed item
 * is somebody's words, and "@ada liked this" has none to carry — a reader
 * polling a comments feed would get an entry with an empty body and no way to
 * tell what it was for.
 */
export function spokenIn(conversation: Conversation): Interaction[] {
  const said: Interaction[] = [...conversation.mentions];

  const walk = (replies: readonly Interaction[]): void => {
    for (const reply of replies) {
      said.push(reply);
      walk(reply.replies);
    }
  };
  walk(conversation.replies);

  return said;
}

/**
 * Interactions as a comments feed carries them: newest first, at most `limit`,
 * and every link absolute.
 *
 * The one place an interaction becomes a feed item, so the post's feed and the
 * site's cannot disagree about what a comment's `guid` or `link` is. The HTML
 * is handed over as it stands and sanitised by the feed itself, at the last
 * moment before it becomes bytes this site publishes.
 */
export function feedComments(
  said: readonly (Interaction & { post?: Document | undefined })[],
  options: { baseUrl: string; limit: number },
): FeedComment[] {
  return newestFirst([...said], options.limit).map((entry) => ({
    id: entry.id,
    url: absoluteUrl(entry.url ?? '/', options.baseUrl),
    author: entry.author.name,
    published: entry.published,
    html: entry.content,
    ...(entry.post === undefined
      ? {}
      : { post: { title: postLabel(entry.post), permalink: entry.post.permalink } }),
  }));
}

/** The newest `limit` of a mixed list, which is the order every feed shows. */
function newestFirst<T extends { published: Date }>(said: T[], limit: number): T[] {
  return said
    .sort((left, right) => right.published.getTime() - left.published.getTime())
    .slice(0, limit);
}

/**
 * The public post an ActivityStreams object id names, memoised.
 *
 * Almost every id is the post's permalink (decision-13), so the permalink is
 * looked up first and the answer is checked against the document's own id — a
 * post that is no longer public has no id at all. Only when that fails is the
 * whole index read, once, to find the post whose file names this id: a post
 * migrated from WordPress keeps the `?p=813` its followers already hold, and
 * no permalink spells that.
 */
class PostsByObjectId {
  readonly #context: ConversationContext;
  readonly #found = new Map<string, Document | undefined>();
  #all: Map<string, Document> | undefined;

  constructor(context: ConversationContext) {
    this.#context = context;
  }

  get(objectId: string): Document | undefined {
    if (!this.#found.has(objectId)) this.#found.set(objectId, this.#resolve(objectId));
    return this.#found.get(objectId);
  }

  #resolve(objectId: string): Document | undefined {
    const permalink = permalinkOfObjectId(objectId, this.#context.baseUrl);
    if (permalink !== undefined) {
      const document = this.#context.store.getByPermalink(permalink);
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
 * The permalink an object id names, when it is one this site would have
 * minted: the path, with the base URL's own directory taken off it.
 *
 * An id from another host belongs to no post here however it is spelled, and
 * neither does one carrying a query string — a permalink has none, so an id
 * like `?p=813` is a stored one and is found by the walk instead.
 */
function permalinkOfObjectId(objectId: string, baseUrl: string): string | undefined {
  let url: URL;
  let base: URL;
  try {
    url = new URL(objectId);
    base = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== base.origin || url.search !== '') return undefined;

  const directory = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');
  if (directory !== '' && !url.pathname.startsWith(`${directory}/`)) return undefined;

  const pathname = url.pathname.slice(directory.length);
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * The replies as a thread: those answering the post at the top, each carrying
 * the replies that answer it, oldest first at every level.
 *
 * Three things decide where a reply goes, and all three are what somebody
 * reading the page would expect:
 *
 * - A reply whose target is gone — deleted by its author — is shown under
 *   whatever *that* was answering, rather than disappearing with it. The
 *   conversation stays readable and only the withdrawn note is missing.
 * - A reply answering something that is no part of this conversation is left
 *   out. The log holds it because it named something this walk asked about — a
 *   note answering the like of a post is the shape of that — but the post is
 *   not what it is talking about.
 * - A note the site was told about twice is one reply, because the map is
 *   keyed by the note's own id.
 */
function threadOf(
  written: readonly Interaction[],
  objectId: string,
  withdrawn: ReadonlySet<string>,
): Interaction[] {
  const byId = new Map<string, Interaction>();
  const targets = new Map<string, string>();
  for (const reply of written) {
    targets.set(reply.id, reply.inReplyTo ?? objectId);
    if (!withdrawn.has(reply.id)) byId.set(reply.id, reply);
  }

  const top: Interaction[] = [];
  for (const reply of byId.values()) {
    const parent = surviving(reply, targets, byId, objectId);
    if (parent === undefined) continue;
    (parent === null ? top : parent.replies).push(reply);
  }

  return top;
}

/**
 * The reply a reply hangs under: `null` for the post itself, the nearest
 * surviving ancestor for one whose own target was deleted, and `undefined` for
 * a note that is answering something else entirely.
 *
 * The walk is bounded by the number of notes, so a log carrying a cycle — two
 * notes each claiming to answer the other, which nothing stops a remote server
 * from sending — ends rather than hangs.
 */
function surviving(
  reply: Interaction,
  targets: ReadonlyMap<string, string>,
  byId: ReadonlyMap<string, Interaction>,
  objectId: string,
): Interaction | null | undefined {
  let target = targets.get(reply.id);

  for (let step = 0; step <= targets.size; step += 1) {
    if (target === undefined) return undefined;
    if (target === objectId) return null;

    const parent = byId.get(target);
    if (parent !== undefined) return parent === reply ? undefined : parent;

    // The target is not a reply the site is showing: either a note its author
    // deleted, whose own target this reply moves to, or nothing to do with the
    // post at all.
    target = targets.get(target);
  }

  return undefined;
}

/** Oldest first, which is the order a conversation reads in. */
function byPublished(left: Interaction, right: Interaction): number {
  return left.published.getTime() - right.published.getTime();
}

/** Put every level of a thread in time order, all the way down. */
function sortThread(replies: Interaction[]): void {
  replies.sort(byPublished);
  for (const reply of replies) sortThread(reply.replies);
}

/** How many replies a thread holds, counting all the way down. */
function countReplies(replies: readonly Interaction[]): number {
  let total = 0;
  for (const reply of replies) total += 1 + countReplies(reply.replies);
  return total;
}

/** The two reactions, as the activity types they arrive as. */
const REACTIONS: Readonly<Record<string, InteractionKind | undefined>> = {
  Like: 'like',
  Announce: 'boost',
};

/**
 * Every logged activity that has anything to do with a post, oldest first.
 *
 * The log is walked outwards rather than queried once: a reply names the post,
 * a reply to that reply names the reply, and a `Delete` or an `Undo` names the
 * activity it takes back. Each round asks about everything the last round
 * turned up — the object an activity carried and the activity's own id — and
 * stops when a round finds nothing new, which it must, because a row is
 * collected once and there are finitely many.
 */
function activitiesAround(admin: AdminStore, objectId: string): InboxActivity[] {
  const collected = new Map<number, InboxActivity>();
  const asked = new Set<string>([objectId]);
  let frontier: string[] = [objectId];

  while (frontier.length > 0) {
    const next: string[] = [];

    for (const activity of admin.listActivitiesAbout(frontier)) {
      if (collected.has(activity.id)) continue;
      collected.set(activity.id, activity);

      for (const id of [activity.objectId, activity.activityId]) {
        if (id === null || asked.has(id)) continue;
        asked.add(id);
        next.push(id);
      }
    }

    frontier = next;
  }

  // Row ids are the order things arrived in, and the rounds above return them
  // out of that order.
  return [...collected.values()].sort((left, right) => left.id - right.id);
}

/**
 * The ids of everything an actor has taken back: the likes and boosts undone,
 * and the notes deleted.
 *
 * Only by the actor that did it in the first place. Without that check any
 * signed actor could delete somebody else's comment off this page, since the
 * activity carrying the instruction is signed by its sender and says nothing
 * about who the thing it names belonged to — which is the rule the inbox
 * already applies to an `Undo(Follow)`.
 */
function withdrawnBy(activities: readonly InboxActivity[]): Set<string> {
  const owners = new Map<string, string>();
  for (const activity of activities) {
    if (activity.activityId !== null) owners.set(activity.activityId, activity.actorId);
    if (activity.objectId !== null && activity.activityType === REPLY_ACTIVITY_TYPE) {
      owners.set(activity.objectId, activity.actorId);
    }
  }

  const withdrawn = new Set<string>();
  for (const activity of activities) {
    if (activity.activityType !== 'Undo' && activity.activityType !== 'Delete') continue;
    if (activity.objectId === null) continue;
    if (owners.get(activity.objectId) !== activity.actorId) continue;
    withdrawn.add(activity.objectId);
  }
  return withdrawn;
}

/**
 * How an actor is named, memoised for the length of one conversation.
 *
 * A follower is named from the profile it published when it followed; everyone
 * else is named by the handle their actor URL implies, which is a guess and
 * deliberately so — naming them properly would mean dereferencing the actor,
 * a network round trip per comment on the page.
 */
function authorNaming(admin: AdminStore): (actorId: string) => InteractionAuthor {
  const known = new Map<string, InteractionAuthor>();
  // Read once, on the first unknown actor, rather than per actor: the
  // followers are one row per (user, actor) now (decision-14), so the same
  // stranger may be on the list several times and any of those rows names them
  // the same way — the columns read here are the actor's own name and picture.
  let profiles: Map<string, Follower> | undefined;

  return (actorId) => {
    const held = known.get(actorId);
    if (held !== undefined) return held;

    profiles ??= new Map(admin.listFollowers().map((entry) => [entry.actorId, entry]));
    const follower = profiles.get(actorId);
    const handle = follower?.handle ?? actorHandle(actorId) ?? null;
    const author: InteractionAuthor = {
      name: follower?.name ?? handle ?? actorId,
      handle,
      url: follower?.url ?? actorId,
      avatar: follower?.iconUrl ?? null,
      actorId,
    };
    known.set(actorId, author);
    return author;
  };
}
