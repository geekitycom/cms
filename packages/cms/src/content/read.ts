/**
 * What a read post says was read, and how far (TASK-229): the IndieWeb
 * `read-of` and `read-status`, as indiebookclub sends them.
 *
 * ```yaml
 * read-of:
 *   name: The Left Hand of Darkness
 *   author: Ursula K. Le Guin
 *   uid: isbn:9780441478125
 * read-status: to-read
 * ```
 *
 * Both stay in {@link Document.extra}, like the citations: {@link readOf} is
 * the one reading of them, and the theme, the federation and Post Type
 * Discovery read only what it returns.
 */
import { isWebUrl } from './enclosure.ts';

export const READ_OF_FRONT_MATTER_KEY = 'read-of';
export const READ_STATUS_FRONT_MATTER_KEY = 'read-status';

/** Every read-status, in the order a form offers them. */
export const READ_STATUSES = ['to-read', 'reading', 'finished'] as const;

export type ReadStatus = (typeof READ_STATUSES)[number];

/** What each read-status says, in the words indiebookclub prints. */
export const READ_STATUS_LABELS: Readonly<Record<ReadStatus, string>> = {
  'to-read': 'Want to read',
  reading: 'Currently reading',
  finished: 'Finished reading',
};

/** The work read: an h-cite with a name, and an author, a uid and a URL when known. */
export interface ReadOf {
  readonly name: string;
  readonly author?: string | undefined;
  /** An identifier such as `isbn:9780441478125` or `doi:10.1000/182`. */
  readonly uid?: string | undefined;
  /** An absolute `http` or `https` URL. */
  readonly url?: string | undefined;
}

/** A read post's two properties, which only mean something together. */
export interface Read {
  readonly status: ReadStatus;
  readonly of: ReadOf;
}

export function isReadStatus(value: unknown): value is ReadStatus {
  return READ_STATUSES.includes(value as ReadStatus);
}

/**
 * What a post's front matter says was read, or `undefined` when it does not
 * name both a work with a name and a read-status the site knows. A `url`
 * that is no web address links nothing, so it is left out.
 */
export function readOf(extra: Readonly<Record<string, unknown>>): Read | undefined {
  const status = extra[READ_STATUS_FRONT_MATTER_KEY];
  const of = readWork(extra[READ_OF_FRONT_MATTER_KEY]);
  if (!isReadStatus(status) || of === undefined) return undefined;
  return { status, of: isWebUrl(of.url ?? '') ? of : { ...of, url: undefined } };
}

/**
 * The `read-of` front matter as the file spells it, valid or not: a map's
 * text fields, or a bare name, which a hand-written file may hold.
 */
export function readWork(value: unknown): ReadOf | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : { name: value.trim() };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const word = (key: string): string | undefined => {
    const field = fields[key];
    return typeof field === 'string' && field.trim() !== '' ? field.trim() : undefined;
  };
  const name = word('name');
  if (name === undefined) return undefined;
  return readWorkFrontMatter({ name, author: word('author'), uid: word('uid'), url: word('url') });
}

/**
 * How a page prints a uid: an ISBN as indiebookclub prints one, anything
 * else, a DOI included, as it is.
 */
export function uidLabel(uid: string): string {
  return /^isbn:/i.test(uid) ? `ISBN: ${uid.slice('isbn:'.length)}` : uid;
}

/** The `read-of` map to write, without the keys that hold nothing. */
export function readWorkFrontMatter({ name, author, uid, url }: ReadOf): ReadOf {
  return {
    name,
    ...(author ? { author } : {}),
    ...(uid ? { uid } : {}),
    ...(url ? { url } : {}),
  };
}
