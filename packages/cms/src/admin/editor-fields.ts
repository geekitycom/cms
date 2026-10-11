import { transcriptTypeFor } from '../content/enclosure-form.ts';
import type { AlternateRow, EnclosureForm } from '../content/enclosure-form.ts';
import type { EventForm } from '../content/event-form.ts';
import type { LocationForm } from '../content/location-form.ts';
import type { PhotoRow } from '../content/photo-form.ts';
import type { ReadOfForm } from '../content/read-form.ts';
import type { AltTextLibrary } from '../images/alt-text.ts';
import { uploadPath } from '../images/markup.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { listUploads } from './media.ts';

function trimmedField(body: Record<string, unknown>, name: string): string {
  return stringOrEmpty(body[name]).trim();
}

/** The indexes of a form's numbered rows, in order, read off the names `prefix0`, `prefix1`… */
function rowIndexes(body: Record<string, unknown>, prefix: string): number[] {
  return Object.keys(body)
    .map((name) => new RegExp(`^${prefix}(\\d+)$`).exec(name)?.[1])
    .filter((index) => index !== undefined)
    .map(Number)
    .sort((left, right) => left - right);
}

export const LOCATION_FIELDS = {
  geo: 'location-geo',
  accuracy: 'location-accuracy',
  name: 'location-name',
  locality: 'location-locality',
  region: 'location-region',
  country: 'location-country',
  checkin: 'location-checkin',
} as const satisfies Record<keyof LocationForm, string>;

export function readLocationForm(body: Record<string, unknown>): LocationForm {
  return {
    geo: trimmedField(body, LOCATION_FIELDS.geo),
    accuracy: trimmedField(body, LOCATION_FIELDS.accuracy),
    name: trimmedField(body, LOCATION_FIELDS.name),
    locality: trimmedField(body, LOCATION_FIELDS.locality),
    region: trimmedField(body, LOCATION_FIELDS.region),
    country: trimmedField(body, LOCATION_FIELDS.country),
    checkin: body[LOCATION_FIELDS.checkin] !== undefined,
  };
}

export const READ_FIELDS = {
  status: 'read-status',
  name: 'read-of-name',
  author: 'read-of-author',
  uid: 'read-of-uid',
  url: 'read-of-url',
} as const;

export function submittedReadOfForm(body: Record<string, unknown>): ReadOfForm {
  return {
    name: trimmedField(body, READ_FIELDS.name),
    author: trimmedField(body, READ_FIELDS.author),
    uid: trimmedField(body, READ_FIELDS.uid),
    url: trimmedField(body, READ_FIELDS.url),
  };
}

export const EVENT_FIELDS = {
  start: 'event-start',
  end: 'event-end',
  location: 'event-location',
} as const;

export function submittedEventForm(body: Record<string, unknown>): EventForm {
  return {
    start: trimmedField(body, EVENT_FIELDS.start),
    end: trimmedField(body, EVENT_FIELDS.end),
    location: trimmedField(body, EVENT_FIELDS.location),
  };
}

/** The form field name prefixes; a row's index follows each. */
export const PHOTO_FIELDS = { url: 'photo-url-', alt: 'photo-alt-' } as const;

/** The empty row the editor adds so a form with no script can add a photo. */
export const BLANK_PHOTO_ROW: PhotoRow = { url: '', alt: '' };

/** The photo rows out of a submitted form, in their numbered order, emptied ones gone. */
export function readPhotoForm(body: Record<string, unknown>): PhotoRow[] {
  return rowIndexes(body, PHOTO_FIELDS.url)
    .map((index) => ({
      url: trimmedField(body, `${PHOTO_FIELDS.url}${String(index)}`),
      alt: trimmedField(body, `${PHOTO_FIELDS.alt}${String(index)}`),
    }))
    .filter((row) => row.url !== '');
}

/** A row as the editor prints it, with the library's alt text to show when the row has none. */
export interface PhotoRowView extends PhotoRow {
  libraryAlt: string;
}

/** The rows the editor prints: the post's photos, then a blank one to add another. */
export function photoRowViews(rows: readonly PhotoRow[], library: AltTextLibrary): PhotoRowView[] {
  return [...rows, BLANK_PHOTO_ROW].map((row) => {
    const source = uploadPath(row.url);
    const described = source === undefined ? undefined : library.get(source);
    return { ...row, libraryAlt: described?.kind === 'described' ? described.text : '' };
  });
}

/** The image uploads a photo can be, newest first. */
export async function photoChoices(contentDir: string): Promise<string[]> {
  return (await listUploads(contentDir))
    .filter((file) => file.kind === 'image')
    .map((file) => file.url);
}

/** The form field names, in one place for the template and the reader. */
export const ENCLOSURE_FIELDS = {
  url: 'enclosure-url',
  duration: 'enclosure-duration',
  transcriptUrl: 'enclosure-transcript-url',
  transcriptType: 'enclosure-transcript-type',
  alternate: {
    url: 'alternate-url-',
    type: 'alternate-type-',
    title: 'alternate-title-',
    height: 'alternate-height-',
    lang: 'alternate-lang-',
  },
} as const;

/** The empty row the editor adds so a form with no script can add a version. */
export const BLANK_ALTERNATE_ROW: AlternateRow = {
  url: '',
  type: '',
  title: '',
  height: '',
  lang: '',
};

/**
 * The recording fields out of a submitted form.
 *
 * The alternate rows are numbered, so a plain form with no script can carry
 * any number of them. A row whose address was emptied is a row taken out.
 */
export function readEnclosureForm(body: Record<string, unknown>): EnclosureForm {
  const names = ENCLOSURE_FIELDS.alternate;
  return {
    url: trimmedField(body, ENCLOSURE_FIELDS.url),
    duration: trimmedField(body, ENCLOSURE_FIELDS.duration),
    transcriptUrl: trimmedField(body, ENCLOSURE_FIELDS.transcriptUrl),
    transcriptType: trimmedField(body, ENCLOSURE_FIELDS.transcriptType),
    alternates: rowIndexes(body, names.url)
      .map((index) => ({
        url: trimmedField(body, `${names.url}${String(index)}`),
        type: trimmedField(body, `${names.type}${String(index)}`),
        title: trimmedField(body, `${names.title}${String(index)}`),
        height: trimmedField(body, `${names.height}${String(index)}`),
        lang: trimmedField(body, `${names.lang}${String(index)}`),
      }))
      .filter((row) => row.url !== ''),
  };
}

/** The media library's choices for a post's recording, and the address it has now. */
export interface EnclosureChoices {
  /** Audio and video uploads, newest first. */
  media: { url: string; label: string }[];
  /** Upload addresses a transcript can be. */
  transcripts: string[];
}

/**
 * What the editor offers to choose from.
 *
 * A post whose file has since gone from the library keeps it as a choice of
 * its own, so opening the editor never quietly drops a recording; saving it
 * says what is wrong.
 */
export async function enclosureChoices(
  contentDir: string,
  current: string,
): Promise<EnclosureChoices> {
  const files = await listUploads(contentDir);
  const media = files
    .filter((file) => file.kind === 'audio' || file.kind === 'video')
    .map((file) => ({ url: file.url, label: file.path }));
  if (current !== '' && !media.some((file) => file.url === current)) {
    media.unshift({ url: current, label: `${current} (not in the media library)` });
  }
  return {
    media,
    transcripts: files
      .filter((file) => transcriptTypeFor(file.extension) !== undefined)
      .map((file) => file.url),
  };
}
