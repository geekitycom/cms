import type { User } from '../admin/accounts.ts';
import { readSiteSettings } from '../admin/settings.ts';
import { avatarHref } from '../avatars/avatars.ts';
import type { ActorProfile, AdminStore, InboxActivity, PostComment } from '../admin/store.ts';
import type { Document } from '../content/document.ts';
import { postLabel, postTypeOf } from '../content/post-type.ts';
import type { CitedPageReader } from '../content/citation.ts';
import { RSVP_LABELS } from '../content/rsvp.ts';
import type { RsvpValue } from '../content/rsvp.ts';
import type { ContentStore } from '../content/store.ts';
import { readAllQuoteAuthorizations } from '../federation/quotes.ts';
import type { QuoteAuthorizationRecord } from '../federation/quotes.ts';
import {
  actorHandle,
  guessedName,
  quoteFrom,
  replyFrom,
  REPLY_ACTIVITY_TYPE,
} from '../federation/replies.ts';
import { authorContext, siteAuthorContext } from './authors.ts';
import { activityStreamsId, isListed, permalinkOfObjectId } from './documents.ts';
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
 * site's post pointing at this one (TASK-51). `post` is a reply post a user of
 * this site wrote, whose `in-reply-to` names the post or something said under
 * it (TASK-300). All four are the same shape and thread together, which is the
 * whole point of naming the source rather than keeping four lists.
 */
export type InteractionSource = 'activitypub' | 'comment' | 'webmention' | 'post';

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
  /**
   * Their avatar, when the site knows one: always a same-origin path, never
   * the remote URL, so a reader's browser asks this site for it (TASK-134).
   */
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
  readonly replies: ThreadReply[];
  /**
   * What a reply that is an RSVP says (TASK-198): its `rsvp` value and the
   * words for it. A webmention carries one, and so does a fediverse answer
   * to an event (TASK-200).
   */
  readonly rsvp?: { readonly value: RsvpValue; readonly label: string };
}

/**
 * A comment a reader may not see, standing in the thread for the replies to it
 * that a reader may (TASK-325): it is waiting for a moderator, filed as spam or
 * deleted. It names nobody and says nothing, and there is one only while a
 * visible reply sits under it.
 */
export interface WithheldReply {
  /** The hidden comment's id, so its anchor on the post is still there. */
  readonly id: string;
  readonly withheld: true;
  /** The replies under it, oldest first, at least one of them visible. */
  readonly replies: ThreadReply[];
}

/** One entry of a thread: a reply, or the placeholder for a hidden one. */
export type ThreadReply = Interaction | WithheldReply;

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
  /** RSVPs to an event, one per person, in every group. */
  readonly rsvps: number;
  /** All of them added up: zero is what "no conversation" means. */
  readonly total: number;
}

/** Everything under one post. */
export interface Conversation {
  /** The replies to the post itself, oldest first, each carrying its own. */
  readonly replies: ThreadReply[];
  /** The likes, oldest first. */
  readonly likes: Interaction[];
  /** The boosts and the reposts, oldest first and in one list. */
  readonly boosts: Interaction[];
  /** The pages that linked here without answering, oldest first. */
  readonly mentions: Interaction[];
  /**
   * The answers to an event (TASK-200), grouped as going, maybe, interested
   * and not going, each group oldest first and only when it has somebody in
   * it. Empty on a post that is no event.
   */
  readonly rsvps: RsvpGroup[];
  /** How many of each. */
  readonly counts: InteractionCounts;
}

/** Everybody who gave an event one answer. */
export interface RsvpGroup {
  readonly value: RsvpValue;
  readonly label: string;
  /** Each person's latest answer, oldest first, each an RSVP interaction. */
  readonly people: Interaction[];
}

const RSVP_GROUP_ORDER: readonly RsvpValue[] = ['yes', 'maybe', 'interested', 'no'];

const RSVP_ACTIVITIES: Readonly<Record<string, RsvpValue | undefined>> = {
  Accept: 'yes',
  TentativeAccept: 'maybe',
  Reject: 'no',
};

