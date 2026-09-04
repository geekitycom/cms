import type { Document } from '../content/document.ts';
import { isScheduled } from '../content/schedule.ts';
import { isTrashedPath } from '../content/store.ts';
import type { ContentStore } from '../content/store.ts';
import { postObjectId } from '../federation/paths.ts';

/**
 * Whether the public site may show a document.
 *
 * Three things hide one: `draft: true` in the front matter, living under
 * `_trash/`, and a date that has not arrived yet. All three stay indexed so
 * the admin can find them; none is ever served, listed, or fed.
 *
 * This is the predicate the index answers in SQL, so anything that has to
 * decide about a single document in hand — a permalink, a View link, the
 * sitemap — asks it here rather than deriving the rule again. The clock
 * defaults to the system one; a caller with a store should pass
 * {@link ContentStore.now} so the answer matches the listings it came from.
 */
export function isPublicDocument(document: Document, now: Date = new Date()): boolean {
  return !document.draft && !isTrashedPath(document.path) && !isScheduled(document, now);
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
  if (document === undefined || !isPublicDocument(document, store.now())) return undefined;
  return document;
}

/**
 * The ActivityStreams id of a document, or `undefined` when it has none.
 *
 * Only a published post federates (doc-4), so only a published post has an id
 * to advertise. This is what the theme's `<link rel="alternate">` points at
 * and what the RSS feed's `<guid isPermaLink="false">` names, and it is
 * deliberately the same string the object dispatcher answers under: the page,
 * the feed item and the object all agree about the post's name in the
 * fediverse.
 *
 * The id written into the front matter on the first delivery wins over the one
 * the slug implies, exactly as federation's `articleObjectId` prefers it: that
 * is what makes the name survive a rename, which is the whole reason a `guid`
 * is not the permalink. A hand-written `activitypub.id` that is not a URL is
 * not an id, and the derived one is used instead.
 */
export function activityStreamsId(document: Document, baseUrl: string): string | undefined {
  if (document.type !== 'post' || !isPublicDocument(document)) return undefined;

  const stored = document.activitypub?.id;
  if (stored !== undefined && stored !== '') {
    try {
      return new URL(stored).href;
    } catch {
      // Not a URL, so not an id. Fall through to the derived one.
    }
  }
  return postObjectId(document.slug, baseUrl);
}
