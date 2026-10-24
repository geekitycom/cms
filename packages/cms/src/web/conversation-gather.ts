import { avatarHref } from '../avatars/avatars.ts';
import { commentAnchor, commentNames } from '../comments/conversation.ts';
import type { Interaction, InteractionAuthor } from '../comments/conversation.ts';
import type { Document } from '../content/document.ts';
import { commentPageHref } from '../content/guids.ts';
import { activityStreamsId } from '../content/permalinks.ts';
import { postTypeOf } from '../content/post-type.ts';
import { RSVP_LABELS } from '../content/rsvp.ts';
import { objectIdsOf, readObjectIds } from '../federation/object-ids.ts';
import { authorContext, profileContext, siteAuthorContext } from '../site/authors.ts';
import type { AuthorContext } from '../site/authors.ts';
import type { User } from '../site/users.ts';
import type { PostComment } from '../store/admin-store.ts';
import { actorHandle } from '../store/inbox-replies.ts';
import { absoluteUrl } from '../util/url.ts';
import {
  authorNaming,
  fromActivities,
  fromAnswers,
  fromQuotes,
  GROUP_OF,
  heardAbout,
  unstored,
} from './activity-folding.ts';
import type { Group, Part } from './activity-folding.ts';
import type { Reading } from './conversation-context.ts';
import { rootOf } from './conversation-lookup.ts';
import { byPublished } from './conversation-threads.ts';
import { authorFeedHref } from './feed-source.ts';

/** Everything said about one post, sorted into its groups and not yet threaded. */
export interface Gathered extends Readonly<Record<Group, Interaction[]>> {
  /** What a top-level answer names. */
  readonly root: string;
  /** The ids of what an actor has taken back. */
  readonly withdrawn: ReadonlySet<string>;
  /** The native comments a reader may not see, pending or spam, by id. */
  readonly held: ReadonlyMap<string, Interaction>;
}

/**
 * Everything said about one post from every source the site has: the
 * fediverse, the stored comments, and the reply posts answering it with what
 * was said under each of them.
 *
 * A post that has never been delivered has no ActivityStreams id and so can
 * have no fediverse replies — nothing out there has a name for it yet — but it
 * can still have native comments, which hang off its permalink instead. Only
 * an event takes RSVPs, so only an event's are folded apart into answers.
 */
export function gather(
  context: Reading,
  document: Document,
  seen: ReadonlySet<string> = new Set([document.path]),
): Gathered {
  const deliveredObjectId = activityStreamsId(document, context.baseUrl, context.store.now());
  const root = rootOf(context, document);
  const stored = context.admin.listCommentsFor(document.slug);
  const naming = authorNaming(context.admin);
  const isEvent = postTypeOf(document) === 'event';

  const fediverse: Part[] = [];
  if (deliveredObjectId !== undefined) {
    const objectIds = objectIdsOf(readObjectIds(context.contentDir), deliveredObjectId);
    const heard = heardAbout(context, root, objectIds, stored);
    fediverse.push(fromQuotes(context, objectIds, naming));
    fediverse.push(fromActivities(context, heard, stored, naming));
    if (isEvent) fediverse.push(fromAnswers(heard, naming));
  }
  const native = fromStored(context, document, stored);
  const comments = isEvent ? answersApart(native) : native;
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

function fromStored(context: Reading, document: Document, stored: readonly PostComment[]): Part {
  const users = context.users();
  const said: [Group, Interaction][] = [];
  const held = new Map<string, Interaction>();
  for (const record of stored) {
    const comment = interactionOf(record, document.permalink, context.baseUrl, users);
    if (record.status !== 'approved') {
      held.set(comment.id, comment);
      continue;
    }
    said.push([GROUP_OF[comment.kind], { ...comment, replies: [] }]);
  }
  return { said, held };
}

/** An event's stored comments, with those carrying an RSVP moved to its answers. */
function answersApart(part: Part): Part {
  return {
    ...part,
    said: part.said.map(([group, entry]) =>
      entry.rsvp === undefined ? ([group, entry] as const) : (['answers', entry] as const),
    ),
  };
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
 * Every URL a reply post's `in-reply-to` could name something here by, and the
 * id each one names: the post by its permalink, every URL it used to live at
 * and every object id it has had, and every entry by its id, its url and, for
 * a comment written here, its page and its anchor.
 */
function namesIn(
  context: Reading,
  document: Document,
  root: string,
  replies: readonly Interaction[],
): Map<string, string> {
  const permalink = absoluteUrl(document.permalink, context.baseUrl);
  const former = (document.redirectFrom ?? []).map((url) => absoluteUrl(url, context.baseUrl));
  const objectIds = objectIdsOf(readObjectIds(context.contentDir), root);
  const names = new Map<string, string>(
    [permalink, ...former, ...objectIds].map((url) => [url, root]),
  );
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
export function documentAuthor(context: Reading, post: Document): InteractionAuthor {
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
