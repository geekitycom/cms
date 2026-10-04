import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { ResolvedConfig } from '../config.ts';
import { matchesSignature, UPLOAD_MEDIA_TYPES } from '../content/media.ts';
import { stripMetadata } from '../content/metadata/index.ts';
import { generateImageVariants, removeImageVariants } from '../images/variants.ts';
import type { ImageConfig } from '../images/variants.ts';
import { UPLOAD_ASSET_PREFIX, UPLOAD_DIRECTORY } from '../web/assets.ts';
import { fetchPublic } from './fetch-public.ts';
import type { HostLookup } from './public-address.ts';

/**
 * A cited page's picture, copied into the site (TASK-252, decision-19).
 *
 * A reader's browser never asks the cited site or its CDN for it, and a post
 * keeps its picture after the original goes away. The copy takes the guarded
 * fetch and the upload pipeline's checks: its first bytes must be an image
 * format the site knows, its metadata is stripped, and its variants are
 * derived like an upload's.
 */

/** `photo` when the cited page is the picture (an oEmbed photo), else a `thumbnail` of it. */
export type CitedPictureKind = 'photo' | 'thumbnail';

/** A picture a cited page names, still on its own host. */
export interface PictureSource {
  readonly url: string;
  readonly kind: CitedPictureKind;
  readonly video?: true;
}

/** A cited page's picture as the reply contexts file keeps it. */
export interface CitedPicture {
  /** Its public path, under {@link CITED_PICTURE_PREFIX}. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly kind: CitedPictureKind;
  /** Whether it is a video's thumbnail, which a theme marks with a play sign. */
  readonly video?: true;
}

/** The directory under `content/uploads/` the copies live in. */
export const CITED_PICTURE_DIRECTORY = 'cited';

/** The public path every copy's `src` starts with. */
export const CITED_PICTURE_PREFIX = `${UPLOAD_ASSET_PREFIX}${CITED_PICTURE_DIRECTORY}/`;

/** How long one picture is given to arrive. */
export const CITED_PICTURE_TIMEOUT_MS = 10_000;

/** What copying a picture needs: where uploads go, and the limit an upload is held to. */
export type CitedPictureConfig = ImageConfig & Pick<ResolvedConfig, 'uploadMaxBytes'>;

/** The image formats a copy may be, by the extension it is stored with. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.gif', '.webp', '.avif'] as const;

/**
 * Copy a picture into `content/uploads/cited/`, or `undefined` when it cannot
 * be: unreachable, not public, not an image the site knows, or bigger than the
 * site's upload limit. The file is named after a hash of its stripped bytes,
 * so copying the same picture twice writes it once.
 */
export async function copyCitedPicture(
  source: PictureSource,
  options: {
    readonly lookup: HostLookup;
    readonly config: CitedPictureConfig;
    readonly timeoutMs?: number | undefined;
  },
): Promise<CitedPicture | undefined> {
  const fetched = await fetchPublic(source.url, {
    lookup: options.lookup,
    timeoutMs: options.timeoutMs ?? CITED_PICTURE_TIMEOUT_MS,
    maxBytes: options.config.uploadMaxBytes,
    accept: 'image/avif, image/webp, image/png, image/gif, image/jpeg;q=0.9',
    contentType: { pattern: /^\s*image\//i, name: 'an image' },
  });
  if (!fetched.ok) return undefined;

  const extension = IMAGE_EXTENSIONS.find((candidate) => {
    const media = UPLOAD_MEDIA_TYPES.get(candidate);
    return media !== undefined && matchesSignature(media, fetched.body);
  });
  if (extension === undefined) return undefined;

  let bytes: Uint8Array;
  let size: { width: number; height: number } | undefined;
  try {
    bytes = stripMetadata(extension, fetched.body).bytes;
    size = await uprightSize(bytes);
  } catch {
    return undefined;
  }
  if (size === undefined) return undefined;

  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}${extension}`;
  const directory = path.join(options.config.contentDir, UPLOAD_DIRECTORY, CITED_PICTURE_DIRECTORY);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, name), bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  try {
    await generateImageVariants(options.config, `${CITED_PICTURE_DIRECTORY}/${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Copied ${name} but could not derive its variants: ${message}`);
  }

  return {
    src: `${CITED_PICTURE_PREFIX}${name}`,
    ...size,
    kind: source.kind,
    ...(source.video === true ? { video: true } : {}),
  };
}

/** The size a reader sees: orientations 5 to 8 turn the picture on its side. */
async function uprightSize(
  bytes: Uint8Array,
): Promise<{ width: number; height: number } | undefined> {
  const metadata = await sharp(bytes).metadata();
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  if (width === undefined || height === undefined) return undefined;
  return (metadata.orientation ?? 1) >= 5 ? { width: height, height: width } : { width, height };
}

/**
 * Delete every copy under `content/uploads/cited/` that `kept` does not name,
 * with its variants. Run whenever an entry may have dropped its picture, and
 * when the site starts, so a copy left by a crash goes too.
 */
export async function sweepCitedPictures(
  config: ImageConfig,
  kept: ReadonlySet<string>,
): Promise<void> {
  const directory = path.join(config.contentDir, UPLOAD_DIRECTORY, CITED_PICTURE_DIRECTORY);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  for (const name of names) {
    if (kept.has(`${CITED_PICTURE_PREFIX}${name}`)) continue;
    const source = `${CITED_PICTURE_DIRECTORY}/${name}`;
    await removeImageVariants(config, source);
    await rm(path.join(directory, name), { force: true });
  }
}

/**
 * Whether a citation shows its page's picture in full: a repost of a photo
 * does, since the photo is what was reposted. Anything else shows a thumbnail
 * beside the citation's title.
 */
export function shownInFull(property: string, picture: CitedPicture): boolean {
  return property === 'repost-of' && picture.kind === 'photo';
}

/** A picture as the file holds it, or `undefined` when the entry is not one. */
export function parseCitedPicture(value: unknown): CitedPicture | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  const { src, width, height, kind } = fields;
  if (
    typeof src !== 'string' ||
    !src.startsWith(CITED_PICTURE_PREFIX) ||
    src.slice(CITED_PICTURE_PREFIX.length).includes('/') ||
    !positiveInteger(width) ||
    !positiveInteger(height) ||
    (kind !== 'photo' && kind !== 'thumbnail')
  ) {
    return undefined;
  }
  return { src, width, height, kind, ...(fields['video'] === true ? { video: true } : {}) };
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
