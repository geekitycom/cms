import { avatarHref } from '../avatars/avatars.ts';
import type { ActorProfile, AdminStore, InboxActivity, PostComment } from '../store/admin-store.ts';
import type { Document } from '../content/document.ts';
import { postLabel, postTypeOf } from '../content/post-type.ts';
import type { CitedPageReader } from '../content/citation.ts';
import { RSVP_LABELS } from '../content/rsvp.ts';
import type { RsvpValue } from '../content/rsvp.ts';
import type { ArchiveReader, DocumentLookup, IndexClock, ReplyReader } from '../content/store.ts';
import { naturalObjectId, objectIdsOf, readObjectIds } from '../federation/object-ids.ts';
import { readAllQuoteAuthorizations } from '../federation/quotes.ts';
import type { QuoteAuthorizationRecord } from '../federation/quotes.ts';
import {
  actorHandle,
  guessedName,
  quoteFrom,
  replyFrom,
  REPLY_ACTIVITY_TYPE,
} from '../store/inbox-replies.ts';
import type { User } from '../site/users.ts';
import { absoluteUrl } from '../util/url.ts';
import { authorContext, profileContext, siteAuthorContext } from '../site/authors.ts';
import { authorFeedHref, repliesFeedPath } from './feed-source.ts';
import type { AuthorContext } from '../site/authors.ts';
import { activityStreamsId, permalinkOfObjectId } from '../content/permalinks.ts';
import { isListed, isServed } from '../content/served.ts';
import { isKey, commentPageHref, feedGuid, repliesKey } from '../content/guids.ts';
import type { FeedComment } from './feeds.ts';
import { sanitizeCommentHtml } from '../content/sanitize.ts';
import type {
  CommentThread,
  Conversation,
  ConversationReader,
  ConversationSite,
  HeldAt,
  Interaction,
  InteractionAuthor,
  InteractionKind,
  Placed,
  RepliesOf,
  RsvpGroup,
  SiteInteraction,
  ThreadReply,
  Upstream,
  WithheldReply,
} from '../comments/conversation.ts';
import {
  commentAnchor,
  commentKeyAt,
  commentNames,
  heldComment,
  isWithheld,
  visibleReply,
} from '../comments/conversation.ts';

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

const RSVP_GROUP_ORDER: readonly RsvpValue[] = ['yes', 'maybe', 'interested', 'no'];

const RSVP_ACTIVITIES: Readonly<Record<string, RsvpValue | undefined>> = {
  Accept: 'yes',
  TentativeAccept: 'maybe',
  Reject: 'no',
};

/** What reading a conversation needs: both indexes and the site's origin. */
export interface ConversationContext {
  /** Where the fediverse interactions are logged. */
  readonly admin: AdminStore;
  /**
   * Where the posts are, for the site-wide reading: an answer is only worth
   * showing while the post it is about is there to read.
   */
  readonly store: DocumentLookup & ArchiveReader & ReplyReader & IndexClock;
  /**
   * Where the quote approvals are: a quote of a post is shown only while the
   * post's author vouches for it (FEP-044f, TASK-171).
   */
  readonly contentDir: string;
  /** The site's public origin, for the post's object id. */
  readonly baseUrl: string;
  /** Who may sign in, for naming the author of a reply post (TASK-300). */
  readonly users: () => readonly User[];
}

type Reading = ConversationContext & { readonly site: ConversationSite };

/**
 * The reader over one site's two indexes.
 *
 * The methods are properties rather than prototype methods so that one of them
 * can be handed out on its own — the renderer is given `conversation.thread`
 * and nothing else — without anybody having to wrap it in a closure to keep
 * `this`.
 */
export function createConversation(base: ConversationContext): ConversationReader {
  const reading = (site: ConversationSite): Reading => ({ ...base, site });
  return {
    thread: (document, site) => postConversation(reading(site), document),
    counts: (documents, site) => directCounts(reading(site), documents),
    latest: (limit, site) => siteConversation(reading(site), limit),
    comment: (id, site) => commentThread(reading(site), id),
    replyNamed: (document, url, site) => replyNamed(reading(site), document, url),
    heldAt: (url, site) => heldAt(reading(site), url),
    repliesTo: (segment, site) => repliesTo(reading(site), segment),
    documentOf: (url) => documentNamed(base, url),
    upstreams: (document, site) => upstreamsOf(reading(site), document),
  };
}

/**
 * The conversation under one post: everything said about it, from every source
 * the site has, threaded into one.
 *
 * A post that has never been delivered has no ActivityStreams id and so can
 * have no fediverse replies — nothing out there has a name for it yet — but it
 * can still have native comments, which hang off its permalink instead.
 */
function postConversation(context: Reading, document: Document): Conversation {
  const said = gather(context, document);
  const replies = threadOf(said);
  sortThread(replies);
  const { likes, boosts, mentions } = said;
  likes.sort(byPublished);
  boosts.sort(byPublished);
  mentions.sort(byPublished);
  const counted = countReplies(replies);
  const rsvps = rsvpGroups(said.answers);
  const answered = rsvps.reduce((sum, group) => sum + group.people.length, 0);

  return {
    replies,
    likes,
    boosts,
    mentions,
    rsvps,
    counts: {
      replies: counted,
      likes: likes.length,
      boosts: boosts.length,
      mentions: mentions.length,
      rsvps: answered,
      total: counted + likes.length + boosts.length + mentions.length + answered,
    },
  };
}

type Group = 'written' | 'likes' | 'boosts' | 'mentions' | 'answers';

