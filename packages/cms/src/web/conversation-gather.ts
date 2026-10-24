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

export interface Gathered extends Readonly<Record<Group, Interaction[]>> {
  readonly root: string;
  readonly withdrawn: ReadonlySet<string>;
  readonly held: ReadonlyMap<string, Interaction>;
}

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

function answersApart(part: Part): Part {
  return {
    ...part,
    said: part.said.map(([group, entry]) =>
      entry.rsvp === undefined ? ([group, entry] as const) : (['answers', entry] as const),
    ),
  };
}

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

export function documentAuthor(context: Reading, post: Document): InteractionAuthor {
  const users = context.users();
  const { site } = context;
  const author = authorContext(users, post.author) ?? siteAuthorContext(users, site.author);
  return bylineAuthor(author, site.title);
}

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

function interactionOf(
  comment: PostComment,
  permalink: string,
  baseUrl: string,
  users: readonly User[],
): Interaction {
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
