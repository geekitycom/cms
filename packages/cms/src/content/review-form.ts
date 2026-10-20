import { trimmedField } from '../util/forms.ts';
import { isRecord } from '../util/guards.ts';
import { isUploadUrl, isWebUrl } from './enclosure.ts';
import type { EditorField, FieldError } from './form-error.ts';
import { isLibraryImage, photoRowFromMicropub, photoToMicropub } from './photo-form.ts';
import {
  calendarDay,
  isReviewKind,
  ITEM_FRONT_MATTER_KEY,
  RATING_FRONT_MATTER_KEY,
  ratingValue,
  REVIEW_KIND_FIELDS,
  REVIEW_KINDS,
} from './review.ts';
import type { Review, ReviewedItem, ReviewKind } from './review.ts';

/** The editor's review fields (TASK-432), as strings, which is what a form has. */
export interface ReviewForm {
  kind: string;
  name: string;
  by: string;
  year: string;
  uid: string;
  url: string;
  photo: string;
  photoAlt: string;
  date: string;
  season: string;
  episode: string;
  category: string;
  streetAddress: string;
  locality: string;
  region: string;
  countryName: string;
  rating: string;
}

export const REVIEW_FIELDS = {
  kind: 'item-kind',
  name: 'item-name',
  by: 'item-by',
  year: 'item-year',
  uid: 'item-uid',
  url: 'item-url',
  photo: 'item-photo',
  photoAlt: 'item-photo-alt',
  date: 'item-date',
  season: 'item-season',
  episode: 'item-episode',
  category: 'item-category',
  streetAddress: 'item-street-address',
  locality: 'item-locality',
  region: 'item-region',
  countryName: 'item-country-name',
  rating: 'rating',
} as const satisfies Record<keyof ReviewForm, string>;

export const BLANK_REVIEW_FORM: ReviewForm = {
  kind: '',
  name: '',
  by: '',
  year: '',
  uid: '',
  url: '',
  photo: '',
  photoAlt: '',
  date: '',
  season: '',
  episode: '',
  category: '',
  streetAddress: '',
  locality: '',
  region: '',
  countryName: '',
  rating: '',
};

export function submittedReviewForm(body: Readonly<Record<string, unknown>>): ReviewForm {
  return Object.fromEntries(
    Object.entries(REVIEW_FIELDS).map(([key, name]) => [key, trimmedField(body, name)]),
  ) as unknown as ReviewForm;
}

/**
 * The form for the review a file holds. The kind and the rating are as the
 * file spells them, so one the site does not recognize is offered back
 * rather than lost to a save.
 */
export function reviewForm(
  extra: Readonly<Record<string, unknown>>,
  review: Review | undefined,
): ReviewForm {
  if (review === undefined) return BLANK_REVIEW_FORM;
  const { item } = review;
  const written = extra[ITEM_FRONT_MATTER_KEY] as Record<string, unknown>;
  const rating = extra[RATING_FRONT_MATTER_KEY];
  return {
    ...BLANK_REVIEW_FORM,
    ...Object.fromEntries(
      Object.entries(item).flatMap(([key, value]) =>
        typeof value === 'string' ? [[key, value]] : [],
      ),
    ),
    kind: typeof written['kind'] === 'string' ? written['kind'].trim() : item.kind,
    photo: item.photo?.url ?? '',
    photoAlt: item.photo?.alt ?? '',
    rating: typeof rating === 'number' || typeof rating === 'string' ? String(rating).trim() : '',
  };
}

function field(key: keyof ReviewForm): EditorField {
  return `editor-${REVIEW_FIELDS[key]}`;
}

const WHOLE_NUMBER = /^\d+$/;

