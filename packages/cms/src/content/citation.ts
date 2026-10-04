/**
 * What a like, a repost or a bookmark cites (TASK-169): the URL under the mf2
 * property of the same name, one to a post.
 *
 * ```yaml
 * like-of: https://example.com/a-post/
 * ```
 *
 * Like `photo`, each stays in {@link Document.extra}: {@link citationsOf} is
 * the one reading of them, and the theme, the webmentions, the federation and
 * Post Type Discovery read only what it returns.
 */
import type { Document } from './document.ts';
import { isWebUrl } from './enclosure.ts';

/**
 * The front matter key a post hides the previews of what it cites with
 * (TASK-252): `preview: false`. Absent, a preview shows.
 */
export const PREVIEW_FRONT_MATTER_KEY = 'preview';

/** Whether a post shows the pictures of the pages it cites. */
export function previewShown(extra: Readonly<Record<string, unknown>>): boolean {
  return extra[PREVIEW_FRONT_MATTER_KEY] !== false;
}

/** The citing properties, each a front matter key, in Post Type Discovery's order. */
export const CITATION_PROPERTIES = ['repost-of', 'like-of', 'bookmark-of'] as const;

export type CitationProperty = (typeof CITATION_PROPERTIES)[number];

/** One page a post cites, and how. */
export interface Citation {
  readonly property: CitationProperty;
  /** An absolute `http` or `https` URL. */
  readonly url: string;
}

/**
 * The citations a post's front matter makes, in {@link CITATION_PROPERTIES}
 * order. A value that is no web address cites nothing, so it is left out; a
 * list of one, which mf2 allows, is its one URL.
 */
export function citationsOf(extra: Readonly<Record<string, unknown>>): Citation[] {
  return CITATION_PROPERTIES.flatMap((property) => {
    const url = citedUrl(extra[property]);
    return url === undefined ? [] : [{ property, url }];
  });
}

/** The URL a post cites under one property, or `undefined`. */
export function citationOf(
  document: Pick<Document, 'extra'>,
  property: CitationProperty,
): string | undefined {
  return citationsOf(document.extra).find((citation) => citation.property === property)?.url;
}

/**
 * A citing property as the file spells it, valid or not: the text, or the one
 * text of a list of one, which mf2 allows. Empty for anything else.
 */
export function citationText(value: unknown): string {
  const first: unknown = Array.isArray(value) && value.length === 1 ? value[0] : value;
  return typeof first === 'string' ? first : '';
}

function citedUrl(value: unknown): string | undefined {
  const url = citationText(value).trim();
  return isWebUrl(url) ? url : undefined;
}
