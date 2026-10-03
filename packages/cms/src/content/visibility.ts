import type { Document } from './document.ts';

/**
 * The front matter key that keeps a document off the site's lists (TASK-227):
 * `visibility: unlisted`. Absent means public.
 */
export const VISIBILITY_FRONT_MATTER_KEY = 'visibility';

/**
 * Who a served document is shown to without being asked for by URL.
 *
 * A public document is listed everywhere the site lists things. An unlisted
 * one keeps its page and federates, but is left out of every listing, feed,
 * sitemap, search and index, and asks search engines not to index it.
 */
export type Visibility = 'public' | 'unlisted';

/** Every {@link Visibility}, in the order a form offers them. */
export const VISIBILITIES: readonly Visibility[] = ['public', 'unlisted'];

/**
 * A `visibility` the front matter holds that is no {@link Visibility}, such as
 * a hand-typed `private`, spelled as text. Its author meant the document not
 * to be public, and the site cannot tell how far, so it is not served at all.
 */
export interface UnrecognizedVisibility {
  readonly unrecognized: string;
}

/** What a document's `visibility` key holds, as the site reads it. */
export type StoredVisibility = Visibility | UnrecognizedVisibility;

export function isVisibility(value: unknown): value is Visibility {
  return VISIBILITIES.includes(value as Visibility);
}

/**
 * A document's visibility. An absent or empty key is public. The index's
 * served and listed clauses read the key the same way.
 */
export function visibilityOf(document: Pick<Document, 'extra'>): StoredVisibility {
  const value = document.extra[VISIBILITY_FRONT_MATTER_KEY];
  if (value === undefined || value === null) return 'public';
  if (isVisibility(value)) return value;
  return { unrecognized: typeof value === 'string' ? value : JSON.stringify(value) };
}

/** The value as the file spells it, which is what a form or `q=source` shows. */
export function visibilityText(visibility: StoredVisibility): string {
  return typeof visibility === 'string' ? visibility : visibility.unrecognized;
}
