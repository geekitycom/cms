import type { Document } from '../content/document.ts';
import { isTrashedPath } from '../content/store.ts';
import type { ContentStore } from '../content/store.ts';

/**
 * Whether the public site may show a document.
 *
 * Two things hide one: `draft: true` in the front matter, and living under
 * `_trash/`. Both stay indexed so the admin can find them; neither is ever
 * served, listed, or fed.
 */
export function isPublicDocument(document: Document): boolean {
  return !document.draft && !isTrashedPath(document.path);
}

/**
 * The document a public URL resolves to, or `undefined`.
 *
 * This is the single lookup the public site does: every representation of a
 * document — the theme's HTML, the Markdown file, the JSON object — is the
 * same document found the same way, so they cannot disagree about what exists.
 */
export function publicDocumentAt(store: ContentStore, permalink: string): Document | undefined {
  const document = store.getByPermalink(permalink);
  if (document === undefined || !isPublicDocument(document)) return undefined;
  return document;
}
