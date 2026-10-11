import { transcriptTypeFor } from '../content/enclosure-form.ts';
import type { AlternateRow } from '../content/enclosure-form.ts';
import type { LocationForm } from '../content/location-form.ts';
import type { PhotoRow } from '../content/photo-form.ts';
import type { AltTextLibrary } from '../images/alt-text.ts';
import { uploadPath } from '../images/markup.ts';
import { trimmedField } from '../util/forms.ts';
import { listUploads } from '../media/library.ts';

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

/** The empty row the editor adds so a form with no script can add a photo. */
export const BLANK_PHOTO_ROW: PhotoRow = { url: '', alt: '' };

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

/** The empty row the editor adds so a form with no script can add a version. */
export const BLANK_ALTERNATE_ROW: AlternateRow = {
  url: '',
  type: '',
  title: '',
  height: '',
  lang: '',
};

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