/**
 * A repost joins the boosts, because a reader looking at the page is being
 * told the same thing by both; a mention is its own group, because it is
 * neither an answer nor a reaction.
 */
const GROUP_OF: Readonly<Record<InteractionKind, Group>> = {
  reply: 'written',
  like: 'likes',
  boost: 'boosts',
  repost: 'boosts',
  mention: 'mentions',
};

/** Everything said about one post, sorted into its groups and not yet threaded. */
interface Gathered extends Readonly<Record<Group, Interaction[]>> {
  /** What a top-level answer names. */
  readonly root: string;
  /** The ids of what an actor has taken back. */
  readonly withdrawn: ReadonlySet<string>;
  /** The native comments a reader may not see, pending or spam, by id. */
  readonly held: ReadonlyMap<string, Interaction>;
}

interface Part {
  readonly said: readonly (readonly [Group, Interaction])[];
  readonly held?: ReadonlyMap<string, Interaction>;
  readonly withdrawn?: ReadonlySet<string>;
}

function gather(
  context: Reading,
  document: Document,
  seen: ReadonlySet<string> = new Set([document.path]),
): Gathered {
  const deliveredObjectId = activityStreamsId(document, context.baseUrl, context.store.now());
  const root = rootOf(context, document);
  const stored = context.admin.listCommentsFor(document.slug);
  const naming = authorNaming(context.admin);
  const isEvent = postTypeOf(document) === 'event';

  const objectIds =
    deliveredObjectId === undefined
      ? []
      : objectIdsOf(readObjectIds(context.contentDir), deliveredObjectId);
  const fediverse =
    objectIds.length === 0
      ? []
      : [
          fromQuotes(context, objectIds, naming),
          fromActivities(context, objectIds, stored, naming, isEvent),
        ];
  const comments = fromStored(context, document, stored, isEvent);
  const sources = [...fediverse, comments];
  const replyPosts = fromReplyPosts(context, document, root, seen, [
    ...sources.flatMap(({ said }) =>
      said.flatMap(([group, entry]) => (group === 'written' ? [entry] : [])),
    ),
    ...(comments.held?.values() ?? []),
  ]);
  return merged(root, [...sources, replyPosts]);
}

function merged(root: string, parts: readonly Part[]): Gathered {
  const groups: Record<Group, Interaction[]> = {
    written: [],
    likes: [],
    boosts: [],
    mentions: [],
    answers: [],
  };
  const held = new Map<string, Interaction>();
  const withdrawn = new Set<string>();
  for (const part of parts) {
    for (const [group, entry] of part.said) groups[group].push(entry);
    for (const [id, entry] of part.held ?? []) held.set(id, entry);
    for (const id of part.withdrawn ?? []) withdrawn.add(id);
  }
  // Sorted before threading rather than after, because a thread is built by
  // walking this list: two sources' entries would otherwise interleave in the
  // order the code happened to read them rather than in the order they were
  // written.
  groups.written.sort(byPublished);
  return { root, ...groups, held, withdrawn };
}

function fromQuotes(
  context: Reading,
  objectIds: readonly string[],
  naming: (actorId: string) => InteractionAuthor,
): Part {
  const approvals = readAllQuoteAuthorizations(context.contentDir);
  return {
    said: quotesOf(context.admin, approvals, objectIds, naming).map(
      (quote) => ['mentions', quote] as const,
    ),
  };
}

/**
 * What the fediverse said about a post, under every id it has federated
 * under (TASK-417): the first is the one its conversation is rooted at, so a
 * reply to any of them is a reply to the post.
 */
function fromActivities(
  context: Reading,
  objectIds: readonly string[],
  stored: readonly PostComment[],
  naming: (actorId: string) => InteractionAuthor,
  isEvent: boolean,
): Part {
  // What was imported from the fediverse is walked from too: an answer to an
  // imported note names the note, which no logged activity may carry.
  const origins = stored.flatMap((comment) =>
    comment.source === 'activitypub' && comment.origin !== undefined ? [comment.origin] : [],
  );
  const [root = ''] = objectIds;
  const named = new Set(objectIds);
  const aboutPost = (activity: InboxActivity): boolean =>
    activity.objectId !== null && named.has(activity.objectId);
  const activities = activitiesAround(context.admin, [...objectIds, ...origins]);
  const withdrawn = withdrawnBy(activities);
  const taken = (activityId: string | null): boolean =>
    activityId !== null && withdrawn.has(activityId);
  // One like per actor, so a like imported from the site this one replaced
  // and the same person's like delivered here are one.
  const reacted = new Set(stored.flatMap(storedReaction));
  const said: [Group, Interaction][] = [];

  for (const activity of activities) {
    const answer = isEvent ? RSVP_ACTIVITIES[activity.activityType] : undefined;
    if (answer !== undefined) {
      if (!aboutPost(activity) || taken(activity.activityId)) continue;
      said.push([
        'answers',
        {
          ...reaction(activity, naming, `${activity.actorId}#rsvp`),
          kind: 'reply',
          rsvp: { value: answer, label: RSVP_LABELS[answer] },
        },
      ]);
      continue;
    }

    const kind = REACTIONS[activity.activityType];
    if (kind !== undefined) {
      // Only a reaction to the post itself: a like of one of the replies
      // belongs to that reply's own conversation, wherever it is shown.
      if (!aboutPost(activity)) continue;
      // One like per actor, however many times it was delivered, and none
      // at all once its actor has taken it back.
      const key = reactionKey(kind, activity.actorId);
      if (reacted.has(key) || taken(activity.activityId)) continue;
      if (
        activity.activityId !== null &&
        heldComment(context.admin, activity.activityId) !== undefined
      ) {
        continue;
      }
      reacted.add(key);
      said.push([
        GROUP_OF[kind],
        { ...reaction(activity, naming, `${activity.actorId}#${kind}`), kind },
      ]);
      continue;
    }

    const found = replyFrom(activity);
    if (found === undefined || heldComment(context.admin, found.id) !== undefined) continue;
    const reply = named.has(found.inReplyTo) ? { ...found, inReplyTo: root } : found;
    const parent = heldComment(context.admin, reply.inReplyTo);
    said.push([
      'written',
      federatedInteraction(
        parent === undefined ? reply : { ...reply, inReplyTo: parent.id },
        naming(activity.actorId),
      ),
    ]);
  }
  return { said, withdrawn };
}

