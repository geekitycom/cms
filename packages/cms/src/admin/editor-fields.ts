import { transcriptTypeFor } from '../content/enclosure-form.ts';
import type { AlternateRow } from '../content/enclosure-form.ts';
import type { LocationForm } from '../content/location-form.ts';
import { isLibraryImage } from '../content/photo-form.ts';
import type { PhotoRow } from '../content/photo-form.ts';
import { readAltTexts } from '../content/alt-text.ts';
import { uploadPath } from '../content/image-tags.ts';
import { thumbnailUrl } from '../images/variants.ts';
import type { ImageConfig } from '../images/variants.ts';
import { listUploads } from '../media/library.ts';
import { trimmedField } from '../util/forms.ts';

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

/** A photo row as the editor prints it: the library's alt text to show when the row has none, and a tile of it. */
export interface PhotoRowView extends PhotoRow {
  libraryAlt: string;
  /** A small copy of a library image; unset for a web address, which the admin's policy will not load. */
  thumbnail: string | undefined;
}

/** A library image the post does not have yet, as a tick box numbered after the rows. */
export interface PhotoPick {
  url: string;
  thumbnail: string;
  alt: string;
  /** The row number it submits as when ticked: `photo-url-{index}`. */
  index: number;
}

/** The Photos block: the post's photos, the library to pick from, and a row for a web address. */
export interface PhotoPicker {
  rows: PhotoRowView[];
  picks: PhotoPick[];
  /** The number of the empty row for a web address, after every pick. */
  blank: number;
  /** Every image upload, newest first, for the address boxes to complete from. */
  choices: string[];
}

/**
 * A tile of an image in the media library, or `undefined` for anything else:
 * the admin's policy loads no picture from another site.
 */
export function libraryThumbnail(
  config: ImageConfig & { contentDir: string },
  url: string,
): string | undefined {
  const source = uploadPath(url);
  if (source === undefined || !isLibraryImage(url, config.contentDir)) return undefined;
  return thumbnailUrl(config, source, url);
}

/** How many of the newest library images the picker offers; the address box reaches the rest. */
const PICKS = 18;

/**
 * The photo picker for these rows. A ticked pick submits as one more row, so
 * a form with no script adds library photos by its own numbering, each with
 * the library's alt text until somebody writes one.
 */
export async function photoPicker(
  config: ImageConfig & { contentDir: string },
  rows: readonly PhotoRow[],
): Promise<PhotoPicker> {
  const images = (await listUploads(config.contentDir)).filter((file) => file.kind === 'image');
  const library = readAltTexts(config.contentDir);
  const views = rows.map((row) => {
    const source = uploadPath(row.url);
    const described = source === undefined ? undefined : library.get(source);
    return {
      ...row,
      libraryAlt: described?.kind === 'described' ? described.text : '',
      thumbnail: libraryThumbnail(config, row.url),
    };
  });
  const taken = new Set(rows.map((row) => row.url));
  const picks = images
    .filter((file) => !taken.has(file.url))
    .slice(0, PICKS)
    .map((file, n) => ({
      url: file.url,
      thumbnail: thumbnailUrl(config, file.path, file.url),
      alt: file.alt?.kind === 'described' ? file.alt.text : '',
      index: rows.length + n,
    }));
  return {
    rows: views,
    picks,
    blank: rows.length + picks.length,
    choices: images.map((file) => file.url),
  };
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
