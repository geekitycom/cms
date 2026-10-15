import { escapeAttribute, escapeText } from '../util/html.ts';
import { absoluteUrl } from '../util/url.ts';
import type { AltTextLibrary } from './alt-text.ts';
import { isWebUrl } from './enclosure.ts';
import { photoAlt, photoOf } from './photo.ts';
import type { Photo } from './photo.ts';

export const READ_OF_FRONT_MATTER_KEY = 'read-of';
export const READ_STATUS_FRONT_MATTER_KEY = 'read-status';

export const READ_STATUSES = ['to-read', 'reading', 'finished'] as const;

export type ReadStatus = (typeof READ_STATUSES)[number];

export const READ_STATUS_LABELS: Readonly<Record<ReadStatus, string>> = {
  'to-read': 'Want to read',
  reading: 'Currently reading',
  finished: 'Finished reading',
};

export interface ReadOf {
  readonly name: string;
  readonly author?: string | undefined;
  readonly uid?: string | undefined;
  readonly url?: string | undefined;
  /** The work's cover, the h-cite's `photo` (TASK-394): it describes the book, not the post. */
  readonly photo?: Photo | undefined;
}

export interface Read {
  readonly status: ReadStatus;
  readonly of: ReadOf;
}

export function isReadStatus(value: unknown): value is ReadStatus {
  return READ_STATUSES.includes(value as ReadStatus);
}

export function readOf(extra: Readonly<Record<string, unknown>>): Read | undefined {
  const status = extra[READ_STATUS_FRONT_MATTER_KEY];
  const of = readWork(extra[READ_OF_FRONT_MATTER_KEY]);
  if (!isReadStatus(status) || of === undefined) return undefined;
  return { status, of: isWebUrl(of.url ?? '') ? of : { ...of, url: undefined } };
}

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
  const photo = Array.isArray(fields.photo) ? undefined : photoOf(fields.photo);
  return readWorkFrontMatter({
    name,
    author: word('author'),
    uid: word('uid'),
    url: word('url'),
    photo,
  });
}

export function uidLabel(uid: string): string {
  return /^isbn:/i.test(uid) ? `ISBN: ${uid.slice('isbn:'.length)}` : uid;
}

export function readWorkFrontMatter({ name, author, uid, url, photo }: ReadOf): ReadOf {
  return {
    name,
    ...(author ? { author } : {}),
    ...(uid ? { uid } : {}),
    ...(url ? { url } : {}),
    ...(photo
      ? { photo: photo.alt ? { url: photo.url, alt: photo.alt } : { url: photo.url } }
      : {}),
  };
}

export interface ReadLineOptions {
  /** The media library, for a cover's alt text the post does not give. */
  readonly library?: AltTextLibrary | undefined;
  /** The site's origin, to make an uploaded cover's address absolute for a feed or a remote server. */
  readonly baseUrl?: string | undefined;
}

export function readLine(read: Read | undefined, options: ReadLineOptions = {}): string {
  if (read === undefined) return '';
  const { status, of } = read;
  const cited = `<cite class="p-name">${escapeText(of.name)}</cite>`;
  return (
    `<p class="read-line"><data class="p-read-status" value="${status}">` +
    `${READ_STATUS_LABELS[status]}</data>: <span class="p-read-of h-cite">` +
    (of.photo === undefined ? '' : cover(of.photo, options)) +
    (of.url === undefined
      ? cited
      : `<a class="u-url" href="${escapeAttribute(of.url)}">${cited}</a>`) +
    (of.author === undefined ? '' : ` by <span class="p-author">${escapeText(of.author)}</span>`) +
    (of.uid === undefined
      ? ''
      : `, <data class="p-uid" value="${escapeAttribute(of.uid)}">${escapeText(uidLabel(of.uid))}</data>`) +
    '</span></p>\n'
  );
}

function cover(photo: Photo, { library, baseUrl }: ReadLineOptions): string {
  const src = baseUrl === undefined ? photo.url : absoluteUrl(photo.url, baseUrl);
  const alt = photoAlt(photo, library ?? new Map()) ?? '';
  return (
    `<span class="read-cover"><img class="u-photo" src="${escapeAttribute(src)}"` +
    ` alt="${escapeAttribute(alt)}"></span>`
  );
}