function storedReaction({ kind, actor }: PostComment): string[] {
  const group = GROUP_OF[kind];
  return actor === undefined || (group !== 'likes' && group !== 'boosts')
    ? []
    : [reactionKey(kind, actor)];
}

function reactionKey(kind: InteractionKind, actor: string): string {
  return `${GROUP_OF[kind]}\0${actor}`;
}

function reaction(
  activity: InboxActivity,
  naming: (actorId: string) => InteractionAuthor,
  fallbackId: string,
): Omit<Interaction, 'kind'> {
  const author = naming(activity.actorId);
  return {
    ...unstored(activity.activityId ?? fallbackId),
    source: 'activitypub',
    author,
    url: author.url,
    content: '',
    published: new Date(activity.receivedAt),
    inReplyTo: null,
    status: 'published',
    replies: [],
  };
}

function fromStored(
  context: Reading,
  document: Document,
  stored: readonly PostComment[],
  isEvent: boolean,
): Part {
  const users = context.users();
  const said: [Group, Interaction][] = [];
  const held = new Map<string, Interaction>();
  for (const record of stored) {
    const comment = interactionOf(record, document.permalink, context.baseUrl, users);
    if (record.status !== 'approved') {
      held.set(comment.id, comment);
      continue;
    }
    const group = isEvent && comment.rsvp !== undefined ? 'answers' : GROUP_OF[comment.kind];
    said.push([group, { ...comment, replies: [] }]);
  }
  return { said, held };
}

/**
 * The reply posts answering the post or anything said under it, each
 * bringing what was said under it: an answer to a reply post lands against
 * the reply post, and this is what stitches it into the thread it is in.
 */
function fromReplyPosts(
  context: Reading,
  document: Document,
  root: string,
  seen: ReadonlySet<string>,
  answered: readonly Interaction[],
): Part {
  const names = namesIn(context, document, root, answered);
  const said: [Group, Interaction][] = [];
  const held = new Map<string, Interaction>();
  const withdrawn = new Set<string>();
  for (const answer of context.store.listRepliesTo([...names.keys()])) {
    const target = names.get(answer.inReplyTo ?? '');
    if (target === undefined || seen.has(answer.path)) continue;
    const under = gather(context, answer, new Set([...seen, answer.path]));
    const top = (entry: Interaction): Interaction =>
      entry.inReplyTo === null ? { ...entry, inReplyTo: under.root } : entry;
    said.push(['written', replyPostInteraction(context, answer, under.root, target)]);
    for (const entry of under.written) said.push(['written', top(entry)]);
    for (const [id, entry] of under.held) held.set(id, top(entry));
    for (const id of under.withdrawn) withdrawn.add(id);
  }
  return { said, held, withdrawn };
}

/**
 * One native comment's page: the comment, its replies threaded under it by
 * the rule the post's thread uses, and the chain from it up to the post.
 *
 * Its replies are the same list threaded from the comment rather than from
 * the post, so a reply the post's thread shows is shown here, and one it
 * leaves out is left out here.
 */
function commentThread(context: Reading, id: string): CommentThread | undefined {
  const stored = context.admin.getComment(id);
  if (stored?.source !== 'comment' || stored.status !== 'approved') return undefined;
  const post = context.store.getBySlug(stored.slug);
  if (post === undefined) return undefined;

  const said = gather(context, post);
  const comment = said.written.find((reply) => reply.id === id);
  if (comment === undefined) return undefined;

  const replies = threadOf(said, id);
  sortThread(replies);
  return {
    post,
    comment: { ...comment, replies },
    ancestors: ancestorsOf(said, comment),
  };
}

function replyNamed(context: Reading, document: Document, url: string): Interaction | undefined {
  return namedIn(context, document, gather(context, document), url);
}

/** The entry of a gathered conversation a URL names, held ones included. */
function namedIn(
  context: Reading,
  document: Document,
  said: Gathered,
  url: string,
): Interaction | undefined {
  let named: URL;
  try {
    named = new URL(url, context.baseUrl);
  } catch {
    return undefined;
  }
  const key = keyNamedBy(named, document, context.baseUrl);

  return [...said.written, ...said.held.values()].find(
    (reply) =>
      reply.key === key ||
      reply.id === named.href ||
      (reply.url !== null && absoluteUrl(reply.url, context.baseUrl) === named.href),
  );
}

function heldAt(context: Reading, url: string): HeldAt | undefined {
  const post = documentNamed(context, url);
  if (post === undefined || !isServed(post, context.store.now())) return undefined;
  if (url === absoluteUrl(post.permalink, context.baseUrl) || url === rootOf(context, post)) {
    return { kind: 'document', post, author: documentAuthor(context, post) };
  }
  const said = gather(context, post);
  const reply = namedIn(context, post, said, url);
  if (reply === undefined || said.withdrawn.has(reply.id) || said.held.has(reply.id)) {
    return undefined;
  }
  return { kind: 'reply', post, reply };
}

