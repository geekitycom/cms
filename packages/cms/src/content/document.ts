/** Posts are dated and syndicated; pages are standing content. */
export type DocumentType = 'post' | 'page';

/**
 * The ActivityStreams identity of a document, written back once the post has
 * been federated so later Update and Delete activities name the same object.
 * Eleventy ignores the whole block.
 */
export interface ActivityPubMetadata {
  /** The ActivityStreams object id. */
  id?: string | undefined;
  /** When the object was first delivered, ISO 8601. */
  published?: string | undefined;
}

/**
 * One Markdown file, parsed.
 *
 * The file on disk is the source of truth; a Document is what the rest of the
 * CMS reads. Every front-matter key the CMS does not model survives in
 * {@link Document.extra}, so hand-added data is not lost by an admin save.
 *
 * Optional fields are absent rather than `undefined`, so two Documents parsed
 * from equivalent files compare equal.
 */
export interface Document {
  /** Whether the file lives under `posts/` or `pages/`. */
  type: DocumentType;
  /** Path relative to the content directory, with `/` separators. */
  path: string;
  /** Last segment of the permalink; the handle the admin UI edits. */
  slug: string;
  /** Output URL, always explicit so Eleventy and the CMS agree. Ends in `/`. */
  permalink: string;
  /** Display title. */
  title: string;
  /** Publish date, ISO 8601 with offset. Required for posts. */
  date?: string | undefined;
  /** Last modified date, ISO 8601. Written on every admin save. */
  updated?: string | undefined;
  /** Taxonomy. The `post` tag comes from `posts.json`, not from the file. */
  tags: string[];
  /**
   * The second taxonomy: what the document is filed under, as WordPress files
   * a post under a category. Eleventy reads it as an ordinary data key.
   */
  categories: string[];
  /** `true` hides the document from the public site and the feeds. */
  draft: boolean;
  /** Meta description and excerpt fallback. */
  description?: string | undefined;
  /** User login, resolved to a display name at render time. */
  author?: string | undefined;
  /** Federation identity, present once the document has been delivered. */
  activitypub?: ActivityPubMetadata | undefined;
  /** Front-matter keys the CMS does not model, preserved verbatim. */
  extra: Record<string, unknown>;
  /** Markdown body, without the front matter, trimmed. */
  body: string;
  /** {@link Document.body} rendered to HTML. */
  html: string;
  /**
   * SHA-256 of the document's canonical file text (what
   * `serializeDocument` would write). Two files that differ only in
   * formatting hash the same, so a rewrite that changes nothing is a no-op.
   */
  hash: string;
}

/** The part of a {@link Document} that a file is written from. */
export type DocumentContent = Pick<
  Document,
  | 'title'
  | 'date'
  | 'updated'
  | 'permalink'
  | 'tags'
  | 'categories'
  | 'draft'
  | 'description'
  | 'author'
  | 'activitypub'
  | 'extra'
  | 'body'
>;

/** Front-matter keys the CMS models. Everything else lands in `extra`. */
export const KNOWN_FRONT_MATTER_KEYS = [
  'title',
  'date',
  'updated',
  'permalink',
  'tags',
  'categories',
  'draft',
  'description',
  'author',
  'activitypub',
] as const;
