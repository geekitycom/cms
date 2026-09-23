import { createHash } from 'node:crypto';

import matter from 'gray-matter';

import { KNOWN_FRONT_MATTER_KEYS } from './document.ts';
import type { ActivityPubMetadata, Document, DocumentContent, DocumentType } from './document.ts';
import { renderMarkdown } from './markdown.ts';
import { defaultPermalink, slugify } from './slug.ts';
import { normalizeBody, serializeDocument } from './writer.ts';

const KNOWN_KEYS = new Set<string>(KNOWN_FRONT_MATTER_KEYS);

/** Where the file came from, which is what tells a post from a page. */
export interface ParseDocumentOptions {
  /** Path relative to the content directory, e.g. `posts/2026-09-02-hello.md`. */
  path: string;
  /** Overrides the type the path implies. Needed for files under `_trash/`. */
  type?: DocumentType | undefined;
}

/**
 * Parse the text of a Markdown file into a {@link Document}.
 *
 * Front matter is read with gray-matter and the body rendered with
 * markdown-it. Dates become ISO 8601 strings whether the file quoted them or
 * left YAML to parse them, and every key the CMS does not model is kept.
 */
export function parseDocument(source: string, options: ParseDocumentOptions): Document {
  const path = normalizePath(options.path);
  const text = source.replace(/\r\n?/g, '\n');

  if (!/^---\n/.test(text)) {
    throw new TypeError(`${path} has no YAML front matter.`);
  }

  // The empty options object opts out of gray-matter's module-level cache, so
  // two documents parsed from identical text never share nested data objects.
  const parsed = matter(text, {});

  const data = parsed.data;
  const type = options.type ?? typeForPath(path);
  // A post without a title is a note; a page is standing content and is
  // always named.
  const title =
    type === 'page'
      ? requiredString(data['title'], 'title', path)
      : (asString(data['title']) ?? '');
  const date = asDate(data['date'], 'date', path);
  const body = normalizeBody(parsed.content);

  const permalink =
    asString(data['permalink']) ??
    defaultPermalink({
      type,
      slug: fallbackSlug(title, path),
      date,
    });

  const content: DocumentContent = {
    title,
    permalink,
    tags: asTerms(data['tags']),
    categories: asTerms(data['categories']),
    draft: data['draft'] === true,
    extra: extraOf(data),
    body,
    ...(date === undefined ? {} : { date }),
    ...optional('updated', asDate(data['updated'], 'updated', path)),
    ...optional('description', asString(data['description'])),
    ...optional('author', asString(data['author'])),
    ...optional('inReplyTo', asReplyTarget(data['in-reply-to'])),
    ...optional('activitypub', asActivityPub(data['activitypub'], path)),
  };

  return {
    ...content,
    type,
    path,
    slug: slugForPermalink(permalink) ?? fallbackSlug(title, path),
    html: renderMarkdown(body),
    hash: hashDocument(content),
  };
}

/** The SHA-256 a {@link Document} carries: a hash of its canonical file text. */
export function hashDocument(content: DocumentContent): string {
  return createHash('sha256').update(serializeDocument(content), 'utf8').digest('hex');
}

/**
 * Decide whether a path holds a post or a page. Only the directory matters, so
 * a file that moves between `posts/` and `pages/` changes type with it.
 */
export function typeForPath(path: string): DocumentType {
  for (const segment of path.split('/')) {
    if (segment === 'posts') return 'post';
    if (segment === 'pages') return 'page';
  }
  throw new TypeError(
    `Cannot tell the type of ${path}: it is under neither posts/ nor pages/. Pass an explicit type.`,
  );
}

/** Content paths are POSIX and relative, whatever the host filesystem says. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '');
}

/**
 * The slug a permalink implies: its last segment, without any file extension.
 * `/2026/09/hello-world/` is `hello-world`; `/feed.xml` is `feed`.
 */
function slugForPermalink(permalink: string): string | undefined {
  const segments = permalink.split('/').filter((segment) => segment !== '');
  const last = segments.at(-1);
  if (last === undefined) return undefined;

  const slug = last.replace(/\.[^.]+$/, '');
  return slug === '' ? undefined : slug;
}

/** The slug for a document whose permalink has not been decided yet. */
function fallbackSlug(title: string, path: string): string {
  const fromTitle = slugify(title);
  if (fromTitle !== '') return fromTitle;

  const basename = path.split('/').at(-1) ?? '';
  return slugify(basename.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''));
}

function extraOf(data: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (KNOWN_KEYS.has(key)) continue;
    extra[key] = value;
  }
  return extra;
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function requiredString(value: unknown, key: string, path: string): string {
  const text = asString(value);
  if (text === undefined) {
    throw new TypeError(`${path} needs a non-empty ${key} in its front matter.`);
  }
  return text;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value === '' ? undefined : value;
}

/**
 * YAML parses an unquoted timestamp into a Date and leaves a quoted one a
 * string. Either way a Document holds an ISO 8601 string, so the offset the
 * author wrote survives when there was one.
 */
function asDate(value: unknown, key: string, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`${path} has an unreadable ${key}.`);
    }
    return value.toISOString();
  }
  const text = asString(value);
  if (text === undefined) {
    throw new TypeError(`${path} has a ${key} that is neither a date nor a string.`);
  }
  return text;
}

/**
 * One taxonomy's terms: `tags` or `categories`.
 *
 * Eleventy accepts one tag as a bare string, so both keys do; the CMS always
 * keeps a list, and both taxonomies are read the same way so a category
 * behaves exactly as a tag does.
 */
function asTerms(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (!Array.isArray(value)) return [];
  return value.filter((term): term is string => typeof term === 'string' && term !== '');
}

/**
 * `in-reply-to` as text. mf2 allows a list, so a list of one is its one URL;
 * anything else that is not a string is kept as its string, which is not a
 * URL, so it is reported and refused rather than dropped from the file.
 */
function asReplyTarget(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value) && value.length === 1) return asReplyTarget(value[0]);
  return asString(typeof value === 'string' ? value : JSON.stringify(value));
}

function asActivityPub(value: unknown, path: string): ActivityPubMetadata | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} has an activitypub key that is not a mapping.`);
  }

  const block = value as Record<string, unknown>;
  const metadata: ActivityPubMetadata = {
    ...optional('id', asString(block['id'])),
    ...optional('published', asDate(block['published'], 'activitypub.published', path)),
    ...optional('type', asString(block['type'])),
  };

  return Object.keys(metadata).length === 0 ? undefined : metadata;
}