function repliesTo(context: Reading, key: string): RepliesOf | undefined {
  if (!isKey(key)) return undefined;

  // Each source's index is asked in turn, so a key naming nothing costs three
  // lookups and no more (TASK-327).
  const [document] = context.store.listByRepliesKey(key);
  if (document !== undefined) {
    if (repliesKey(feedGuid(document, context.baseUrl)) === key) {
      return repliesIn(context, document, null);
    }
    const root = threadRootOf(context, document);
    return root === undefined ? undefined : repliesIn(context, root, key);
  }

  const comment = context.admin.getComment(key);
  if (comment !== undefined) {
    const post = context.store.getBySlug(comment.slug);
    return post === undefined ? undefined : repliesIn(context, post, key);
  }

  for (const activity of context.admin.listRepliesByKey(key)) {
    const reply = replyFrom(activity);
    if (reply === undefined) continue;
    const post = documentNamed(context, reply.id);
    return post === undefined ? undefined : repliesIn(context, post, key);
  }
  return undefined;
}

/**
 * The direct replies of one reply in a document's thread, or of the document
 * itself, while the document is served and the reply is one a reader sees.
 */
function repliesIn(context: Reading, post: Document, key: string | null): RepliesOf | undefined {
  if (!isServed(post, context.store.now())) return undefined;
  const thread = postConversation(context, post).replies;
  const reply = key === null ? null : visibleReply(thread, key);
  if (reply === undefined) return undefined;
  return {
    post,
    reply,
    replies: repliesFed(reply?.replies ?? thread).map((entry) => ({ ...entry, parent: reply })),
  };
}

function upstreamsOf(context: Reading, document: Document): Upstream[] {
  const top = threadRootOf(context, document) ?? document;
  if (!isServed(top, context.store.now())) return [];
  const said = gather(context, top);
  const site = new URL(context.baseUrl).origin;
  const elsewhere = (url: string | null | undefined): url is string => {
    if (url === null || url === undefined) return false;
    try {
      return new URL(url).origin !== site;
    } catch {
      return false;
    }
  };

  const found: Upstream[] = [];
  const posts = [
    top,
    ...said.written.flatMap((entry) => {
      const post =
        entry.source === 'post' ? context.store.getByPermalink(entry.url ?? '') : undefined;
      return post === undefined ? [] : [post];
    }),
  ];
  for (const post of posts) {
    if (!elsewhere(post.inReplyTo)) continue;
    found.push({
      post,
      source: absoluteUrl(post.permalink, context.baseUrl),
      target: post.inReplyTo,
      replies: postConversation(context, post).replies,
    });
  }

  const entries = new Map(said.written.map((entry) => [entry.id, entry]));
  for (const entry of said.written) {
    if (entry.source !== 'comment' || entry.inReplyTo === null) continue;
    const parent = entries.get(entry.inReplyTo);
    if (parent?.source !== 'webmention' || !elsewhere(parent.url)) continue;
    const page = commentThread(context, entry.id);
    if (page === undefined) continue;
    found.push({
      post: page.post,
      source: absoluteUrl(commentPageHref(entry.id), context.baseUrl),
      target: parent.url,
      replies: page.comment.replies,
    });
  }
  return found;
}

/**
 * The document whose conversation a URL is in: the post a comment's page or
 * anchor is on, the post a webmention was sent to, the post a fediverse reply
 * answers however deep, or the document at the URL itself.
 */
function documentNamed(context: ConversationContext, url: string, depth = 0): Document | undefined {
  if (depth > MAXIMUM_NOTE_DEPTH) return undefined;
  let named: URL;
  try {
    named = new URL(url);
  } catch {
    return undefined;
  }

  if (named.origin === new URL(context.baseUrl).origin) {
    const key = commentKeyAt(named.pathname);
    if (key !== undefined) {
      const comment = context.admin.getComment(key);
      return comment === undefined ? undefined : context.store.getBySlug(comment.slug);
    }
    const permalink = permalinkOfObjectId(`${named.origin}${named.pathname}`, context.baseUrl);
    const found = permalink === undefined ? undefined : context.store.getByPermalink(permalink);
    return found ?? context.store.getByStoredObjectId(named.href);
  }

  const comment =
    context.admin.listCommentsAt(named.href)[0] ?? heldComment(context.admin, named.href);
  if (comment !== undefined) return context.store.getBySlug(comment.slug);

  for (const activity of context.admin.listActivitiesAbout([named.href])) {
    const reply = replyFrom(activity);
    if (reply?.id !== named.href) continue;
    return documentNamed(context, reply.inReplyTo, depth + 1);
  }
  return context.store.getByStoredObjectId(named.href);
}

/**
 * The document at the top of the conversation a reply post is in: what its
 * `in-reply-to` names, and what that one is in when it is a reply post too.
 * `undefined` for a reply post answering nothing on this site.
 */
function threadRootOf(
  context: Reading,
  document: Document,
  seen: Set<string> = new Set(),
): Document | undefined {
  seen.add(document.path);
  if (document.inReplyTo === undefined) return undefined;
  const named = documentNamed(context, document.inReplyTo);
  if (named === undefined || seen.has(named.path)) return undefined;
  return threadRootOf(context, named, seen) ?? named;
}

/** How many notes deep a reply is followed back to the post it is about. */
const MAXIMUM_NOTE_DEPTH = 32;

/**
 * What a top-level answer names. The object id when the post has one, and the
 * permalink otherwise: a post that has never been delivered can still have
 * native comments, and they have to hang off something.
 */
