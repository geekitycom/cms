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
    const mapped = mapComments(item, markdownOf);
    notes.push(...mapped.notes);
    comments.push(...mapped.comments.map((comment) => ({ ...comment, permalink })));
  }
  return { files: [], notes, comments };
}

function mapComments(
  item: WordPressItem,
  markdownOf: (html: string) => string,
): { comments: Omit<ImportedComment, 'permalink'>[]; notes: ItemNote[] } {
  const idOf = (comment: number) => `${item.guid}#comment-${String(comment)}`;
  const notes: ItemNote[] = [];
  const kept: { wordPress: WordPressComment; comment: PluginComment; label: string }[] = [];

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
    kept.push({
      wordPress,
      comment: {
        id: idOf(wordPress.id),
        source,
        kind,
        status,
        author: {
          name,
          url: wordPress.authorUrl || null,
          email:
            source === 'comment' && wordPress.authorEmail !== '' ? wordPress.authorEmail : null,
          avatar: metaOf(wordPress, 'avatar') || null,
        },
        markdown: says ? markdownOf(wordPress.content) : '',
        submitted: instantOf(wordPress.dateGmt ?? item.dateGmt),
        inReplyTo: null,
        url: urlOf(wordPress, type, source, kind),
      },
      label: `${labelOf(wordPress)}, a ${kind} by ${name}`,
    });
  }

  const kinds = new Map(kept.map(({ wordPress, comment }) => [wordPress.id, comment.kind]));
  const comments = kept.map(({ wordPress, comment, label }) => {
    const { parent } = wordPress;
    if (parent === 0) return { item, comment, label };
    if (kinds.get(parent) === 'reply') {
      return { item, comment: { ...comment, inReplyTo: idOf(parent) }, label };
    }
    notes.push({
      item,
      outcome: 'warned',
      why: `${labelOf(wordPress)}: answers comment ${String(parent)}, which is not an imported reply; shown under the post`,
    });
    return { item, comment, label };
  });
  return { comments, notes };
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
