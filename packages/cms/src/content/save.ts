import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { dump } from 'js-yaml';

import { withFileLock, writeFileAtomically } from '../files/atomic.ts';
import { exists, isNotFound } from '../util/files.ts';
import { KNOWN_FRONT_MATTER_KEYS } from './document.ts';
import type { Document, DocumentContent, DocumentType } from './document.ts';
import { handleDirectory } from './handles.ts';
import { parseDocument, typeForPath } from './parser.ts';
import { defaultPermalink } from './slug.ts';
import { isTrashedPath } from './store.ts';
import type { DocumentLookup, IndexWriter } from './store.ts';
import { DEFAULT_TIMEZONE, toUtcInstant } from './time.ts';
import { serializeDocument } from './writer.ts';

/** What {@link contentFilePath} needs to name a file. */
export interface ContentFilePathInput {
  type: DocumentType;
  /** The slug, already URL-safe. It becomes the tail of the filename. */
  slug: string;
  /** Publish date, ISO 8601. Required for a post, ignored for a page. */
  date?: string | Date | undefined;
}

/**
 * Where a document's file goes, relative to the content directory.
 *
 * A post filename carries its date so the directory sorts on disk, a
 * page filename does not. Neither is ever parsed for a URL — the front matter's
 * `permalink` is what decides that — so renaming a file changes nothing but
 * the sort order.
 */
export function contentFilePath(input: ContentFilePathInput): string {
  if (input.slug === '') {
    throw new TypeError('A content file needs a non-empty slug.');
  }

  if (input.type === 'page') return `pages/${input.slug}.md`;
  if (input.type === 'wiki') return `wiki/${input.slug}.md`;

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
  store: DocumentLookup;
  wikiBase?: string | undefined;
}

/**
 * The given slug, or the first numbered variant of it that neither the content
 * directory nor the index has already claimed. A trashed document's URL is free
 * to take.
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
    const permalink = defaultPermalink({
      type: input.type,
      slug,
      date: input.date,
      wikiBase: input.wikiBase,
    });

    if (store.getByPath(relative) !== undefined) continue;
    const holder = store.getByPermalink(permalink);
    if (holder !== undefined && !isTrashedPath(holder.path)) continue;
    if (await exists(path.join(contentDir, ...relative.split('/')))) continue;

    return slug;
  }
}

/** What {@link saveDocument} writes, and where. */
export interface SaveDocumentOptions {
  /** The content directory. Missing parent directories are created. */
  contentDir: string;
  /** The index to bring up to date once the bytes have landed. */
  store: DocumentLookup & IndexWriter;
  /** The file's path relative to {@link SaveDocumentOptions.contentDir}. */
  path: string;
  /** The document to serialize. */
  content: DocumentContent;
  /**
   * The site's time zone, which is what an offset-less date means. UTC unless
   * a caller says otherwise; the admin passes the `timezone` setting.
   */
  timezone?: string | undefined;
  wikiBase?: string | undefined;
}

/**
 * Run one read-then-write of the documents with no other between the read and
 * the write. The editor's save, a move to or from the trash, a taxonomy rename
 * and the federation's stamp write the same files from what they last read.
 */
export function withDocumentWrites<T>(contentDir: string, task: () => Promise<T>): Promise<T> {
  return withFileLock(path.join(contentDir, '.document-writes'), task);
}

/**
 * The admin's write path: serialize, write the file atomically, then
 * update the index directly rather than waiting for the watcher.
 *
 * The watcher event that follows the rename is a no-op, because the hash
 * already matches what this put in the index.
 */
export async function saveDocument(options: SaveDocumentOptions): Promise<Document> {
  const relative = options.path.replace(/\\/g, '/');
  const file = path.join(options.contentDir, ...relative.split('/'));
  const source = serializeDocument(
    utcDates(options.content, options.timezone ?? DEFAULT_TIMEZONE, relative),
    typeForPath(relative),
  );

  // Parsed before it is written, so a document that cannot be read back is
  // refused rather than left on disk for the watcher to complain about.
  const document = parseDocument(source, {
    path: relative,
    handles: handleDirectory(options.contentDir),
    wikiBase: options.wikiBase,
  });

  await writeFileAtomically(file, source);

  options.store.upsert(document);
  return document;
}

/** What {@link addPublishedStamp} writes, and where. */
export interface AddPublishedStampOptions {
  contentDir: string;
  store: IndexWriter;
  /** The file's path relative to {@link AddPublishedStampOptions.contentDir}. */
  path: string;
  /** The `activitypub.published` to add, which the file does not carry yet. */
  published: string;
  /** The {@link Document.hash} of the version being stamped. */
  hash: string;
}

