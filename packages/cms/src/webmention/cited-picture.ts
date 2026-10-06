import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { ResolvedConfig } from '../config.ts';
import { citedImageAlt, citesAnImage } from '../content/citation.ts';
import type { Document } from '../content/document.ts';
import { matchesSignature, UPLOAD_MEDIA_TYPES } from '../content/media.ts';
import { stripMetadata } from '../content/metadata/index.ts';
import { generateImageVariants, removeImageVariants } from '../images/variants.ts';
import type { ImageConfig } from '../images/variants.ts';
import { UPLOAD_ASSET_PREFIX, UPLOAD_DIRECTORY } from '../web/assets.ts';
import { fetchPublic } from './fetch-public.ts';
import type { HostLookup } from './public-address.ts';
import type { ReplyContext } from './reply-context.ts';

/** `photo` when the cited page is the picture (an oEmbed photo), else a `thumbnail` of it. */
export type CitedPictureKind = 'photo' | 'thumbnail';

export interface PictureSource {
  readonly url: string;
  readonly kind: CitedPictureKind;
  readonly video?: true;
}

/** An image a cited page names, copied into the site: its picture, or its author's photo. */
export interface CitedImage {
  /** Its public path, under {@link CITED_PICTURE_PREFIX}. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** A cited page's picture as the reply contexts file keeps it. */
export interface CitedPicture extends CitedImage {
  readonly kind: CitedPictureKind;
  /** Whether it is a video's thumbnail, which a theme marks with a play sign. */
  readonly video?: true;
}

export const CITED_PICTURE_DIRECTORY = 'cited';

export const CITED_PICTURE_PREFIX = `${UPLOAD_ASSET_PREFIX}${CITED_PICTURE_DIRECTORY}/`;

export const CITED_PICTURE_TIMEOUT_MS = 10_000;

export type CitedPictureConfig = ImageConfig & Pick<ResolvedConfig, 'uploadMaxBytes'>;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.gif', '.webp', '.avif'] as const;

interface CopyOptions {
  readonly lookup: HostLookup;
  readonly config: CitedPictureConfig;
  readonly timeoutMs?: number | undefined;
}

export async function copyCitedPicture(
  source: PictureSource,
  options: CopyOptions,
): Promise<CitedPicture | undefined> {
  const image = await copyCitedImage(source.url, options);
  if (image === undefined) return undefined;
  return { ...image, kind: source.kind, ...(source.video === true ? { video: true } : {}) };
}

export async function copyCitedImage(
  url: string,
  options: CopyOptions,
): Promise<CitedImage | undefined> {
  const fetched = await fetchPublic(url, {
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

  return { src: `${CITED_PICTURE_PREFIX}${name}`, ...size };
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

export function shownInFull(property: string, picture: Pick<CitedPicture, 'kind'>): boolean {
  return property === 'repost-of' && picture.kind === 'photo';
}

export function citedPictureAlt(
  property: string,
  context: ReplyContext,
  document: Pick<Document, 'extra' | 'title'>,
): string {
  if (context.picture === undefined || !shownInFull(property, context.picture)) return '';
  return citesAnImage(context) ? citedImageAlt(document) : (context.name ?? '');
}

export function parseCitedPicture(value: unknown): CitedPicture | undefined {
  const image = parseCitedImage(value);
  if (image === undefined) return undefined;
  const fields = value as Record<string, unknown>;
  const { kind } = fields;
  if (kind !== 'photo' && kind !== 'thumbnail') return undefined;
  return { ...image, kind, ...(fields['video'] === true ? { video: true } : {}) };
}

export function parseCitedImage(value: unknown): CitedImage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { src, width, height } = value as Record<string, unknown>;
  if (
    typeof src !== 'string' ||
    !src.startsWith(CITED_PICTURE_PREFIX) ||
    src.slice(CITED_PICTURE_PREFIX.length).includes('/') ||
    !positiveInteger(width) ||
    !positiveInteger(height)
  ) {
    return undefined;
  }
  return { src, width, height };
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
