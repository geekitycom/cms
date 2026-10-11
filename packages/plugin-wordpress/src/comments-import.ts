import { repliesKey, webmentionKey } from '@geekity/cms/plugin';
import type { PluginCommandContext, PluginComment } from '@geekity/cms/plugin';

import type {
  ImportedComment,
  ImporterOutput,
  ItemNote,
  WordPressImporter,
} from './content-import.ts';
import { wordPressMedia } from './media.ts';
import { placements } from './posts-import.ts';
import { convertBody } from './wordpress-html.ts';
import type { WordPressComment, WordPressExport, WordPressItem } from './wxr.ts';

export const commentsAndReactions: WordPressImporter = {
  postTypes: [],
  import: importComments,
};

type Kind = PluginComment['kind'];
type Source = PluginComment['source'];

const KINDS_BY_COMMENT_TYPE: Readonly<Record<string, Kind>> = {
  comment: 'reply',
  like: 'like',
  repost: 'repost',
  mention: 'mention',
  bookmark: 'mention',
  webmention: 'mention',
  pingback: 'mention',
  trackback: 'mention',
};

const LINKBACKS: ReadonlySet<string> = new Set(['pingback', 'trackback']);

const STATUSES: Readonly<Record<string, PluginComment['status']>> = {
  '1': 'approved',
  '0': 'pending',
};

const LEFT_OUT: Readonly<Record<string, string>> = {
  spam: 'spam on WordPress',
  trash: 'in the WordPress trash',
  'post-trashed': 'on a post in the WordPress trash',
};

function importComments(exported: WordPressExport, context: PluginCommandContext): ImporterOutput {
  const media = wordPressMedia(exported, context.options['origins']);
  const origin = new URL(context.site.baseUrl).origin;
  const markdownOf = (html: string) => media.rewrite(convertBody(html).markdown, origin);
  const permalinks = new Map<WordPressItem, string>();
  for (const placement of placements(exported)) {
    if ('permalink' in placement) permalinks.set(placement.item, placement.permalink);
  }

  // Who wrote it signed in: the WordPress user's login, when this site has a
  // user by that name, the rule a post's author is mapped by.
  const usernames = new Set(context.site.users().map((user) => user.username));
  const users = new Map(
    exported.authors
      .filter((author) => usernames.has(author.login))
      .map((author) => [author.id, author.login]),
  );

  const actors = remoteActors(exported);

  const comments: ImportedComment[] = [];
  const notes: ItemNote[] = [];
  for (const item of exported.items) {
    if (item.comments.length === 0) continue;
    const permalink = permalinks.get(item);
    if (permalink === undefined) {
      const where =
        item.type === 'post' || item.type === 'page'
          ? 'a post the import leaves out'
          : `a ${item.type}, which takes no comments here`;
      for (const comment of item.comments) {
        notes.push({ item, outcome: 'skipped', why: `${labelOf(comment)}: on ${where}` });
      }
      continue;
    }
    const mapped = mapComments(item, permalink, markdownOf, users, actors);
    notes.push(...mapped.notes);
    comments.push(...mapped.comments);
  }
  return { files: [], notes, comments };
}

function mapComments(
  item: WordPressItem,
  permalink: string,
  markdownOf: (html: string) => string,
  users: ReadonlyMap<number, string>,
  actors: ReadonlyMap<string, RemoteActor>,
): { comments: ImportedComment[]; notes: ItemNote[] } {
  const notes: ItemNote[] = [];
  const kept: {
    wordPress: WordPressComment;
    comment: PluginComment;
    formerId: string;
    label: string;
  }[] = [];

  for (const wordPress of [...item.comments].sort((a, b) => a.id - b.id)) {
    const type = wordPress.type === '' ? 'comment' : wordPress.type;
    const named = KINDS_BY_COMMENT_TYPE[type];
    const status = STATUSES[wordPress.approved];
    if (named === undefined || status === undefined) {
      const why =
        named === undefined
          ? `comment type "${type}", which this import does not know`
          : (LEFT_OUT[wordPress.approved] ?? `WordPress status "${wordPress.approved}"`);
      notes.push({ item, outcome: 'skipped', why: `${labelOf(wordPress)}: ${why}` });
      continue;
    }
    const source = sourceOf(wordPress, type);
    const kind = kindOf(source, named);
    const says = kind === 'reply' || kind === 'mention';
    const name = nameOf(wordPress);
    const url = urlOf(wordPress, type, source, kind);
    const origin = originOf(wordPress, source, url);
    const formerId = `${item.guid}#comment-${String(wordPress.id)}`;
    const user = users.get(wordPress.userId);
    const actor =
      source === 'activitypub'
        ? actors.get(metaOf(wordPress, '_activitypub_remote_actor_id'))
        : undefined;
    kept.push({
      wordPress,
      formerId,
      comment: {
        id: keyOf(source, origin, permalink, formerId),
        source,
        kind,
        status,
        author: {
          name,
          url: wordPress.authorUrl || null,
          email:
            source === 'comment' && wordPress.authorEmail !== '' ? wordPress.authorEmail : null,
          avatar: metaOf(wordPress, 'avatar') || (actor?.avatar ?? null),
        },
        markdown: says ? markdownOf(wordPress.content) : '',
        submitted: instantOf(wordPress.dateGmt ?? item.dateGmt),
        inReplyTo: null,
        url,
        migrated: true,
        ...(origin === undefined ? {} : { origin }),
        ...(user === undefined ? {} : { user }),
        ...(actor === undefined ? {} : { actor: actor.id }),
      },
      label: `${labelOf(wordPress)}, a ${kind} by ${name}`,
    });
  }

  const replies = new Map(
    kept
      .filter(({ comment }) => comment.kind === 'reply')
      .map(({ wordPress, comment }) => [wordPress.id, comment.id]),
  );
  const comments = kept.map(({ wordPress, comment, formerId, label }) => {
    const imported = { item, permalink, formerId, label };
    const { parent } = wordPress;
    if (parent === 0) return { ...imported, comment };
    const inReplyTo = replies.get(parent);
    if (inReplyTo !== undefined) return { ...imported, comment: { ...comment, inReplyTo } };
    notes.push({
      item,
      outcome: 'warned',
      why: `${labelOf(wordPress)}: answers comment ${String(parent)}, which is not an imported reply; shown under the post`,
    });
    return { ...imported, comment };
  });
  return { comments, notes };
}

