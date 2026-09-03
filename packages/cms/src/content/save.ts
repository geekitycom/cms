import { randomBytes } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Document, DocumentContent, DocumentType } from './document.ts';
import { parseDocument } from './parser.ts';
import { defaultPermalink } from './slug.ts';
import type { ContentStore } from './store.ts';
import { serializeDocument } from './writer.ts';

/** What {@link contentFilePath} needs to name a file. */
export interface ContentFilePathInput {
  /** Posts get a dated filename; pages do not. */
  type: DocumentType;
  /** The slug, already URL-safe. It becomes the tail of the filename. */
  slug: string;
  /** Publish date, ISO 8601. Required for a post, ignored for a page. */
  date?: string | Date | undefined;
}

/**
 * Where a document's file goes, relative to the content directory.
 *
 * doc-2: a post filename carries its date so the directory sorts on disk, a
 * page filename does not. Neither is ever parsed for a URL — the front matter's
 * `permalink` is what decides that — so renaming a file changes nothing but
 * the sort order.
 */
export function contentFilePath(input: ContentFilePathInput): string {
  if (input.slug === '') {
    throw new TypeError('A content file needs a non-empty slug.');
  }

  if (input.type === 'page') return `pages/${input.slug}.md`;

  if (input.date === undefined) {
    throw new TypeError(`A post filename needs a date; "${input.slug}" has none.`);
  }

  return `posts/${calendarDay(input.date)}-${input.slug}.md`;
}

/** What {@link freeSlug} looks for a gap in. */
export interface FreeSlugOptions extends ContentFilePathInput {
  /** The content directory the file would go in. */
  contentDir: string;
  /** The index, consulted so a permalink another file claims is skipped too. */
  store: ContentStore;
}

/**
 * The given slug, or the first numbered variant of it that neither the content
 * directory nor the index has already claimed.
 *
 * Both are checked because they can disagree for a moment: a file the watcher
 * has not picked up yet is on disk and not in the index, and a file that was
 * deleted outside the CMS is the other way round. Overwriting either would
 * lose someone's writing.
 */
export async function freeSlug(options: FreeSlugOptions): Promise<string> {
  const { contentDir, store, ...input } = options;

  for (let suffix = 1; ; suffix += 1) {
    const slug = suffix === 1 ? input.slug : `${input.slug}-${String(suffix)}`;
    const relative = contentFilePath({ ...input, slug });
    const permalink = defaultPermalink({ type: input.type, slug, date: input.date });

    if (store.getByPath(relative) !== undefined) continue;
    if (store.getByPermalink(permalink) !== undefined) continue;
    if (await exists(path.join(contentDir, ...relative.split('/')))) continue;

    return slug;
  }
}

/** What {@link saveDocument} writes, and where. */
export interface SaveDocumentOptions {
  /** The content directory. Missing parent directories are created. */
  contentDir: string;
  /** The index to bring up to date once the bytes have landed. */
  store: ContentStore;
  /** The file's path relative to {@link SaveDocumentOptions.contentDir}. */
  path: string;
  /** The document to serialize. */
  content: DocumentContent;
}

/**
 * The admin's write path, per doc-1: serialize, write the file atomically, then
 * update the index directly rather than waiting for the watcher.
 *
 * The temporary file is written in the same directory as its destination so the
 * rename is a rename and not a copy across devices, and a reader either sees
 * the old file or the whole new one, never a half-written one. The watcher
 * event that follows the rename is a no-op, because the hash already matches
 * what this put in the index.
 */
export async function saveDocument(options: SaveDocumentOptions): Promise<Document> {
  const relative = options.path.replace(/\\/g, '/');
  const file = path.join(options.contentDir, ...relative.split('/'));
  const source = serializeDocument(options.content);

  // Parsed before it is written, so a document that cannot be read back is
  // refused rather than left on disk for the watcher to complain about.
  const document = parseDocument(source, { path: relative });

  await mkdir(path.dirname(file), { recursive: true });

  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, source, 'utf8');
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }

  options.store.upsert(document);
  return document;
}

/** The calendar day of a date as written, without shifting it into another one. */
function calendarDay(date: string | Date): string {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) {
      throw new TypeError('A post filename needs a valid date.');
    }
    return date.toISOString().slice(0, 10);
  }

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(date);
  if (match?.[1] === undefined) {
    throw new TypeError(`A post filename needs an ISO 8601 date, received ${JSON.stringify(date)}`);
  }
  return match[1];
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
