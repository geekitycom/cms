import type { CitedPageReader } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { postLabel } from '../content/post-type.ts';
import type { CatalogReader, DocumentLookup, IndexClock } from '../content/store.ts';
import type { ObjectIdRecord } from '../federation/object-ids.ts';
import type { PostEngagement } from '../plugin.ts';
import type { AdminStore } from '../store/admin-store.ts';
import { documentEditorPath, POST_SCREENS } from './documents.ts';
import { localPosts } from './federation.ts';

type Kind = 'likes' | 'boosts' | 'replies' | 'webmentions' | 'comments';

const INBOX_KINDS = { like: 'likes', boost: 'boosts', reply: 'replies' } as const;

/** What {@link postEngagement} reads. */
export interface EngagementSources {
  readonly store: DocumentLookup & CatalogReader & IndexClock;
  readonly admin: Pick<AdminStore, 'countInteractionsSince' | 'countApprovedCommentsSince'>;
  readonly baseUrl: string;
  readonly objectIds: ObjectIdRecord;
  readonly cited: CitedPageReader;
  /** The post whose thread holds a note, for a reply to a reply. */
  readonly threadOf: (url: string) => Document | undefined;
}

/**
 * Each post's likes, boosts and fediverse replies from the inbox, and its
 * approved webmentions and comments, from an instant on, most first. Counted
 * as the dashboard's other cards count: an undone like or boost and a deleted
 * reply are left out, and so are the fediverse comments imported from before
 * the site ran Geekity, which the inbox would otherwise count twice.
 */
export function postEngagement(sources: EngagementSources, since: string): PostEngagement[] {
  const { store, admin, cited } = sources;
  const posts = new Map<string, PostEngagement>();

  const add = (document: Document, kind: Kind, count: number): void => {
    const known = posts.get(document.slug) ?? {
      slug: document.slug,
      title: postLabel(document, cited),
      path: document.permalink,
      editUrl: documentEditorPath(POST_SCREENS, document),
      likes: 0,
      boosts: 0,
      replies: 0,
      webmentions: 0,
      comments: 0,
      total: 0,
    };
    posts.set(document.slug, { ...known, [kind]: known[kind] + count, total: known.total + count });
  };

  const post = localPosts(store, sources.baseUrl, sources.objectIds, cited, sources.threadOf);
  for (const { kind, about, count } of admin.countInteractionsSince(since)) {
    const found = post(about);
    const document = found === null ? undefined : store.getBySlug(found.slug);
    if (document !== undefined) add(document, INBOX_KINDS[kind], count);
  }
  for (const { slug, source, count } of admin.countApprovedCommentsSince(since)) {
    const document = store.getBySlug(slug);
    if (document?.type !== 'post') continue;
    add(document, source === 'webmention' ? 'webmentions' : 'comments', count);
  }

  return [...posts.values()].toSorted(
    (a, b) => b.total - a.total || a.title.localeCompare(b.title),
  );
}