/** One interaction with the post it is about, which a site-wide list needs. */
export interface SiteInteraction extends Interaction {
  /** The post it answers. */
  readonly post: Document;
  /**
   * Who wrote the reply it answers, when it answers one a reader can see
   * (TASK-318), and `null` for an answer to the post itself.
   */
  readonly replyingTo: string | null;
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
  /**
   * One native comment as its own page reads it (TASK-318), or `undefined`
   * for an id that names no approved comment written on this site. The post
   * comes back in whatever state it is in, so the page can answer as the post
   * itself would.
   */
  readonly comment: (id: string) => CommentThread | undefined;
  /**
   * The id of the reply on a post that a URL names, or `undefined` (TASK-319):
   * a comment by its own page or by the post's `#comment-` anchor, a
   * webmention by the page it was sent from, a fediverse reply by its url or
   * its id. Every stored comment counts whatever its status, because what a
   * reply answers is a fact about it, and whether a reader may see the one it
   * answers is decided when the thread is read.
   */
  readonly replyNamed: (document: Document, url: string) => string | undefined;
  /**
   * The reply a reader may see that a URL names anywhere on this site, with
   * the post it is on (TASK-300): a comment by its page or its anchor, a
   * webmention by the page it was sent from, a fediverse reply by its id or
   * url. What a reply post answering one cites, instead of fetching a page.
   */
  readonly replyAt: (url: string) => ReplyAt | undefined;
}

/** A reply on this site, and the post whose conversation it is in. */
export interface ReplyAt {
  readonly post: Document;
  readonly reply: Interaction;
}