function rootOf(context: Reading, document: Document): string {
  return activityStreamsId(document, context.baseUrl, context.store.now()) ?? document.permalink;
}

/**
 * Every URL a reply post's `in-reply-to` could name something here by, and the
 * id each one names: the post by its permalink, every URL it used to live at
 * and its object id, and every entry by its id, its url and, for a comment
 * written here, its page and its anchor.
 */
function namesIn(
  context: Reading,
  document: Document,
  root: string,
  replies: readonly Interaction[],
): Map<string, string> {
  const permalink = absoluteUrl(document.permalink, context.baseUrl);
  const former = (document.redirectFrom ?? []).map((url) => absoluteUrl(url, context.baseUrl));
  const names = new Map<string, string>([permalink, ...former, root].map((url) => [url, root]));
  for (const reply of replies) {
    for (const name of namesOf(reply, permalink, context.baseUrl)) {
      if (!names.has(name)) names.set(name, reply.id);
    }
  }
  return names;
}

function namesOf(reply: Interaction, permalink: string, baseUrl: string): string[] {
  const names = [reply.id];
  if (reply.url !== null) names.push(absoluteUrl(reply.url, baseUrl));
  if (reply.source === 'comment') names.push(...commentNames(reply.id, permalink, baseUrl));
  return names;
}

/** A reply post as the thread's own shape, answering `inReplyTo`. */
function replyPostInteraction(
  context: Reading,
  post: Document,
  id: string,
  inReplyTo: string,
): Interaction {
  return {
    ...unstored(id),
    source: 'post',
    kind: 'reply',
    author: documentAuthor(context, post),
    url: post.permalink,
    content: post.html,
    published: new Date(post.date ?? post.updated ?? 0),
    inReplyTo,
    status: 'published',
    replies: [],
  };
}

/** Who a post or page on this site is by: its author, else the site's. */
function documentAuthor(context: Reading, post: Document): InteractionAuthor {
  const users = context.users();
  const { site } = context;
  const author = authorContext(users, post.author) ?? siteAuthorContext(users, site.author);
  return bylineAuthor(author, site.title);
}

/** A byline as the thread names its author, `fallback` when it names nobody. */
function bylineAuthor(author: AuthorContext | undefined, fallback: string): InteractionAuthor {
  return {
    name: author?.name ?? fallback,
    handle: null,
    url: author?.url ?? null,
    avatar: author?.avatar ?? null,
    actorId: null,
    feed: author?.username === undefined ? null : authorFeedHref(author.username, 'rss'),
    username: author?.username ?? null,
  };
}

/** The key a URL on this site names by a comment's page or by an anchor on the post. */
function keyNamedBy(url: URL, document: Document, baseUrl: string): string | undefined {
  const post = new URL(absoluteUrl(document.permalink, baseUrl));
  if (url.origin !== post.origin) return undefined;

  const onItsPage = commentKeyAt(url.pathname);
  if (onItsPage !== undefined) return onItsPage;

  const anchor = `#${commentAnchor('')}`;
  if (url.pathname !== post.pathname || !url.hash.startsWith(anchor)) return undefined;
  return url.hash.slice(anchor.length);
}

/**
 * What a reply answers, from the top of the thread down to its parent.
 *
 * An ancestor a reader may not see is a `null`, and the walk goes on through
 * what that one answered when the site still knows it: a pending or spam
 * comment is in the index, and a withdrawn note is still in the log. A deleted
 * comment is known by nothing, so the chain stops at it and goes straight to
 * the post. Each id is visited once, so a cycle ends.
 */
function ancestorsOf(said: Gathered, reply: Interaction): (Interaction | null)[] {
  const all = new Map(said.written.map((entry) => [entry.id, entry]));
  const chain: (Interaction | null)[] = [];
  const seen = new Set<string>([reply.id]);

  for (let target = reply.inReplyTo; target !== null && target !== said.root;) {
    if (seen.has(target)) break;
    seen.add(target);

    const known = all.get(target);
    if (known !== undefined && !said.withdrawn.has(target)) {
      chain.unshift(known);
      target = known.inReplyTo;
      continue;
    }

    chain.unshift(null);
    target = (known ?? said.held.get(target))?.inReplyTo ?? null;
  }

  return chain;
}

function rsvpGroups(answers: readonly Interaction[]): RsvpGroup[] {
  const people = latestAnswerPerPerson(answers);
  return RSVP_GROUP_ORDER.map((value) => ({
    value,
    label: RSVP_LABELS[value],
    people: people.filter((person) => person.rsvp?.value === value),
  })).filter((group) => group.people.length > 0);
}

