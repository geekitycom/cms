import type { DocumentType } from './document.ts';
import { POST_FIELDS } from './post-fields.ts';
import type { PostField } from './post-fields.ts';

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
   * Whether the editor offers the `eleventyExcludeFromCollections` flag. The
   * content format mirrors it for pages that should not list; a post is in the
   * archive by definition and has no use for it.
   */
  excludable: boolean;
  /**
   * Whether the editor offers the contact form. Pages only: a form
   * for writing to the site belongs on a standing page rather than under one
   * post out of a thousand.
   *
   * The front matter key itself is honoured wherever it is written, so a theme
   * that includes the partial in its post layout is free to; this only decides
   * where the checkbox is offered.
   */
  contactable: boolean;
  /**
   * Whether a document of this kind can reply to another, the mf2
   * `in-reply-to`, and so has a post type to name it by.
   */
  replies: boolean;
  /**
   * Whether the editor records where it was written, which is kept beside it
   * in `data/locations.json` rather than in its file.
   */
  located: boolean;
  /**
   * Whether it is a fediverse object whose id is its permalink,
   * so a moved one keeps its old URL as its id rather than as its feed guid.
   */
  federated: boolean;
  /** The front matter fields its editor and Micropub read and write, in write order. */
  fields: readonly PostField[];
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
  replies: true,
  located: true,
  federated: true,
  fields: POST_FIELDS,
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
  replies: false,
  located: false,
  federated: false,
  fields: [],
};

export const WIKI_KIND: DocumentKind = {
  type: 'wiki',
  singular: 'wiki page',
  dated: false,
  tagged: false,
  categorised: false,
  excludable: false,
  contactable: false,
  replies: false,
  located: false,
  federated: false,
  fields: [],
};

export const DOCUMENT_KINDS: Readonly<Record<DocumentType, DocumentKind>> = {
  post: POST_KIND,
  page: PAGE_KIND,
  wiki: WIKI_KIND,
};