/**
 * Add `activitypub.published` to a post's file as one inserted line, then
 * update the index from the bytes written.
 *
 * Unlike {@link saveDocument} it does not serialize the document again, so the
 * comments, key order, quoting and keys the CMS does not model that a
 * hand-written file carries stay as they were. So does a date written with no
 * offset, which a rewrite would turn into an instant read in the site's zone
 * while the index and the activity already sent read it in the server's.
 *
 * A file that is gone, or that no longer reads as the version with
 * {@link AddPublishedStampOptions.hash}, is left alone and `undefined`
 * answered: the stamp says the followers were told about what the file holds,
 * and a newer version is the business of the change that wrote it.
 */
export async function addPublishedStamp(
  options: AddPublishedStampOptions,
): Promise<Document | undefined> {
  const relative = options.path.replace(/\\/g, '/');
  const file = path.join(options.contentDir, ...relative.split('/'));
  const written = await readFile(file, 'utf8').catch((error: unknown) => {
    if (isNotFound(error)) return undefined;
    throw error;
  });
  if (written === undefined || parseDocument(written, { path: relative }).hash !== options.hash) {
    return undefined;
  }
  const source = withPublishedLine(written, options.published, relative);

  const document = parseDocument(source, {
    path: relative,
    handles: handleDirectory(options.contentDir),
  });
  if (document.activitypub?.published !== options.published) {
    throw new TypeError(`${relative} has an activitypub block the stamp cannot be added to.`);
  }

  await writeFileAtomically(file, source);

  options.store.upsert(document);
  return document;
}

/**
 * The file's text with a `published:` line as the first key of its
 * `activitypub` block, or with a new block where {@link serializeDocument}
 * puts one: after the keys the CMS models, before the ones it does not. A file
 * the CMS wrote then reads exactly as its next save would write it.
 */
function withPublishedLine(source: string, published: string, path: string): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(eol);
  const end = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
  if (lines[0] !== '---' || end === -1) {
    throw new TypeError(`${path} has no YAML front matter to stamp.`);
  }

  const stamp = `published: ${dump(published).trimEnd()}`;
  const block = lines.findIndex(
    (line, index) => index < end && /^activitypub:[ \t]*(#.*)?$/.test(line),
  );
  if (block === -1) {
    const extra = lines.findIndex((line, index) => index < end && isUnmodelledKey(line));
    lines.splice(extra === -1 ? end : extra, 0, 'activitypub:', `  ${stamp}`);
  } else {
    const first = lines.slice(block + 1, end).find((line) => !/^\s*(#.*)?$/.test(line));
    const indent = /^[ \t]+/.exec(first ?? '')?.[0] ?? '  ';
    lines.splice(block + 1, 0, `${indent}${stamp}`);
  }
  return lines.join(eol);
}

function isUnmodelledKey(line: string): boolean {
  const key = /^([^\s#'"-][^:]*):(\s|$)/.exec(line)?.[1];
  return key !== undefined && !(KNOWN_FRONT_MATTER_KEYS as readonly string[]).includes(key);
}

/**
 * The document with every date it carries turned into a UTC instant.
 *
 * A date the CMS writes ends in `Z`, whatever the file it came
 * from spelled. That is done here, once, rather than in each
 * caller — the editor and a taxonomy rewrite — so every save converts and
 * neither has to remember to. The federation's stamp does not come through
 * here: it adds its one key to the file as written. It is done before
 * the serialize rather than inside it because {@link saveDocument} parses its
 * own output back and hashes it: normalising later would leave the index
 * holding a hash of bytes that were never written.
 *
 * A mere scan does not come through here, so a hand-written file with an
 * offset keeps its offset until something actually saves it.
 */
function utcDates(content: DocumentContent, timezone: string, path: string): DocumentContent {
  const date = instant(content.date, timezone, 'date', path);
  const updated = instant(content.updated, timezone, 'updated', path);
  const published = instant(
    content.activitypub?.published,
    timezone,
    'activitypub.published',
    path,
  );

  return {
    ...content,
    ...(date === undefined ? {} : { date }),
    ...(updated === undefined ? {} : { updated }),
    ...(content.activitypub === undefined
      ? {}
      : {
          activitypub: {
            ...content.activitypub,
            ...(published === undefined ? {} : { published }),
          },
        }),
  };
}

/** One date as its instant. A date that is there and unreadable is refused. */
function instant(
  value: string | undefined,
  timezone: string,
  key: string,
  path: string,
): string | undefined {
  if (value === undefined) return undefined;

  const utc = toUtcInstant(value, timezone);
  if (utc === undefined) {
    throw new TypeError(`${path} has a ${key} that is not a date: ${JSON.stringify(value)}`);
  }
  return utc;
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