function latestAnswerPerPerson(answers: readonly Interaction[]): Interaction[] {
  const latest = new Map<string, Interaction>();
  for (const answer of [...answers].sort(byPublished)) {
    const { author } = answer;
    latest.set(author.actorId ?? author.url ?? answer.id, answer);
  }
  return [...latest.values()].sort(byPublished);
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
function siteConversation(context: Reading, limit: number): SiteInteraction[] {
  const naming = authorNaming(context.admin);
  const posts = new PostsByObjectId(context);
  const now = context.store.now();
  const shown = (post: Document | undefined): post is Document =>
    post !== undefined && isListed(post, now);
  const said: (Interaction & { post: Document })[] = [];

  for (let offset = 0; said.length < limit;) {
    const page = context.admin.listReplies({ limit: limit * OVERSCAN, offset });
    if (page.length === 0) break;
    offset += page.length;

    for (const activity of page) {
      const reply = replyFrom(activity);
      if (reply === undefined || heldComment(context.admin, reply.id) !== undefined) continue;
      // A note answering another note is as much this post's as one answering
      // the post, so the post is found the way a reply post finds its thread.
      const post = documentNamed(context, reply.inReplyTo);
      if (!shown(post)) continue;

      said.push({ ...federatedInteraction(reply, naming(activity.actorId)), post });
      if (said.length === limit) break;
    }
  }

  // Every quote the site vouches for, rather than a page of them: there is one
  // approval per quote, and a site has few enough to read whole.
  for (const approval of readAllQuoteAuthorizations(context.contentDir)) {
    const post = posts.get(approval.post);
    if (!shown(post)) continue;
    for (const quote of quotesOf(context.admin, [approval], [approval.post], naming)) {
      said.push({ ...quote, post });
    }
  }

  // Each post's thread, read once: where each reply sits and what it carries
  // is the thread's to say, so the site's feed and the post's agree.
  const threads = new Map<string, ReadonlyMap<string, Placed>>();
  const placedOn = (post: Document): ReadonlyMap<string, Placed> => {
    let found = threads.get(post.path);
    if (found === undefined) {
      found = new Map(saidIn(postConversation(context, post)).map((reply) => [reply.id, reply]));
      threads.set(post.path, found);
    }
    return found;
  };

  // A stored comment is taken from its post's thread rather than read on its
  // own, so a reaction or an event's RSVP, which the thread holds apart, is
  // left out here as it is from the post's feed.
  for (const stored of context.admin.listComments({
    status: 'approved',
    limit: limit * OVERSCAN,
  })) {
    const post = context.store.getBySlug(stored.slug);
    if (!shown(post)) continue;
    const entry = placedOn(post).get(stored.id);
    if (entry !== undefined) said.push({ ...entry, post });
  }

  // A reply post is in the feed of the thread it is shown in, unlisted or
  // not: the thread is listed, and the reply post is one of its answers.
  for (const answer of context.store.listReplyPosts({ limit: limit * OVERSCAN })) {
    const post = threadRootOf(context, answer);
    if (!shown(post)) continue;
    const reply = placedOn(post).get(rootOf(context, answer));
    if (reply !== undefined) said.push({ ...reply, post });
  }

  return newestFirst(said.filter(conversational), limit).map((entry) => {
    const thread = placedOn(entry.post);
    return {
      ...(thread.get(entry.id) ?? { ...entry, parent: null }),
      post: entry.post,
      replyingTo:
        entry.inReplyTo === null ? null : (thread.get(entry.inReplyTo)?.author.name ?? null),
    };
  });
}

/** How many visible replies answer each of these documents directly, by permalink. */
function directCounts(context: Reading, documents: readonly Document[]): Map<string, number> {
  return new Map(
    documents.map((document) => [
      document.permalink,
      repliesFed(postConversation(context, document).replies).length,
    ]),
  );
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

/**
 * The approved quotes of one post, as mentions, in no order.
 *
 * The approval is what makes a quote showable (FEP-044f: a quote its author
 * never approved should not be displayed), so the approvals are walked and the
 * log is asked for each one's note, rather than the other way about. The note
 * has to be the approved one, by the approved actor, quoting this post: an
 * approval of one quote vouches for nothing else. Both are files (decision-9),
 * so a rebuilt index shows exactly what the live one did.
 */
function quotesOf(
  admin: AdminStore,
  approvals: readonly QuoteAuthorizationRecord[],
  objectIds: readonly string[],
  naming: (actorId: string) => InteractionAuthor,
): Interaction[] {
  const quotes: Interaction[] = [];
  for (const approval of approvals) {
    if (!objectIds.includes(approval.post)) continue;

    for (const activity of admin.listActivitiesAbout([approval.quote])) {
      if (activity.actorId !== approval.actor) continue;
      const quote = quoteFrom(activity);
      if (quote?.id !== approval.quote || !objectIds.includes(quote.quoted)) continue;

      quotes.push({
        ...unstored(quote.id),
        source: 'activitypub',
        kind: 'mention',
        author: naming(quote.actorId),
        url: quote.url,
        content: sanitizeCommentHtml(quote.html),
        published: quote.published,
        inReplyTo: null,
        status: 'published',
        replies: [],
      });
      // The first `Create` of the note is the one shown: a redelivery is the
      // same quote again.
      break;
    }
  }
  return quotes;
}

/** One logged fediverse reply as the thread's own shape. */
function federatedInteraction(
  reply: { id: string; url: string; html: string; published: Date; inReplyTo: string },
  author: InteractionAuthor,
): Interaction {
  return {
    ...unstored(reply.id),
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

function unstored(id: string): Pick<Interaction, 'id' | 'key' | 'guid' | 'migrated'> {
  return { id, key: repliesKey(id), guid: id, migrated: false };
}

/** One stored comment as the thread's own shape. */
function interactionOf(
  comment: PostComment,
  permalink: string,
  baseUrl: string,
  users: readonly User[],
): Interaction {
  // A user the site no longer has is named as the comment was signed.
  const user = users.find((candidate) => candidate.username === comment.user);
  return {
    id: comment.id,
    key: comment.id,
    guid:
      comment.source === 'comment'
        ? absoluteUrl(commentPageHref(comment.id), baseUrl)
        : (comment.origin ?? comment.url ?? comment.id),
    migrated: comment.migrated === true,
    source: comment.source,
    kind: comment.kind,
    author:
      user === undefined
        ? {
            name: comment.author.name,
            handle: comment.actor === undefined ? null : (actorHandle(comment.actor) ?? null),
            url: comment.author.url,
            avatar: comment.author.avatar === null ? null : avatarHref(comment.author.avatar),
            actorId: comment.actor ?? null,
            feed: comment.source === 'webmention' ? comment.author.url : null,
            username: null,
          }
        : bylineAuthor(profileContext(user), comment.author.name),
    // Where it can be read. A comment written here has a page of its own
    // (TASK-318); a webmention lives on the page it was sent from, and its
    // `url` says so. A theme that prints `url` for a fediverse reply prints a
    // working link for either, and so does a feed.
    url:
      comment.url ??
      (comment.source === 'comment'
        ? commentPageHref(comment.id)
        : `${permalink}#${commentAnchor(comment.id)}`),
    content: comment.content.html,
    published: new Date(comment.submitted),
    inReplyTo: comment.inReplyTo,
    status: comment.status,
    replies: [],
    ...(comment.rsvp === undefined
      ? {}
      : { rsvp: { value: comment.rsvp, label: RSVP_LABELS[comment.rsvp] } }),
  };
}

/** What a post's comments feed carries, at every depth and in no order. */
export function spokenIn(conversation: Conversation): Placed[] {
  return saidIn(conversation).filter(conversational);
}

/** The mentions and every visible reply of a conversation, each with its parent. */
function saidIn(conversation: Conversation): Placed[] {
  return [
    ...conversation.mentions.map((mention) => ({ ...mention, parent: null })),
    ...placed(conversation.replies),
  ];
}

/**
 * Whether a feed carries it and a reply count counts it (TASK-335): somebody's
 * words, a reply or a mention, said here. A like, a boost or a repost says
 * nothing — "@ada liked this" would be an item with an empty body — and a
 * migrated entry was published before the site came here, so a reader must
 * not see it as new.
 */
function conversational(entry: Interaction): boolean {
  return !entry.migrated && (entry.kind === 'reply' || entry.kind === 'mention');
}

/** Every visible reply of a thread at any depth, each with the reply it sits under. */
function placed(replies: readonly ThreadReply[], parent: Interaction | null = null): Placed[] {
  return directReplies(replies).flatMap((reply) => [
    { ...reply, parent },
    ...placed(reply.replies, reply),
  ]);
}

/**
 * The visible replies directly under an entry of a thread (TASK-324): a
 * hidden comment's visible replies count as its parent's, as {@link Placed}
 * says, so every visible reply is directly under exactly one thing.
 */
function directReplies(replies: readonly ThreadReply[]): Interaction[] {
  return replies.flatMap((reply) => (isWithheld(reply) ? directReplies(reply.replies) : [reply]));
}

/** The direct replies a feed carries and a count advertises. */
function repliesFed(replies: readonly ThreadReply[]): Interaction[] {
  return directReplies(replies).filter(conversational);
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
  said: readonly (Placed & {
    post?: Document | undefined;
    replyingTo?: string | null | undefined;
  })[],
  options: { baseUrl: string; limit: number; cited: CitedPageReader; post?: Document | undefined },
): FeedComment[] {
  const { baseUrl } = options;
  return newestFirst([...said], options.limit).map((entry) => {
    const thread = entry.post ?? options.post;
    const answered =
      entry.parent === null
        ? thread === undefined
          ? undefined
          : feedGuid(thread, baseUrl)
        : entry.parent.guid;
    const replies = repliesFed(entry.replies);
    return {
      id: entry.guid,
      url: absoluteUrl(entry.url ?? '/', baseUrl),
      author: entry.author.name,
      published: entry.published,
      html: entry.content,
      ...(answered === undefined ? {} : { inReplyTo: answered }),
      ...(replies.length === 0
        ? {}
        : {
            replies: {
              count: replies.length,
              feed: absoluteUrl(repliesFeedPath(entry.key), baseUrl),
            },
          }),
      ...(entry.author.feed === null
        ? {}
        : { authorFeed: absoluteUrl(entry.author.feed, baseUrl) }),
      ...(entry.post === undefined
        ? {}
        : {
            post: { title: postLabel(entry.post, options.cited), permalink: entry.post.permalink },
          }),
      ...(entry.replyingTo === undefined || entry.replyingTo === null
        ? {}
        : { replyingTo: entry.replyingTo }),
    };
  });
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
  readonly #context: Reading;
  readonly #found = new Map<string, Document | undefined>();
  #all: Map<string, Document> | undefined;

  constructor(context: Reading) {
    this.#context = context;
  }

  get(objectId: string): Document | undefined {
    if (!this.#found.has(objectId)) this.#found.set(objectId, this.#resolve(objectId));
    return this.#found.get(objectId);
  }

  #resolve(objectId: string): Document | undefined {
    const natural = naturalObjectId(objectId);
    const permalink = permalinkOfObjectId(natural, this.#context.baseUrl);
    if (permalink !== undefined) {
      const document = this.#context.store.getByPermalink(permalink);
      if (
        document !== undefined &&
        activityStreamsId(document, this.#context.baseUrl, this.#context.store.now()) === natural
      ) {
        return document;
      }
    }
    return this.#everything().get(natural);
  }

  #everything(): Map<string, Document> {
    if (this.#all === undefined) {
      this.#all = new Map();
      for (const document of this.#context.store.listPosts()) {
        const id = activityStreamsId(document, this.#context.baseUrl, this.#context.store.now());
        if (id !== undefined) this.#all.set(id, document);
      }
    }
    return this.#all;
  }
}

/**
 * The replies as a thread: those answering `under` at the top, each carrying
 * the replies that answer it, oldest first at every level. `under` is the
 * post, or one reply for that reply's own page.
 *
 * Four things decide where a reply goes, and all four are what somebody
 * reading the page would expect:
 *
 * - A reply whose target is gone — deleted by its author — is shown under
 *   whatever *that* was answering, rather than disappearing with it. The
 *   conversation stays readable and only the withdrawn note is missing.
 * - A reply answering a native comment a reader may not see (TASK-325) is
 *   shown under a placeholder for it, the way the reply's own page shows it.
 *   A comment waiting for a moderator or filed as spam still says what it
 *   answers, and the placeholder goes there; a deleted one is known by
 *   nothing, so its placeholder goes under the post. A hidden comment nobody
 *   visible answered gets no placeholder at all.
 * - A reply answering something that is no part of this conversation is left
 *   out. The log holds it because it named something this walk asked about — a
 *   note answering the like of a post is the shape of that — but the post is
 *   not what it is talking about.
 * - A note the site was told about twice is one reply, because the map is
 *   keyed by the note's own id.
 *
 * The walk is bounded by the number of notes, and a placeholder is made once,
 * so a log carrying a cycle — two notes each claiming to answer the other,
 * which nothing stops a remote server from sending — ends rather than hangs.
 */
function threadOf(said: Gathered, under: string = said.root): ThreadReply[] {
  const shown = new Map<string, Interaction>();
  const targets = new Map<string, string>();
  for (const reply of said.written) {
    targets.set(reply.id, reply.inReplyTo ?? said.root);
    if (!said.withdrawn.has(reply.id)) shown.set(reply.id, reply);
  }

  const top: ThreadReply[] = [];
  const withheld = new Map<string, WithheldReply | undefined>();

  // The list an entry answering `target` joins, or `undefined` for one that
  // belongs somewhere else. Only a native entry can answer a deleted comment:
  // a fediverse note naming an unknown id is answering something else.
  const siblings = (
    target: string | undefined,
    self: string,
    native: boolean,
  ): ThreadReply[] | undefined => {
    for (let step = 0; step <= targets.size; step += 1) {
      if (target === undefined) return undefined;
      if (target === under) return top;
      if (target === said.root) return undefined;

      const parent = shown.get(target);
      if (parent !== undefined) return parent.id === self ? undefined : parent.replies;
      if (said.held.has(target) || (native && !targets.has(target))) {
        return placeholder(target)?.replies;
      }
      target = targets.get(target);
    }
    return undefined;
  };

  const placeholder = (id: string): WithheldReply | undefined => {
    if (withheld.has(id)) return withheld.get(id);
    withheld.set(id, undefined);
    const list = siblings(said.held.get(id)?.inReplyTo ?? said.root, id, true);
    if (list === undefined) return undefined;
    const key = isKey(id) ? id : repliesKey(id);
    const entry: WithheldReply = { id, key, withheld: true, replies: [] };
    list.push(entry);
    withheld.set(id, entry);
    return entry;
  };

  for (const reply of shown.values()) {
    siblings(targets.get(reply.id), reply.id, reply.source !== 'activitypub')?.push(reply);
  }

  return top;
}

/** Oldest first, which is the order a conversation reads in. */
function byPublished(left: Interaction, right: Interaction): number {
  return left.published.getTime() - right.published.getTime();
}

/**
 * When a thread entry starts: a reply's own date, and a placeholder's first
 * visible reply's, since the date of a hidden comment is not the reader's.
 */
function startOf(reply: ThreadReply): number {
  if (!isWithheld(reply)) return reply.published.getTime();
  const [first] = reply.replies;
  return first === undefined ? 0 : startOf(first);
}

/** Put every level of a thread in time order, all the way down. */
function sortThread(replies: ThreadReply[]): void {
  for (const reply of replies) sortThread(reply.replies);
  replies.sort((left, right) => startOf(left) - startOf(right));
}

/** How many visible replies a thread holds, counting all the way down. */
function countReplies(replies: readonly ThreadReply[]): number {
  let total = 0;
  for (const reply of replies) total += (isWithheld(reply) ? 0 : 1) + countReplies(reply.replies);
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
function activitiesAround(admin: AdminStore, objectIds: readonly string[]): InboxActivity[] {
  const collected = new Map<number, InboxActivity>();
  const asked = new Set<string>(objectIds);
  let frontier: string[] = [...asked];

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
 * A follower is named from the profile it published when it followed, and
 * anybody else from the profile the site fetched when they were first heard
 * from (TASK-184). Both are read from the database: nothing is fetched while a
 * page is drawn. Only an actor neither knows is named by a guess from their
 * URL, which is their server when the URL ends in a number.
 */
function authorNaming(admin: AdminStore): (actorId: string) => InteractionAuthor {
  const known = new Map<string, InteractionAuthor>();
  // Read once, on the first unknown actor, rather than per actor: the
  // followers are one row per (user, actor) now (decision-14), so the same
  // stranger may be on the list several times and any of those rows names them
  // the same way — the columns read here are the actor's own name and picture.
  let followers: Map<string, ActorProfile> | undefined;

  return (actorId) => {
    const held = known.get(actorId);
    if (held !== undefined) return held;

    followers ??= new Map(admin.listFollowers().map((entry) => [entry.actorId, entry]));
    const profile = followers.get(actorId) ?? admin.getActorProfile(actorId);
    const handle = profile?.handle ?? actorHandle(actorId) ?? null;
    const icon = profile?.iconUrl ?? null;
    const author: InteractionAuthor = {
      name: profile?.name ?? handle ?? guessedName(actorId),
      handle,
      url: profile?.url ?? actorId,
      avatar: icon === null ? null : avatarHref(icon),
      actorId,
      feed: null,
      username: null,
    };
    known.set(actorId, author);
    return author;
  };
}
