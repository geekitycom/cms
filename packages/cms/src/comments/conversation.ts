import type { Document } from '../content/document.ts';
import { COMMENT_PAGE_PREFIX, commentPageHref, isKey, repliesKey } from '../content/guids.ts';
import type { RsvpValue } from '../content/rsvp.ts';
import type { AdminStore, PostComment } from '../store/admin-store.ts';
import { absoluteUrl } from '../util/url.ts';

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
  /**
   * Where to follow what they publish, when the site knows (TASK-324): a
   * webmention author's h-card or site, or a site user's author feed. A
   * visitor's own website is only what they typed, and a fediverse actor
   * publishes no feed the site knows of, so both are `null`.
   */
  readonly feed: string | null;
  /**
   * The site user they are, by username, else `null`: whoever a reply post
   * is by, or whoever a stored comment names (TASK-337). A theme vouches for
   * the link of a site user and of nobody else.
   */
  readonly username: string | null;
}

/** One thing somebody did to a post: a reply, a like or a boost. */
export interface Interaction {
  /** What it is called: the note's id, and what a reply to it names. */
  readonly id: string;
  /**
   * Its key (decision-51): a stored comment's id, else the key of its guid.
   * The one thing in its anchor, `#comment-{key}`, and its replies feed,
   * `/replies/{key}/`.
   */
  readonly key: string;
  /**
   * What the comments feeds call it, and what a reply to it names in
   * `source:inReplyTo`: a stored form comment's page, a stored comment's
   * origin or else its url, and anything else's id.
   */
  readonly guid: string;
  /**
   * Whether it was imported from another system (TASK-336): shown in the
   * thread like any other, and carried by no feed and no reply count.
   */
  readonly migrated: boolean;
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
  /** The hidden comment's id. */
  readonly id: string;
  /** Its key, so its anchor on the post is still there. */
  readonly key: string;
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

/**
 * Something said in a conversation, with the reply it sits under (TASK-324):
 * what the comments feeds name as what it answers.
 */
export interface Placed extends Interaction {
  /**
   * The visible reply it answers, or `null` for the post. A hidden comment in
   * between is passed over, the way the thread already passes over a
   * withdrawn note, so a reader walking the feeds reaches every visible reply.
   */
  readonly parent: Interaction | null;
}

/** One interaction with the post it is about, which a site-wide list needs. */
export interface SiteInteraction extends Placed {
  /** The post it answers. */
  readonly post: Document;
  /**
   * Who wrote the reply it answers, when it answers one a reader can see
   * (TASK-318), and `null` for an answer to the post itself.
   */
  readonly replyingTo: string | null;
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
   * How many visible replies answer each of these documents directly, by
   * permalink: what a reader following `source:comments` finds in its
   * `/replies/` feed (TASK-324). Read off each thread, since that is the only
   * reading that knows which replies a reader sees and where they sit.
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
   * The reply on a post that a URL names, or `undefined` (TASK-319):
   * a comment by its own page or by the post's `#comment-` anchor, a
   * webmention by the page it was sent from, a fediverse reply by its url or
   * its id. Every stored comment counts whatever its status, because what a
   * reply answers is a fact about it, and whether a reader may see the one it
   * answers is decided when the thread is read.
   */
  readonly replyNamed: (document: Document, url: string) => Interaction | undefined;
  /**
   * What a URL names on this site, while a reader may see it: a reply (a
   * comment by its page or its anchor, a webmention by the page it was sent
   * from, a fediverse reply by its id or url, a reply post by its permalink)
   * with the post it is on, or a served post or page itself (TASK-300,
   * TASK-326). What a reply post answering it cites, instead of fetching a page.
   */
  readonly heldAt: (url: string) => HeldAt | undefined;
  /**
   * What a key names and its direct replies (TASK-324, decision-51), or
   * `undefined`: a served post or page, or a reply a reader can see.
   */
  readonly repliesTo: (key: string) => RepliesOf | undefined;
  /**
   * The document whose conversation a URL is in (TASK-320): the post a
   * comment's page or anchor is on, the post a webmention was sent to, the
   * post a fediverse reply answers however deep, or the document at the URL.
   */
  readonly documentOf: (url: string) => Document | undefined;
  /**
   * Every page in the conversation a document is in that answers something
   * off this site, with what a reader sees under it (TASK-320): what a
   * salmention is sent from. A reply post answers its `in-reply-to`; a
   * comment's own page answers the webmention reply it is under. One
   * answering something here has nobody to tell: this site already knows.
   */
  readonly upstreams: (document: Document) => Upstream[];
}

/** One page of this site's answering a page elsewhere (TASK-320). */
export interface Upstream {
  /** The document the page is, or that the comment is on. */
  readonly post: Document;
  /** The page, absolute: a reply post's permalink or a comment's own page. */
  readonly source: string;
  /** What it answers, off this site. */
  readonly target: string;
  /** The replies a reader sees under it, as its page prints them. */
  readonly replies: readonly ThreadReply[];
}

/** What one `/replies/` feed is about, and what is in it (TASK-324). */
export interface RepliesOf {
  /** The document whose conversation it is. */
  readonly post: Document;
  /** The reply whose replies these are, or `null` for the document's own. */
  readonly reply: Interaction | null;
  /** The visible replies directly under it, each carrying its own. */
  readonly replies: Placed[];
}

/** What {@link ConversationReader.heldAt} found: a reply and the post it is on, or a post. */
export type HeldAt =
  | { readonly kind: 'reply'; readonly post: Document; readonly reply: Interaction }
  | { readonly kind: 'document'; readonly post: Document; readonly author: InteractionAuthor };

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
 * The URLs a reply post can answer a native comment by: its own page, and its
 * anchor on the post at this absolute permalink.
 */
export function commentNames(id: string, permalink: string, baseUrl: string): string[] {
  return [absoluteUrl(commentPageHref(id), baseUrl), `${permalink}#${commentAnchor(id)}`];
}

/**
 * The stored comment holding a fediverse note or activity id as its origin:
 * one imported from the site this one replaced, keyed by that id as it would
 * have been had it arrived here (TASK-336). A delivery or a fetch of the same
 * id is that comment again, and the stored one wins, since it is the one the
 * moderator decided on and the thread anchors.
 */
export function heldComment(admin: AdminStore, id: string): PostComment | undefined {
  const comment = admin.getComment(repliesKey(id));
  return comment?.origin === id ? comment : undefined;
}

/**
 * The `id` a thread entry is anchored at on the page, by its key.
 *
 * Prefixed rather than bare so a comment can never collide with a heading
 * anchor the post's own Markdown produced.
 */
export function commentAnchor(key: string): string {
  return `comment-${key}`;
}

/** The key of the comment whose page a path is, or `undefined` (TASK-319). */
export function commentKeyAt(pathname: string): string | undefined {
  if (!pathname.startsWith(COMMENT_PAGE_PREFIX) || !pathname.endsWith('/')) return undefined;
  const key = pathname.slice(COMMENT_PAGE_PREFIX.length, -1);
  return isKey(key) ? key : undefined;
}

/** The entry of a thread with this key that a reader can see, at any depth. */
export function visibleReply(
  replies: readonly ThreadReply[],
  key: string,
): Interaction | undefined {
  for (const reply of replies) {
    if (!isWithheld(reply) && reply.key === key) return reply;
    const found = visibleReply(reply.replies, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function isWithheld(reply: ThreadReply): reply is WithheldReply {
  return 'withheld' in reply;
}
