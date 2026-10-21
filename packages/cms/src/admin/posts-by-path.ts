import type { CitedPageReader } from '../content/citation.ts';
import { publicDocumentAt } from '../content/permalinks.ts';
import { postLabel } from '../content/post-type.ts';
import { dateSortKey } from '../content/store.ts';
import type { CatalogReader, DocumentLookup, IndexClock } from '../content/store.ts';
import type { PostAtPath, PublishedPost } from '../plugin.ts';
import { withoutTrailingSlash } from '../util/url.ts';
import { documentEditorPath, POST_SCREENS } from './documents.ts';

export interface PostsByPathSources {
  readonly store: DocumentLookup & IndexClock & Pick<CatalogReader, 'listPostsPublishedSince'>;
  readonly baseUrl: string;
  readonly cited: CitedPageReader;
}

export function postsByPath(sources: PostsByPathSources, paths: readonly string[]): PostAtPath[] {
  const directory = withoutTrailingSlash(new URL(sources.baseUrl).pathname);
  const found: PostAtPath[] = [];
  for (const asked of paths) {
    const permalink = permalinkOf(asked, directory);
    if (permalink === undefined) continue;
    const document =
      publicDocumentAt(sources.store, permalink) ??
      (permalink.endsWith('/') ? undefined : publicDocumentAt(sources.store, `${permalink}/`));
    if (document?.type !== 'post') continue;
    found.push({
      path: asked,
      permalink: document.permalink,
      title: postLabel(document, sources.cited),
      editUrl: documentEditorPath(POST_SCREENS, document),
    });
  }
  return found;
}

function permalinkOf(asked: string, directory: string): string | undefined {
  const pathname = asked.replace(/[?#].*$/s, '');
  if (!pathname.startsWith('/')) return undefined;
  if (directory !== '' && pathname !== directory && !pathname.startsWith(`${directory}/`)) {
    return undefined;
  }
  const relative = pathname.slice(directory.length) || '/';
  try {
    return decodeURIComponent(relative);
  } catch {
    return relative;
  }
}

export function postsPublishedSince(sources: PostsByPathSources, since: string): PublishedPost[] {
  return sources.store
    .listPostsPublishedSince(since)
    .toReversed()
    .flatMap((document) => {
      const published = dateSortKey(document.date);
      return published === null
        ? []
        : [
            {
              permalink: document.permalink,
              title: postLabel(document, sources.cited),
              editUrl: documentEditorPath(POST_SCREENS, document),
              published,
            },
          ];
    });
}