/** The review a form describes, or why it cannot be one. */
export function resolveReview(
  form: ReviewForm,
  contentDir: string,
): { review: Review | undefined } | FieldError {
  if (Object.values(form).every((value) => value === '')) return { review: undefined };
  const kind: string = form.kind === '' ? 'other' : form.kind;
  if (!isReviewKind(kind)) {
    return {
      error: `What a review is of is ${REVIEW_KINDS.join(', ')}, not ${kind}.`,
      field: field('kind'),
    };
  }
  if (form.name === '') {
    return { error: 'A review needs the name of what it reviews.', field: field('name') };
  }
  const rating = ratingValue(form.rating);
  if (form.rating !== '' && rating === undefined) {
    return {
      error: `Rating is a whole number from 1 to 5, not ${form.rating}.`,
      field: field('rating'),
    };
  }
  const has = (key: keyof ReviewedItem): boolean =>
    (REVIEW_KIND_FIELDS[kind] as readonly string[]).includes(key);
  const given = (key: keyof ReviewForm & keyof ReviewedItem): string => (has(key) ? form[key] : '');
  const refusal = refusedItemField(kind, form, given, contentDir);
  if (refusal !== undefined) return refusal;
  const word = (key: keyof ReviewForm & keyof ReviewedItem): Record<string, string> =>
    given(key) === '' ? {} : { [key]: given(key) };
  const photo = has('photo') ? form.photo : '';
  const item: ReviewedItem = {
    kind,
    name: form.name,
    ...word('by'),
    ...word('year'),
    ...word('uid'),
    ...word('url'),
    ...(photo === ''
      ? {}
      : { photo: form.photoAlt === '' ? { url: photo } : { url: photo, alt: form.photoAlt } }),
    ...word('date'),
    ...word('season'),
    ...word('episode'),
    ...word('category'),
    ...word('streetAddress'),
    ...word('locality'),
    ...word('region'),
    ...word('countryName'),
  };
  return { review: rating === undefined ? { item } : { item, rating } };
}

function refusedItemField(
  kind: ReviewKind,
  form: ReviewForm,
  given: (key: keyof ReviewForm & keyof ReviewedItem) => string,
  contentDir: string,
): FieldError | undefined {
  const uid = given('uid');
  if (uid !== '' && !isItemId(uid)) {
    return {
      error: `An ID is the item’s web address, or isbn:… or doi:…, not ${uid}.`,
      field: field('uid'),
    };
  }
  const url = given('url');
  if (url !== '' && !isWebUrl(url)) {
    const noun = kind === 'place' ? 'A website' : 'An address';
    return {
      error: `${noun} has to be a web address, like https://example.com/.`,
      field: field('url'),
    };
  }
  const photo = REVIEW_KIND_FIELDS[kind].includes('photo') ? form.photo : '';
  if (isUploadUrl(photo)) {
    if (!isLibraryImage(photo, contentDir)) {
      return {
        error: `The picture ${photo} is not an image in the media library.`,
        field: field('photo'),
      };
    }
  } else if (photo !== '' && !isWebUrl(photo)) {
    return {
      error: `A picture is an image in the media library or a web address, not ${photo}.`,
      field: field('photo'),
    };
  }
  const year = given('year');
  if (year !== '' && !/^\d{1,4}$/.test(year)) {
    return { error: `Year is a year, like 2024, not ${year}.`, field: field('year') };
  }
  const date = given('date');
  if (date !== '' && calendarDay(date) === undefined) {
    return {
      error: `The date has to be a day, like 2026-10-18, not ${date}.`,
      field: field('date'),
    };
  }
  for (const key of ['season', 'episode'] as const) {
    const value = given(key);
    if (value !== '' && !WHOLE_NUMBER.test(value)) {
      const label = key === 'season' ? 'Season' : 'Episode';
      return { error: `${label} is a whole number, not ${value}.`, field: field(key) };
    }
  }
  return undefined;
}

/** An item's ID: its canonical web address, or an ISBN or a DOI. */
function isItemId(value: string): boolean {
  return isWebUrl(value) || /^(isbn|doi):\S+$/i.test(value);
}

/** The mf2 name of each item field Micropub carries, beside the h-review's own. */
const MICROPUB_ITEM_PROPERTIES = {
  kind: 'kind',
  name: 'name',
  by: 'author',
  year: 'published',
  uid: 'uid',
  url: 'url',
  date: 'date',
  season: 'season',
  episode: 'episode',
  category: 'category',
  streetAddress: 'street-address',
  locality: 'locality',
  region: 'region',
  countryName: 'country-name',
} as const satisfies Partial<Record<keyof ReviewForm, string>>;

const ITEM_TYPES = ['h-cite', 'h-card', 'h-product', 'h-item', 'h-adr'];

const ITEM_REFUSAL =
  'item is one h-cite, h-card, h-product or h-item, { "type": ["h-cite"], "properties": { "name": ["…"] } }, or its name.';

