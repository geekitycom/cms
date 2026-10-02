/**
 * A post's photos (TASK-166): what Micropub's `photo` property carries, each
 * one an address with optional alt text.
 *
 * ```yaml
 * photo:
 *   - url: /uploads/2026/10/beach.jpg
 *     alt: Waves breaking at dusk
 *   - url: https://cdn.example.com/dog.jpg
 * ```
 *
 * Like `enclosure`, it stays in {@link Document.extra}: {@link photosOf} is the
 * one reading of it, and the theme, the federation and Post Type Discovery
 * read only what it returns.
 */
// Types only: the image modules load the image encoder, which Post Type
// Discovery, and so everything that asks a post its type, must not.
import type { AltTextLibrary } from '../images/alt-text.ts';
import { UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import { isUploadUrl, isWebUrl } from './enclosure.ts';

/** The front matter key the photos are under, Micropub's property name. */
export const PHOTO_FRONT_MATTER_KEY = 'photo';

/** One photo, read from the front matter. */
export interface Photo {
  /** An upload's site-relative URL, or an absolute `http` or `https` one. */
  url: string;
  /** What the post says the photo shows. Absent leaves it to the media library. */
  alt?: string | undefined;
}

/**
 * The photos a post's front matter lists, in its order.
 *
 * A bare address reads as a photo with no alt text, and a single photo need
 * not be in a list. An entry whose address is neither an upload nor a web
 * address is dropped on its own, so one bad line costs that photo only.
 */
export function photosOf(extra: Readonly<Record<string, unknown>>): Photo[] {
  const raw = extra[PHOTO_FRONT_MATTER_KEY];
  if (raw === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw]).flatMap((entry) => photoOf(entry) ?? []);
}

/** Whether an address is one a photo can have: an upload or a web address. */
export function isPhotoUrl(value: string): boolean {
  return isUploadUrl(value) || isWebUrl(value);
}

/** The photos as the front matter spells them: no alt that nobody gave. */
export function photoFrontMatter(photos: readonly Photo[]): Record<string, string>[] {
  return photos.map((photo) =>
    photo.alt === undefined ? { url: photo.url } : { url: photo.url, alt: photo.alt },
  );
}

/**
 * The alt text a photo is shown with: its own, else what the media library
 * says about the upload (TASK-141), which is empty for a decorative one. So a
 * library picture is described once, in the library, rather than in every
 * post that shows it. `undefined` when nobody has described it.
 */
export function photoAlt(photo: Photo, library: AltTextLibrary): string | undefined {
  if (photo.alt !== undefined) return photo.alt;
  const described = isUploadUrl(photo.url)
    ? library.get(photo.url.slice(UPLOAD_ASSET_PREFIX.length))
    : undefined;
  if (described === undefined) return undefined;
  return described.kind === 'described' ? described.text : '';
}

function photoOf(value: unknown): Photo | undefined {
  if (typeof value === 'string') {
    const url = value.trim();
    return isPhotoUrl(url) ? { url } : undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { url, alt } = value as Record<string, unknown>;
  if (typeof url !== 'string' || !isPhotoUrl(url.trim())) return undefined;
  const text = typeof alt === 'string' ? alt.trim() : '';
  return text === '' ? { url: url.trim() } : { url: url.trim(), alt: text };
}
