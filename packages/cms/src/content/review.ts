import { isRecord } from '../util/guards.ts';
import { decodeEntities, escapeAttribute, escapeText } from '../util/html.ts';
import { absoluteUrl } from '../util/url.ts';
import type { AltTextLibrary } from './alt-text.ts';
import { isWebUrl } from './enclosure.ts';
import { photoAlt, photoOf } from './photo.ts';
import type { Photo } from './photo.ts';

export const ITEM_FRONT_MATTER_KEY = 'item';
export const RATING_FRONT_MATTER_KEY = 'rating';
export const BEST_RATING = 5;

export const REVIEW_KINDS = ['book', 'movie', 'tv', 'album', 'place', 'other'] as const;

export type ReviewKind = (typeof REVIEW_KINDS)[number];

export type Rating = 1 | 2 | 3 | 4 | 5;

export interface ReviewedItem {
  readonly kind: ReviewKind;
  readonly name: string;
  readonly by?: string | undefined;
  readonly year?: string | undefined;
  readonly uid?: string | undefined;
  readonly url?: string | undefined;
  readonly photo?: Photo | undefined;
  readonly date?: string | undefined;
  readonly season?: string | undefined;
  readonly episode?: string | undefined;
  readonly category?: string | undefined;
  readonly streetAddress?: string | undefined;
  readonly locality?: string | undefined;
  readonly region?: string | undefined;
  readonly countryName?: string | undefined;
}

export interface Review {
  readonly item: ReviewedItem;
  readonly rating?: Rating | undefined;
}

type ItemField = Exclude<keyof ReviewedItem, 'kind' | 'name'>;

const ADDRESS_FIELDS = ['streetAddress', 'locality', 'region', 'countryName'] as const;

const WORK_FIELDS = ['by', 'year', 'uid', 'url', 'photo', 'date'] as const;

export const REVIEW_KIND_FIELDS: Readonly<Record<ReviewKind, readonly ItemField[]>> = {
  book: WORK_FIELDS,
  movie: WORK_FIELDS,
  tv: [...WORK_FIELDS, 'season', 'episode'],
  album: WORK_FIELDS,
  place: ['category', ...ADDRESS_FIELDS, 'url', 'uid', 'photo', 'date'],
  other: ['category', 'by', 'uid', 'url', 'photo'],
};

export const REVIEW_KIND_WORDS: Readonly<
  Record<
    ReviewKind,
    { label: string; noun: string; by: string; byPhrase: string; date: string; picture: string }
  >
> = {
  book: {
    label: 'Book',
    noun: 'book',
    by: 'Author',
    byPhrase: 'by',
    date: 'Finished on',
    picture: 'Book cover',
  },
  movie: {
    label: 'Movie',
    noun: 'movie',
    by: 'Director',
    byPhrase: 'directed by',
    date: 'Watched on',
    picture: 'Poster',
  },
  tv: {
    label: 'TV show',
    noun: 'TV show',
    by: 'Network',
    byPhrase: 'on',
    date: 'Watched on',
    picture: 'Poster',
  },
  album: {
    label: 'Album',
    noun: 'album',
    by: 'Artist',
    byPhrase: 'by',
    date: 'Listened on',
    picture: 'Album art',
  },
  place: {
    label: 'Place',
    noun: 'place',
    by: '',
    byPhrase: '',
    date: 'Visited on',
    picture: 'Picture',
  },
  other: {
    label: 'Other',
    noun: '',
    by: 'Made or run by',
    byPhrase: 'by',
    date: '',
    picture: 'Picture',
  },
};

export const ITEM_KEYS: Readonly<Record<ItemField, string>> = {
  by: 'by',
  year: 'year',
  uid: 'uid',
  url: 'url',
  photo: 'photo',
  date: 'date',
  season: 'season',
  episode: 'episode',
  category: 'category',
  streetAddress: 'street-address',
  locality: 'locality',
  region: 'region',
  countryName: 'country-name',
};

export function isReviewKind(value: unknown): value is ReviewKind {
  return REVIEW_KINDS.includes(value as ReviewKind);
}

