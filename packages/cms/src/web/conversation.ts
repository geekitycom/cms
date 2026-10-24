import type { Document } from '../content/document.ts';
import { isListed, isServed } from '../content/served.ts';
import { isKey, commentPageHref, feedGuid, repliesKey } from '../content/guids.ts';
import { readAllQuoteAuthorizations } from '../federation/quotes.ts';
import { replyFrom } from '../store/inbox-replies.ts';
import { absoluteUrl } from '../util/url.ts';
import type {
  CommentThread,
  Conversation,
  ConversationReader,
  ConversationSite,
  HeldAt,
  Interaction,
  Placed,
  RepliesOf,
  SiteInteraction,
  Upstream,
} from '../comments/conversation.ts';
import {
  commentAnchor,
  commentKeyAt,
  heldComment,
  visibleReply,
} from '../comments/conversation.ts';
import { authorNaming, federatedInteraction, quotesOf } from './activity-folding.ts';
import type { ConversationContext, Reading } from './conversation-context.ts';
import { newestFirst } from './conversation-feed.ts';
import { documentAuthor, gather } from './conversation-gather.ts';
import type { Gathered } from './conversation-gather.ts';
import {
  commentedPost,
  documentNamed,
  PostsByObjectId,
  rootOf,
  threadRootOf,
} from './conversation-lookup.ts';
import {
  ancestorsOf,
  byPublished,
  conversational,
  countReplies,
  repliesFed,
  rsvpGroups,
  saidIn,
  sortThread,
  threadOf,
} from './conversation-threads.ts';

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
 * this module and the ones it reads through (activity folding, gathering,
 * threads, post lookup and the feed adapter) are the only place outside the
 * comment intake that reads either of them to show somebody a conversation.
 * That is the point of it: the thread
 * under the post, the post's own comments feed, `/comments/feed/` and the
 * `source:comments` count on a post feed used to merge the same two indexes in
 * two implementations, which is two chances to disagree about what a reader
 * may see. Now there is one {@link ConversationReader}, and the page and the
 * feed are the same reading.
 */

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

/**
 * One native comment's page: the comment, its replies threaded under it by
 * the rule the post's thread uses, and the chain from it up to the post.
 *
 * Its replies are the same list threaded from the comment rather than from
 * the post, so a reply the post's thread shows is shown here, and one it
 * leaves out is left out here.
 */
function commentThread(context: Reading, id: string): CommentThread | undefined {
  const post = commentedPost(context, id);
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
