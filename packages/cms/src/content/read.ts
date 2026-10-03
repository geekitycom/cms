import { isWebUrl } from './enclosure.ts';

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
  return readWorkFrontMatter({ name, author: word('author'), uid: word('uid'), url: word('url') });
}

export function uidLabel(uid: string): string {
  return /^isbn:/i.test(uid) ? `ISBN: ${uid.slice('isbn:'.length)}` : uid;
}

export function readWorkFrontMatter({ name, author, uid, url }: ReadOf): ReadOf {
  return {
    name,
    ...(author ? { author } : {}),
    ...(uid ? { uid } : {}),
    ...(url ? { url } : {}),
  };
}

/**
 * The sentence a read post says, as the HTML every surface prints: the page,
 * the federated Note and the feeds. It carries the page's microformats, so a
 * parser reading any of them finds p-read-status and the p-read-of h-cite.
 * Empty for a post that read nothing.
 */
export function readLine(read: Read | undefined): string {
  if (read === undefined) return '';
  const { status, of } = read;
  const cited = `<cite class="p-name">${escapeHtml(of.name)}</cite>`;
  return (
    `<p class="read-line"><data class="p-read-status" value="${status}">` +
    `${READ_STATUS_LABELS[status]}</data>: <span class="p-read-of h-cite">` +
    (of.url === undefined ? cited : `<a class="u-url" href="${escapeHtml(of.url)}">${cited}</a>`) +
    (of.author === undefined ? '' : ` by <span class="p-author">${escapeHtml(of.author)}</span>`) +
    (of.uid === undefined
      ? ''
      : `, <data class="p-uid" value="${escapeHtml(of.uid)}">${escapeHtml(uidLabel(of.uid))}</data>`) +
    '</span></p>\n'
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