/** A fediverse actor as the ActivityPub plugin cached it: an `ap_actor` item, its content the actor's JSON. */
interface RemoteActor {
  readonly id: string;
  readonly avatar: string | null;
}

/** Each `ap_actor` item whose content is an actor, by its post id, which `_activitypub_remote_actor_id` names. */
function remoteActors(exported: WordPressExport): ReadonlyMap<string, RemoteActor> {
  const actors = new Map<string, RemoteActor>();
  for (const item of exported.items) {
    if (item.type !== 'ap_actor') continue;
    const actor = actorJson(item.content);
    if (actor === undefined || typeof actor['id'] !== 'string') continue;
    actors.set(String(item.id), { id: actor['id'], avatar: iconUrl(actor['icon']) });
  }
  return actors;
}

function actorJson(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** An actor's `icon`: an Image's `url`, a Link's `href`, or the first of several that has one. */
function iconUrl(icon: unknown): string | null {
  if (typeof icon === 'string') return icon === '' ? null : icon;
  if (Array.isArray(icon)) {
    for (const each of icon as unknown[]) {
      const url = iconUrl(each);
      if (url !== null) return url;
    }
    return null;
  }
  if (!isObject(icon)) return null;
  return iconUrl(icon['url']) ?? iconUrl(icon['href']);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function kindOf(source: Source, named: Kind): Kind {
  return source === 'activitypub' && named === 'repost' ? 'boost' : named;
}

function sourceOf(comment: WordPressComment, type: string): Source {
  const protocol = metaOf(comment, 'protocol');
  if (protocol === 'activitypub') return 'activitypub';
  if (protocol === 'webmention' || LINKBACKS.has(type)) return 'webmention';
  return type === 'comment' ? 'comment' : 'webmention';
}

function urlOf(comment: WordPressComment, type: string, source: Source, kind: Kind): string | null {
  switch (source) {
    case 'comment':
      return null;
    case 'activitypub':
      return kind === 'reply'
        ? metaOf(comment, 'source_url') || metaOf(comment, 'source_id') || null
        : null;
    case 'webmention':
      return (
        metaOf(comment, 'webmention_source_url') ||
        (LINKBACKS.has(type) ? comment.authorUrl : metaOf(comment, 'source_url')) ||
        null
      );
  }
}

/**
 * Its name where it was first published: the note a fediverse reply is, or
 * the activity a like or boost is; the page a webmention was sent from. A
 * form comment has none.
 */
function originOf(
  comment: WordPressComment,
  source: Source,
  url: string | null,
): string | undefined {
  switch (source) {
    case 'comment':
      return undefined;
    case 'activitypub':
      return metaOf(comment, 'source_id') || undefined;
    case 'webmention':
      return url ?? (metaOf(comment, 'source_id') || undefined);
  }
}

/**
 * The key the site would give the same comment arriving here itself
 * (decision-51), so a resend or a redelivery is the comment it already holds.
 * A form comment, which arrived nowhere else, has the key of its WordPress
 * URL.
 */
function keyOf(
  source: Source,
  origin: string | undefined,
  permalink: string,
  formerId: string,
): string {
  if (origin === undefined) return repliesKey(formerId);
  return source === 'webmention'
    ? (webmentionKey(origin, permalink) ?? repliesKey(formerId))
    : repliesKey(origin);
}

function nameOf(comment: WordPressComment): string {
  const name = comment.author.trim();
  if (name !== '') return name;
  return URL.canParse(comment.authorUrl) ? new URL(comment.authorUrl).hostname : 'Anonymous';
}

function labelOf(comment: WordPressComment): string {
  return `comment ${String(comment.id)}`;
}

function metaOf(comment: WordPressComment, key: string): string {
  return comment.meta.find((meta) => meta.key === key)?.value.trim() ?? '';
}

function instantOf(date: string | undefined): string {
  return date === undefined ? '' : new Date(date).toISOString();
}
