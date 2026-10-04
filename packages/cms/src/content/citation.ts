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

export const PREVIEW_FRONT_MATTER_KEY = 'preview';

export function previewShown(extra: Readonly<Record<string, unknown>>): boolean {
  return extra[PREVIEW_FRONT_MATTER_KEY] !== false;
}

export const CITED_ALT_FRONT_MATTER_KEY = 'cited-alt';

export function citedImageAlt(document: Pick<Document, 'extra' | 'title'>): string {
  const alt = document.extra[CITED_ALT_FRONT_MATTER_KEY];
  return (typeof alt === 'string' ? alt.trim() : '') || document.title.trim();
}

export function citedHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** What is stored about a cited page, as far as naming it goes (TASK-244). */
export interface CitedPage {
  readonly name?: string;
  readonly author?: { readonly name: string };
  readonly picture?: { readonly kind: string };
}

/** Reads the stored context of a cited page by its URL, never fetching. */
export type CitedPageReader = (url: string) => CitedPage | undefined;

/** A URL that is itself an image: a photo stored for it, and no title or author (TASK-255). */
export function citesAnImage(context: CitedPage): boolean {
  return (
    context.picture?.kind === 'photo' && context.name === undefined && context.author === undefined
  );
}

/**
 * The words a citation says for the page it cites: its title, else "a post"
 * when only its author is known, else "an image from" or "a page on" its host,
 * never the bare URL.
 */
export function citedPageName(url: string, context: CitedPage | undefined): string {
  if (context?.name !== undefined) return context.name;
  if (context?.author !== undefined) return 'a post';
  const image = context !== undefined && citesAnImage(context);
  return `${image ? 'an image from' : 'a page on'} ${citedHost(url)}`;
}

/** What a post does to the page under each citing property. */
export const CITATION_VERBS: Readonly<Record<CitationProperty, string>> = {
  'repost-of': 'Reposted',
  'like-of': 'Liked',
  'bookmark-of': 'Bookmarked',
};

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
