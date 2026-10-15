/**
 * The post editor's photo rows (TASK-166): each photo's address and alt text,
 * as a form has them and as the front matter gets them.
 *
 * The rows are numbered, so a plain form with no script carries any number of
 * them; the editor adds a blank one to fill in, and a row whose address was
 * emptied is a photo taken out. An empty alt text leaves the photo to the
 * media library's (TASK-141), so a library picture is described in one place.
 */
import path from 'node:path';

import { rowIndexes, trimmedField } from '../util/forms.ts';
import { isRecord } from '../util/guards.ts';
import { absoluteUrl } from '../util/url.ts';
import type { Document } from './document.ts';
import { isUploadUrl, isWebUrl } from './enclosure.ts';
import type { EditorField, FieldError } from './form-error.ts';
import { UPLOAD_MEDIA_TYPES } from '../files/upload-types.ts';
import { PHOTO_FRONT_MATTER_KEY, photosOf } from './photo.ts';
import type { Photo } from './photo.ts';
import { findUpload, UPLOAD_ASSET_PREFIX } from './uploads.ts';

/** One photo's row, as the form has it. */
export interface PhotoRow {
  url: string;
  alt: string;
}

export const PHOTO_FIELDS = { url: 'photo-url-', alt: 'photo-alt-' } as const;

/** The photo rows out of a submitted form, in their numbered order, emptied ones gone. */
export function readPhotoForm(body: Readonly<Record<string, unknown>>): PhotoRow[] {
  return rowIndexes(body, PHOTO_FIELDS.url)
    .map((index) => ({
      url: trimmedField(body, `${PHOTO_FIELDS.url}${String(index)}`),
      alt: trimmedField(body, `${PHOTO_FIELDS.alt}${String(index)}`),
    }))
    .filter((row) => row.url !== '');
}

/**
 * A post's photos as the editor shows them.
 *
 * A hand-written entry the CMS cannot use still shows its address, so saving
 * the post says what is wrong with it rather than quietly deleting it.
 */
export function photoRows(document: Document): PhotoRow[] {
  const raw = document.extra[PHOTO_FRONT_MATTER_KEY];
  if (raw === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw]).map((entry: unknown) => {
    const [photo] = photosOf({ [PHOTO_FRONT_MATTER_KEY]: entry });
    if (photo !== undefined) return { url: photo.url, alt: photo.alt ?? '' };
    const url =
      typeof entry === 'string'
        ? entry
        : typeof entry === 'object' && entry !== null && 'url' in entry
          ? String(entry.url)
          : '';
    return { url, alt: '' };
  });
}

/** The photos to write, or why one of them cannot be. */
export function resolvePhotos(
  rows: readonly PhotoRow[],
  contentDir: string,
): { photos: Photo[] } | FieldError {
  const photos: Photo[] = [];
  for (const [index, row] of rows.entries()) {
    const field: EditorField = `editor-photo-url-${String(index)}`;
    if (isUploadUrl(row.url)) {
      const media = UPLOAD_MEDIA_TYPES.get(path.extname(row.url).toLowerCase());
      const file = findUpload(row.url.slice(UPLOAD_ASSET_PREFIX.length), contentDir);
      if (media?.kind !== 'image' || file === undefined) {
        return { error: `The photo ${row.url} is not an image in the media library.`, field };
      }
    } else if (!isWebUrl(row.url)) {
      return {
        error: `A photo is an image in the media library or an address starting https://, not ${row.url}.`,
        field,
      };
    }
    photos.push(row.alt === '' ? { url: row.url } : { url: row.url, alt: row.alt });
  }
  return { photos };
}

export function photoRowFromMicropub(value: unknown, baseUrl: string): PhotoRow | undefined {
  let url: unknown = value;
  let alt: unknown = '';
  if (isRecord(value)) {
    ({ value: url, alt = '' } = value);
  }
  if (typeof url !== 'string' || typeof alt !== 'string' || !isWebUrl(url.trim())) return undefined;
  const uploads = absoluteUrl(UPLOAD_ASSET_PREFIX, baseUrl);
  const address = url.trim();
  return {
    url: address.startsWith(uploads)
      ? `${UPLOAD_ASSET_PREFIX}${address.slice(uploads.length)}`
      : address,
    alt: alt.trim(),
  };
}

export function photoToMicropub({ url, alt }: PhotoRow, baseUrl: string): unknown {
  const value = url.startsWith('/') ? absoluteUrl(url, baseUrl) : url;
  return alt === '' ? value : { value, alt };
}
