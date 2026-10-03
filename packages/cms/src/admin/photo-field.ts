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

import type { Document } from '../content/document.ts';
import { isUploadUrl, isWebUrl } from '../content/enclosure.ts';
import { UPLOAD_MEDIA_TYPES } from '../content/media.ts';
import { PHOTO_FRONT_MATTER_KEY, photosOf } from '../content/photo.ts';
import type { Photo } from '../content/photo.ts';
import type { AltTextLibrary } from '../images/alt-text.ts';
import { uploadPath } from '../images/markup.ts';
import { findUpload, UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import { listUploads } from './media.ts';
import type { EditorField, FieldError } from './editor-layout.ts';

/** One photo's row, as the form has it. */
export interface PhotoRow {
  url: string;
  alt: string;
}

/** The form field name prefixes; a row's index follows each. */
export const PHOTO_FIELDS = { url: 'photo-url-', alt: 'photo-alt-' } as const;

/** The empty row the editor adds so a form with no script can add a photo. */
export const BLANK_PHOTO_ROW: PhotoRow = { url: '', alt: '' };

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

/** The photo rows out of a submitted form, in their numbered order, emptied ones gone. */
export function readPhotoForm(body: Record<string, unknown>): PhotoRow[] {
  const field = (name: string): string => (typeof body[name] === 'string' ? body[name] : '').trim();
  return Object.keys(body)
    .map((name) => new RegExp(`^${PHOTO_FIELDS.url}(\\d+)$`).exec(name)?.[1])
    .filter((index) => index !== undefined)
    .map(Number)
    .sort((left, right) => left - right)
    .map((index) => ({
      url: field(`${PHOTO_FIELDS.url}${String(index)}`),
      alt: field(`${PHOTO_FIELDS.alt}${String(index)}`),
    }))
    .filter((row) => row.url !== '');
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