export function ratingValue(value: unknown): Rating | undefined {
  const written = typeof value === 'string' ? value.trim() : value;
  const number =
    typeof written === 'number'
      ? written
      : typeof written === 'string' && /^\d+$/.test(written)
        ? Number(written)
        : Number.NaN;
  return Number.isInteger(number) && number >= 1 && number <= BEST_RATING
    ? (number as Rating)
    : undefined;
}

export function reviewOf(extra: Readonly<Record<string, unknown>>): Review | undefined {
  const item = reviewedItem(extra[ITEM_FRONT_MATTER_KEY]);
  if (item === undefined) return undefined;
  const rating = ratingValue(extra[RATING_FRONT_MATTER_KEY]);
  return rating === undefined ? { item } : { item, rating };
}

function reviewedItem(fields: unknown): ReviewedItem | undefined {
  if (!isRecord(fields)) return undefined;
  const name = word(fields['name']);
  if (name === undefined) return undefined;
  const kind = isReviewKind(fields['kind']) ? fields['kind'] : 'other';
  const read: Partial<Record<ItemField, unknown>> = {};
  for (const field of REVIEW_KIND_FIELDS[kind]) {
    const raw = fields[ITEM_KEYS[field]];
    read[field] =
      field === 'photo'
        ? Array.isArray(raw)
          ? undefined
          : photoOf(raw)
        : field === 'date'
          ? calendarDay(raw)
          : field === 'url'
            ? webUrl(word(raw))
            : word(raw);
  }
  return withoutBlanks({ kind, name, ...read } as ReviewedItem);
}

function withoutBlanks(item: ReviewedItem): ReviewedItem {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined),
  ) as ReviewedItem;
}

export function reviewFrontMatter(review: Review | undefined): {
  item: Record<string, unknown> | undefined;
  rating: Rating | undefined;
} {
  if (review === undefined) return { item: undefined, rating: undefined };
  const { item } = review;
  const written: Record<string, unknown> = { kind: item.kind, name: item.name };
  for (const field of REVIEW_KIND_FIELDS[item.kind]) {
    const value = item[field];
    if (value === undefined) continue;
    written[ITEM_KEYS[field]] =
      typeof value === 'object'
        ? value.alt === undefined
          ? { url: value.url }
          : { url: value.url, alt: value.alt }
        : (field === 'year' || field === 'season' || field === 'episode') && /^\d+$/.test(value)
          ? Number(value)
          : value;
  }
  return { item: written, rating: review.rating };
}

export interface ReviewHtmlOptions {
  readonly library?: AltTextLibrary | undefined;
  readonly baseUrl?: string | undefined;
}

export function reviewHtml(review: Review | undefined, options: ReviewHtmlOptions = {}): string {
  if (review === undefined) return '';
  const { item, rating } = review;
  const words = REVIEW_KIND_WORDS[item.kind];
  const root = item.kind === 'place' ? 'h-card' : 'h-cite';
  const link = item.url ?? (item.uid !== undefined && isWebUrl(item.uid) ? item.uid : undefined);
  const name = `<cite class="p-name">${escapeText(item.name)}</cite>`;
  const linked =
    link === undefined
      ? name
      : `<a class="u-url${link === item.uid ? ' u-uid' : ''}" href="${escapeAttribute(link)}">${name}</a>`;
  const about = [
    item.kind === 'place' || item.kind === 'other'
      ? item.category === undefined
        ? undefined
        : `<span class="p-category">${escapeText(item.category)}</span>`
      : words.noun,
    item.year === undefined
      ? undefined
      : `<time class="dt-published" datetime="${escapeAttribute(item.year)}">${escapeText(item.year)}</time>`,
  ].filter((part) => part !== undefined);
  const by =
    item.by === undefined
      ? ''
      : `, ${words.byPhrase} <span class="p-author">${escapeText(item.by)}</span>`;
  const uid =
    item.uid === undefined || link === item.uid
      ? ''
      : isWebUrl(item.uid)
        ? `<data class="u-uid" value="${escapeAttribute(item.uid)}"></data>`
        : `, <data class="u-uid" value="${escapeAttribute(item.uid)}">${escapeText(uidLabel(item.uid))}</data>`;
  const details = [
    seasonWords(item),
    address(item),
    item.date === undefined
      ? undefined
      : `${words.date} <time datetime="${item.date}">${readableDay(item.date)}</time>`,
  ].filter((part) => part !== undefined);
  return (
    `<div class="review-item p-item ${root}">` +
    (item.photo === undefined ? '' : picture(item.photo, options)) +
    `<p class="review-of">Review of ${linked}` +
    (about.length === 0 ? '' : ` (${about.join(', ')})`) +
    by +
    uid +
    '</p>' +
    (details.length === 0 ? '' : `<p class="review-details">${details.join('. ')}.</p>`) +
    '</div>\n' +
    (rating === undefined ? '' : ratingHtml(rating))
  );
}

