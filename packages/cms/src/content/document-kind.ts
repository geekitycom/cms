import type { DocumentType } from './document.ts';

/**
 * What a kind of document is allowed to carry, which the write path and the
 * form conversion read instead of asking whether it is a post.
 */
export interface DocumentKind {
  type: DocumentType;
  /** How one of them is named in a sentence, e.g. `post`. */
  singular: string;
  /** Whether a document of this kind has a publish date. */
  dated: boolean;
  /** Whether a document of this kind carries tags. */
  tagged: boolean;
  /** Whether a document of this kind is filed under categories. */
  categorised: boolean;
  /**
   * Whether the editor offers the `eleventyExcludeFromCollections` flag. doc-2
   * mirrors it for pages that should not list; a post is in the archive by
   * definition and has no use for it.
   */
  excludable: boolean;
  /**
   * Whether the editor offers the contact form (TASK-56). Pages only: a form
   * for writing to the site belongs on a standing page rather than under one
   * post out of a thousand.
   *
   * The front matter key itself is honoured wherever it is written, so a theme
   * that includes the partial in its post layout is free to; this only decides
   * where the checkbox is offered.
   */
  contactable: boolean;
}

/** Posts: dated, tagged, categorised, filed under `posts/`. */
export const POST_KIND: DocumentKind = {
  type: 'post',
  singular: 'post',
  dated: true,
  tagged: true,
  categorised: true,
  excludable: false,
  contactable: false,
};

/** Pages: standing content, no date prefix and no taxonomy. */
export const PAGE_KIND: DocumentKind = {
  type: 'page',
  singular: 'page',
  dated: false,
  tagged: false,
  categorised: false,
  excludable: true,
  contactable: true,
};