/** A native comment, what it answers and what answers it (TASK-318). */
export interface CommentThread {
  /** The post it is on. */
  readonly post: Document;
  /** The comment, carrying its replies at every depth as the thread does. */
  readonly comment: Interaction;
  /**
   * What it answers, from the top-level comment down to its parent. `null`
   * is an ancestor a reader may not see: one waiting for a moderator, filed
   * as spam, deleted or withdrawn.
   */
  readonly ancestors: readonly (Interaction | null)[];
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
    comment: (id) => commentThread(context, id),
    replyNamed: (document, url) => replyNamed(context, document, url),
    replyAt: (url) => replyAt(context, url),
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
function postConversation(context: ConversationContext, document: Document): Conversation {
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

/** Everything said about one post, sorted into its groups and not yet threaded. */
interface Gathered {
  /** What a top-level answer names. */
  readonly root: string;
  /** The replies, oldest first, withdrawn ones included. */
  readonly written: Interaction[];
  /** The ids of what an actor has taken back. */
  readonly withdrawn: ReadonlySet<string>;
  /** The native comments a reader may not see, pending or spam, by id. */
  readonly held: ReadonlyMap<string, Interaction>;
  readonly likes: Interaction[];
  readonly boosts: Interaction[];
  readonly mentions: Interaction[];
  readonly answers: Interaction[];
}

function gather(
  context: ConversationContext,
  document: Document,
  seen: ReadonlySet<string> = new Set([document.path]),
): Gathered {
  const objectId = activityStreamsId(document, context.baseUrl);
  const root = rootOf(context, document);

  const activities = objectId === undefined ? [] : activitiesAround(context.admin, objectId);
  const naming = authorNaming(context.admin);
  const quotes =
    objectId === undefined
      ? []
      : quotesOf(context.admin, readAllQuoteAuthorizations(context.contentDir), objectId, naming);

  const withdrawn = withdrawnBy(activities);
  const written: Interaction[] = [];
  const likes: Interaction[] = [];
  const boosts: Interaction[] = [];
  const mentions: Interaction[] = [...quotes];
  const answers: Interaction[] = [];
  const held = new Map<string, Interaction>();
  const reacted = new Set<string>();
  const isEvent = postTypeOf(document) === 'event';

  for (const activity of activities) {
    const answer = isEvent ? RSVP_ACTIVITIES[activity.activityType] : undefined;
    if (answer !== undefined) {
      if (activity.objectId !== objectId) continue;
      if (activity.activityId !== null && withdrawn.has(activity.activityId)) continue;
      const author = naming(activity.actorId);
      answers.push({
        id: activity.activityId ?? `${activity.actorId}#rsvp`,
        source: 'activitypub',
        kind: 'reply',
        author,
        url: author.url,
        content: '',
        published: new Date(activity.receivedAt),
        inReplyTo: null,
        status: 'published',
        replies: [],
        rsvp: { value: answer, label: RSVP_LABELS[answer] },
      });
      continue;
    }

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

  for (const stored of context.admin.listCommentsFor(document.slug)) {
    const comment = interactionOf(stored, document.permalink);
    if (stored.status !== 'approved') {
      held.set(comment.id, comment);
      continue;
    }
    // A repost joins the boosts, because a reader looking at the page is being
    // told the same thing by both; a mention is its own group, because it is
    // neither an answer nor a reaction.
    const group =
      isEvent && comment.rsvp !== undefined
        ? answers
        : comment.kind === 'reply'
          ? written
          : comment.kind === 'like'
            ? likes
            : comment.kind === 'mention'
              ? mentions
              : boosts;
    group.push({ ...comment, replies: [] });
  }

  // The reply posts answering the post or anything said under it, each
  // bringing what was said under it: an answer to a reply post lands against
  // the reply post, and this is what stitches it into the thread it is in.
  const names = namesIn(context, document, root, [...written, ...held.values()]);
  for (const answer of context.store.listRepliesTo([...names.keys()])) {
    const target = names.get(answer.inReplyTo ?? '');
    if (target === undefined || seen.has(answer.path)) continue;
    const under = gather(context, answer, new Set([...seen, answer.path]));
    const top = (entry: Interaction): Interaction =>
      entry.inReplyTo === null ? { ...entry, inReplyTo: under.root } : entry;
    written.push(replyPostInteraction(context, answer, under.root, target));
    written.push(...under.written.map(top));
    for (const [id, entry] of under.held) held.set(id, top(entry));
    for (const id of under.withdrawn) withdrawn.add(id);
  }

  // Sorted before threading rather than after, because a thread is built by
  // walking this list: two sources' entries would otherwise interleave in the
  // order the code happened to read them rather than in the order they were
  // written.
  written.sort(byPublished);
  return { root, written, withdrawn, held, likes, boosts, mentions, answers };
}

/**
 * One native comment's page: the comment, its replies threaded under it by
 * the rule the post's thread uses, and the chain from it up to the post.
 *
 * Its replies are the same list threaded from the comment rather than from
 * the post, so a reply the post's thread shows is shown here, and one it
 * leaves out is left out here.
 */
function commentThread(context: ConversationContext, id: string): CommentThread | undefined {
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

function replyNamed(
  context: ConversationContext,
  document: Document,
  url: string,
): string | undefined {
  return namedIn(context, document, gather(context, document), url)?.id;
}

/** The entry of a gathered conversation a URL names, held ones included. */
function namedIn(
  context: ConversationContext,
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
  const commentId = commentNamedBy(named, document, context.baseUrl);

  return [...said.written, ...said.held.values()].find(
    (reply) =>
      reply.id === commentId ||
      reply.id === named.href ||
      (reply.url !== null && absoluteUrl(reply.url, context.baseUrl) === named.href),
  );
}

function replyAt(context: ConversationContext, url: string): ReplyAt | undefined {
  const post = documentNamed(context, url);
  if (post === undefined) return undefined;
  const said = gather(context, post);
  const reply = namedIn(context, post, said, url);
  if (reply === undefined || said.withdrawn.has(reply.id) || said.held.has(reply.id)) {
    return undefined;
  }
  return { post, reply };
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
    const id = commentIdAt(named.pathname);
    if (id !== undefined) {
      const comment = context.admin.getComment(id);
      return comment === undefined ? undefined : context.store.getBySlug(comment.slug);
    }
    const permalink = permalinkOfObjectId(`${named.origin}${named.pathname}`, context.baseUrl);
    const found = permalink === undefined ? undefined : context.store.getByPermalink(permalink);
    return found ?? context.store.getByStoredObjectId(named.href);
  }

  const [comment] = context.admin.listCommentsAt(named.href);
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
  context: ConversationContext,
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
function rootOf(context: ConversationContext, document: Document): string {
  return activityStreamsId(document, context.baseUrl) ?? document.permalink;
}

/**
 * Every URL a reply post's `in-reply-to` could name something here by, and the
 * id each one names: the post by its permalink and object id, and every entry
 * by its id, its url and, for a comment written here, its page and its anchor.
 */
function namesIn(
  context: ConversationContext,
  document: Document,
  root: string,
  replies: readonly Interaction[],
): Map<string, string> {
  const permalink = absoluteUrl(document.permalink, context.baseUrl);
  const names = new Map<string, string>([
    [permalink, root],
    [root, root],
  ]);
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
  if (reply.source === 'comment') {
    names.push(
      absoluteUrl(commentPageHref(reply.id), baseUrl),
      `${permalink}#${commentAnchor(reply.id)}`,
    );
  }
  return names;
}

/** A reply post as the thread's own shape, answering `inReplyTo`. */
function replyPostInteraction(
  context: ConversationContext,
  post: Document,
  id: string,
  inReplyTo: string,
): Interaction {
  const users = context.users();
  const author =
    authorContext(users, post.author) ??
    siteAuthorContext(users, readSiteSettings(context.contentDir).author);
  return {
    id,
    source: 'post',
    kind: 'reply',
    author: {
      name: author?.name ?? readSiteSettings(context.contentDir).title,
      handle: null,
      url: author?.url ?? null,
      avatar: author?.avatar ?? null,
      actorId: null,
    },
    url: post.permalink,
    content: post.html,
    published: new Date(post.date ?? post.updated ?? 0),
    inReplyTo,
    status: 'published',
    replies: [],
  };
}

/** The comment a URL on this site names by its page or by its anchor on the post. */
function commentNamedBy(url: URL, document: Document, baseUrl: string): string | undefined {
  const post = new URL(absoluteUrl(document.permalink, baseUrl));
  if (url.origin !== post.origin) return undefined;

  const onItsPage = commentIdAt(url.pathname);
  if (onItsPage !== undefined) return onItsPage;

  const anchor = `#${commentAnchor('')}`;
  if (url.pathname !== post.pathname || !url.hash.startsWith(anchor)) return undefined;
  return decoded(url.hash.slice(anchor.length));
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
function siteConversation(context: ConversationContext, limit: number): SiteInteraction[] {
  const naming = authorNaming(context.admin);
  const posts = new PostsByObjectId(context);
  const now = context.store.now();
  const said: (Interaction & { post: Document })[] = [];

  for (let offset = 0; said.length < limit;) {
    const page = context.admin.listReplies({ limit: limit * OVERSCAN, offset });
    if (page.length === 0) break;
    offset += page.length;

    for (const activity of page) {
      const reply = replyFrom(activity);
      if (reply === undefined) continue;
      const post = posts.get(reply.inReplyTo);
      if (post === undefined || !isListed(post, now)) continue;

      said.push({ ...federatedInteraction(reply, naming(activity.actorId)), post });
      if (said.length === limit) break;
    }
  }

  // Every quote the site vouches for, rather than a page of them: there is one
  // approval per quote, and a site has few enough to read whole.
  for (const approval of readAllQuoteAuthorizations(context.contentDir)) {
    const post = posts.get(approval.post);
    if (post === undefined || !isListed(post, now)) continue;
    for (const quote of quotesOf(context.admin, [approval], approval.post, naming)) {
      said.push({ ...quote, post });
    }
  }

  for (const stored of context.admin.listComments({
    status: 'approved',
    limit: limit * OVERSCAN,
  })) {
    const post = context.store.getBySlug(stored.slug);
    if (post === undefined || !isListed(post, now)) continue;
    said.push({ ...interactionOf(stored, post.permalink), post });
  }

  const shown = new Map<string, ReadonlyMap<string, Interaction>>();
  const repliesOn = (post: Document): ReadonlyMap<string, Interaction> => {
    let found = shown.get(post.path);
    if (found === undefined) {
      const { written, withdrawn } = gather(context, post);
      found = new Map(
        written.filter((reply) => !withdrawn.has(reply.id)).map((reply) => [reply.id, reply]),
      );
      shown.set(post.path, found);
    }
    return found;
  };

  // A reply post is in the feed of the thread it is shown in, unlisted or
  // not: the thread is listed, and the reply post is one of its answers.
  for (const answer of context.store.listReplyPosts({ limit: limit * OVERSCAN })) {
    const post = threadRootOf(context, answer);
    if (post === undefined || !isListed(post, now)) continue;
    const reply = repliesOn(post).get(rootOf(context, answer));
    if (reply !== undefined) said.push({ ...reply, post });
  }

  return newestFirst(said, limit).map((entry) => ({
    ...entry,
    replyingTo:
      entry.inReplyTo === null
        ? null
        : (repliesOn(entry.post).get(entry.inReplyTo)?.author.name ?? null),
  }));
}

/** How many answers each of these posts has, by permalink. */
function commentCounts(
  context: ConversationContext,
  documents: readonly Document[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const approvals = readAllQuoteAuthorizations(context.contentDir);
  const naming = authorNaming(context.admin);
  for (const document of documents) {
    const objectId = activityStreamsId(document, context.baseUrl);
    const federated =
      objectId === undefined
        ? 0
        : context.admin.countRepliesTo(objectId) +
          quotesOf(context.admin, approvals, objectId, naming).length;
    counts.set(
      document.permalink,
      federated +
        context.admin.countCommentsFor(document.slug, 'approved') +
        replyPostsAnswering(context, document).length,
    );
  }
  return counts;
}

/**
 * The reply posts answering a post, one of its comments or one of the notes
 * that answer it directly (TASK-300), off the indexes rather than the thread.
 */
function replyPostsAnswering(context: ConversationContext, document: Document): Document[] {
  const root = rootOf(context, document);
  const comments = context.admin
    .listCommentsFor(document.slug)
    .map((comment) => interactionOf(comment, document.permalink));
  const names = [...namesIn(context, document, root, comments).keys()];
  const objectId = activityStreamsId(document, context.baseUrl);
  if (objectId !== undefined) {
    for (const note of context.admin.listRepliesTo(objectId)) {
      if (note.objectId !== null) names.push(note.objectId);
    }
  }
  return context.store.listRepliesTo(names);
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
  objectId: string,
  naming: (actorId: string) => InteractionAuthor,
): Interaction[] {
  const quotes: Interaction[] = [];
  for (const approval of approvals) {
    if (approval.post !== objectId) continue;

    for (const activity of admin.listActivitiesAbout([approval.quote])) {
      if (activity.actorId !== approval.actor) continue;
      const quote = quoteFrom(activity);
      if (quote?.id !== approval.quote || quote.quoted !== objectId) continue;

      quotes.push({
        id: quote.id,
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
      avatar: comment.author.avatar === null ? null : avatarHref(comment.author.avatar),
      actorId: null,
    },
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

/**
 * The `id` a comment is anchored at on the page.
 *
 * Prefixed rather than bare so a comment can never collide with a heading
 * anchor the post's own Markdown produced.
 */
export function commentAnchor(id: string): string {
  return `comment-${id}`;
}

/** Where a native comment's own page is (TASK-318). */
export function commentPageHref(id: string): string {
  return `${COMMENT_PAGE_PREFIX}${encodeURIComponent(id)}/`;
}

/** What every comment page's path starts with. */
export const COMMENT_PAGE_PREFIX = '/comment/';

/** The id of the comment whose page a path is, or `undefined` (TASK-319). */
export function commentIdAt(pathname: string): string | undefined {
  if (!pathname.startsWith(COMMENT_PAGE_PREFIX) || !pathname.endsWith('/')) return undefined;
  const encoded = pathname.slice(COMMENT_PAGE_PREFIX.length, -1);
  if (encoded === '' || encoded.includes('/')) return undefined;
  return decoded(encoded);
}

function decoded(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
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

  const walk = (replies: readonly ThreadReply[]): void => {
    for (const reply of replies) {
      if (!isWithheld(reply)) said.push(reply);
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
  said: readonly (Interaction & {
    post?: Document | undefined;
    replyingTo?: string | null | undefined;
  })[],
  options: { baseUrl: string; limit: number; cited: CitedPageReader },
): FeedComment[] {
  return newestFirst([...said], options.limit).map((entry) => ({
    id: entry.id,
    url: absoluteUrl(entry.url ?? '/', options.baseUrl),
    author: entry.author.name,
    published: entry.published,
    html: entry.content,
    ...(entry.post === undefined
      ? {}
      : { post: { title: postLabel(entry.post, options.cited), permalink: entry.post.permalink } }),
    ...(entry.replyingTo === undefined || entry.replyingTo === null
      ? {}
      : { replyingTo: entry.replyingTo }),
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
    const entry: WithheldReply = { id, withheld: true, replies: [] };
    list.push(entry);
    withheld.set(id, entry);
    return entry;
  };

  for (const reply of shown.values()) {
    siblings(targets.get(reply.id), reply.id, reply.source !== 'activitypub')?.push(reply);
  }

  return top;
}

/** The entry of a thread with this id that a reader can see, at any depth. */
export function visibleReply(replies: readonly ThreadReply[], id: string): Interaction | undefined {
  for (const reply of replies) {
    if (!isWithheld(reply) && reply.id === id) return reply;
    const found = visibleReply(reply.replies, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function isWithheld(reply: ThreadReply): reply is WithheldReply {
  return 'withheld' in reply;
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
    };
    known.set(actorId, author);
    return author;
  };
}