export function reviewSummary(review: Review): string {
  const html = reviewHtml({ ...review, item: { ...review.item, photo: undefined } }).replace(
    /<span class="review-stars"[^>]*>[^<]*<\/span>/,
    '',
  );
  return [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map(([, paragraph = '']) =>
      decodeEntities(paragraph.replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .map((sentence) => (sentence.endsWith('.') ? sentence : `${sentence}.`))
    .join(' ');
}

function ratingHtml(rating: Rating): string {
  const stars = '★'.repeat(rating) + '☆'.repeat(BEST_RATING - rating);
  return (
    `<p class="review-rating"><span class="review-stars" aria-hidden="true">${stars}</span> ` +
    `Rated <data class="p-rating" value="${String(rating)}">${String(rating)}</data> out of ` +
    `<data class="p-best" value="${String(BEST_RATING)}">${String(BEST_RATING)}</data></p>\n`
  );
}

function seasonWords({ season, episode }: ReviewedItem): string | undefined {
  if (season === undefined && episode === undefined) return undefined;
  const parts = [
    season === undefined ? undefined : `Season ${escapeText(season)}`,
    episode === undefined ? undefined : `episode ${escapeText(episode)}`,
  ].filter((part) => part !== undefined);
  const sentence = parts.join(', ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function address(item: ReviewedItem): string | undefined {
  const parts = (
    [
      ['p-street-address', item.streetAddress],
      ['p-locality', item.locality],
      ['p-region', item.region],
      ['p-country-name', item.countryName],
    ] as const
  ).flatMap(([property, value]) =>
    value === undefined ? [] : [`<span class="${property}">${escapeText(value)}</span>`],
  );
  return parts.length === 0 ? undefined : parts.join(', ');
}

function picture(photo: Photo, { library, baseUrl }: ReviewHtmlOptions): string {
  const src = baseUrl === undefined ? photo.url : absoluteUrl(photo.url, baseUrl);
  const alt = photoAlt(photo, library ?? new Map()) ?? '';
  return (
    `<span class="review-picture"><img class="u-photo" src="${escapeAttribute(src)}"` +
    ` alt="${escapeAttribute(alt)}"></span>`
  );
}

function uidLabel(uid: string): string {
  const match = /^(isbn|doi):(.*)$/i.exec(uid);
  return match === null ? uid : `${(match[1] ?? '').toUpperCase()} ${match[2] ?? ''}`;
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });

function readableDay(day: string): string {
  return DAY_FORMAT.format(new Date(`${day}T00:00:00Z`));
}

/** YAML reads an unquoted day as a midnight UTC `Date`. */
export function calendarDay(value: unknown): string | undefined {
  const written = value instanceof Date ? value.toISOString() : word(value);
  const day =
    written === undefined
      ? undefined
      : /^(\d{4}-\d{2}-\d{2})(T00:00:00(\.000)?Z)?$/.exec(written)?.[1];
  if (day === undefined) return undefined;
  return Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? undefined : day;
}

function webUrl(value: string | undefined): string | undefined {
  return value !== undefined && isWebUrl(value) ? value : undefined;
}

function word(value: unknown): string | undefined {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && text.trim() !== '' ? text.trim() : undefined;
}