/**
 * The review a Micropub create names, as the editor's form: its `item`, an
 * h-cite for most things and an h-card for a place, and its `rating`. An
 * item's `kind` says what it is; without one an h-card or h-adr is a place
 * and anything else an other.
 */
export function reviewFromMicropub(
  items: readonly unknown[],
  ratings: readonly unknown[],
  refuse: (message: string) => void,
  baseUrl: string,
): ReviewForm {
  if (items.length > 1) refuse('item takes one value.');
  if (ratings.length > 1) refuse('rating takes one value.');
  const [given] = ratings;
  const rating =
    given === undefined
      ? ''
      : typeof given === 'number'
        ? String(given)
        : typeof given === 'string'
          ? given.trim()
          : '';
  if (given !== undefined && ratingValue(rating) === undefined) {
    refuse(
      `rating is a whole number from 1 to 5, not ${typeof given === 'string' || typeof given === 'number' ? String(given) : JSON.stringify(given)}.`,
    );
  }
  const [value] = items;
  if (value === undefined) {
    if (given !== undefined) refuse('rating belongs to a review; send the item it rates.');
    return BLANK_REVIEW_FORM;
  }
  if (typeof value === 'string') {
    if (value.trim() === '') refuse(ITEM_REFUSAL);
    return { ...BLANK_REVIEW_FORM, kind: 'other', name: value.trim(), rating };
  }
  const { type, properties } = isRecord(value) ? value : {};
  if (
    !Array.isArray(type) ||
    !type.some((name) => ITEM_TYPES.includes(name as string)) ||
    !isRecord(properties)
  ) {
    refuse(ITEM_REFUSAL);
    return BLANK_REVIEW_FORM;
  }
  const known = new Set<string>([...Object.values(MICROPUB_ITEM_PROPERTIES), 'photo']);
  const unknown = Object.keys(properties).filter((name) => !known.has(name));
  if (unknown.length > 0) refuse(`item does not understand ${unknown.join(', ')}.`);
  const text = (name: string): string => {
    const values = properties[name] ?? [];
    if (!Array.isArray(values) || values.length > 1) {
      refuse(`item ${name} takes one text value.`);
      return '';
    }
    const first: unknown = values[0];
    if (first === undefined) return '';
    if (typeof first !== 'string' && typeof first !== 'number') {
      refuse(`item ${name} takes one text value.`);
      return '';
    }
    return String(first).trim();
  };
  const form: ReviewForm = { ...BLANK_REVIEW_FORM, rating };
  for (const [key, name] of Object.entries(MICROPUB_ITEM_PROPERTIES)) {
    form[key as keyof typeof MICROPUB_ITEM_PROPERTIES] = text(name);
  }
  if (form.kind === '') {
    form.kind = type.some((name) => name === 'h-card' || name === 'h-adr') ? 'place' : 'other';
  }
  if (form.name === '') refuse('An item needs a name.');
  const photos = properties['photo'] ?? [];
  if (!Array.isArray(photos) || photos.length > 1) refuse('item photo takes one value.');
  else if (photos.length === 1) {
    const row = photoRowFromMicropub(photos[0], baseUrl);
    if (row === undefined) refuse('item photo is a web address or { "value": "…", "alt": "…" }.');
    else {
      form.photo = row.url;
      form.photoAlt = row.alt;
    }
  }
  return form;
}

/** The review as Micropub reads it back: `item` and `rating`. */
export function reviewToMicropub(
  review: Review | undefined,
  baseUrl: string,
): Record<string, unknown[]> {
  if (review === undefined) return {};
  const { item, rating } = review;
  const properties: Record<string, unknown[]> = {};
  for (const [key, name] of Object.entries(MICROPUB_ITEM_PROPERTIES)) {
    const value = item[key as keyof typeof MICROPUB_ITEM_PROPERTIES];
    if (value !== undefined) properties[name] = [value];
  }
  if (item.photo !== undefined) {
    properties['photo'] = [
      photoToMicropub({ url: item.photo.url, alt: item.photo.alt ?? '' }, baseUrl),
    ];
  }
  return {
    item: [{ type: [item.kind === 'place' ? 'h-card' : 'h-cite'], properties }],
    ...(rating === undefined ? {} : { rating: [String(rating)] }),
  };
}
