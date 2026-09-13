import { statSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import type { Sharp } from 'sharp';

import { writeFileAtomically } from '../files/atomic.ts';
import { findAsset } from '../web/assets.ts';
import type { StaticAsset } from '../web/assets.ts';
import { deriveSiteIcon, iconSize } from './icons.ts';
import { derivedDir, sourceFile, IMAGE_DIRECTORY, VARIANT_ASSET_PREFIX } from './paths.ts';
import type { ImageConfig } from './paths.ts';

/**
 * Image variants: the derived copies of an upload, and the record of them.
 *
 * The original under `content/uploads/` is the only source of truth
 * (decision-10). Everything this module writes lives under
 * `<dataDir>/images/<the upload's path>/`, is rebuildable from that original,
 * and may be deleted at any moment — which is also decision-9's rule for
 * `data/`. Nothing here is ever read by the feeds or by a remote instance;
 * only the site's own HTML knows these files exist.
 *
 * Where the files live is `paths.ts`, and the site's icons are `icons.ts`:
 * both kinds of derived file share the directory and the URL prefix.
 */

export { IMAGE_DIRECTORY, VARIANT_ASSET_PREFIX } from './paths.ts';
export type { ImageConfig } from './paths.ts';

/** The sidecar that records what was derived, beside the files it describes. */
export const IMAGE_RECORD_NAME = 'image.json';

/** One derived copy of an upload. */
export interface ImageVariant {
  /** Its width in pixels, which is also what the `srcset` descriptor says. */
  width: number;
  /** Its height, so a caller never has to open the file to know the shape. */
  height: number;
  /** One of {@link KNOWN_IMAGE_FORMATS}. */
  format: string;
  /** Its filename inside the source's derived directory, e.g. `640.webp`. */
  file: string;
}

/**
 * What was derived from one upload, and the intrinsic size of the upload
 * itself.
 *
 * This is the sidecar's shape. It exists so that rendering a page never opens
 * an image: decision-10 requires the dimensions to be recorded when the
 * variants are generated and read back, never probed per request.
 */
export interface ImageRecord {
  /** The upload it was derived from, relative to `content/uploads/`. */
  source: string;
  /** The original's width once its EXIF orientation has been applied. */
  width: number;
  /** The original's height, likewise. */
  height: number;
  /** The original's own format, which is the one the `<img>` falls back to. */
  format: string;
  /**
   * The original's modification time in milliseconds.
   *
   * It is what makes a stale record notice it is stale. The CMS never
   * overwrites an upload — a second `photo.png` becomes `photo-2.png` — but a
   * file dropped in by hand can be replaced, and a record that outlived its
   * original would give the page the wrong dimensions.
   */
  sourceModified: number;
  /** Every derived copy, by format in configured order and then by width. */
  variants: ImageVariant[];
}

/** The extension each format is written with. */
const FORMAT_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['avif', '.avif'],
  ['jpeg', '.jpg'],
  ['png', '.png'],
  ['webp', '.webp'],
]);

/** The media type each format is announced as, for a `<source type>`. */
const FORMAT_MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  ['avif', 'image/avif'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);

/**
 * The formats an upload's own extension means, and so the ones a source may
 * be. GIF is deliberately absent: an animated one cannot survive being resized
 * into a still, and a still one gains nothing that WebP would not lose in
 * translation, so a GIF is stored and served exactly as it arrived.
 */
const SOURCE_FORMATS: ReadonlyMap<string, string> = new Map([
  ['.avif', 'avif'],
  ['.jpeg', 'jpeg'],
  ['.jpg', 'jpeg'],
  ['.png', 'png'],
  ['.webp', 'webp'],
]);

/** The media type a `<source>` for this format announces, or `undefined`. */
export function imageMediaType(format: string): string | undefined {
  return FORMAT_MEDIA_TYPES.get(format);
}

/** The public URL of one derived file. */
export function variantUrl(source: string, variant: ImageVariant): string {
  return `${VARIANT_ASSET_PREFIX}${source}/${variant.file}`;
}

/**
 * Records already read, by the derived directory they were read from.
 *
 * A page render asks for one of these per image, so the sidecar is parsed once
 * per process rather than once per request. The entry survives the sidecar
 * being deleted on purpose: the derived directory is disposable and a request
 * for a missing variant rebuilds it, so a page whose images have been swept
 * away still renders the markup that asks for them back.
 */
const records = new Map<string, ImageRecord>();

/** Generations already running, so two requests for one image encode it once. */
const generating = new Map<string, Promise<ImageRecord | undefined>>();

/**
 * Derive every variant of one upload and record what was derived.
 *
 * Returns `undefined` — having written nothing — when optimization is off,
 * when the file is not a raster image the CMS varianties (a GIF, a PDF, a
 * text file), when it is animated, or when it is not there at all. None of
 * those is an error: an upload that has no variants is the ordinary case for
 * most of what a site holds, and the caller's job is to fall back to the
 * original, which is exactly what it would have served anyway.
 *
 * Two callers asking for the same image at once share one encode.
 */
export function generateImageVariants(
  config: ImageConfig,
  source: string,
): Promise<ImageRecord | undefined> {
  const directory = derivedDir(config, source);
  const running = generating.get(directory);
  if (running !== undefined) return running;

  const started = derive(config, source, directory).finally(() => generating.delete(directory));
  generating.set(directory, started);
  return started;
}

async function derive(
  config: ImageConfig,
  source: string,
  directory: string,
): Promise<ImageRecord | undefined> {
  if (!config.imageOptimization) return undefined;

  const sourceFormat = SOURCE_FORMATS.get(path.extname(source).toLowerCase());
  if (sourceFormat === undefined) return undefined;

  const file = sourceFile(config, source);
  if (file === undefined) return undefined;

  let modified: number;
  try {
    modified = Math.trunc(statSync(file).mtimeMs);
  } catch {
    return undefined;
  }

  const metadata = await sharp(file).metadata();
  const stored = { width: metadata.width, height: metadata.height };
  if (stored.width === undefined || stored.height === undefined) return undefined;
  // An animated WebP or AVIF is the GIF case wearing another extension: sharp
  // would flatten it to its first frame, which is not what anybody uploaded.
  if ((metadata.pages ?? 1) > 1) return undefined;

  // `metadata()` reports the pixels as stored; orientations 5 to 8 turn the
  // picture on its side, so the size a reader sees is the transposed one. It
  // is that size the widths are chosen against and that size the `<img>`
  // advertises, because it is the one the browser will lay out.
  const upright = (metadata.orientation ?? 1) >= 5;
  const width = upright ? stored.height : stored.width;
  const height = upright ? stored.width : stored.height;

  const variants: ImageVariant[] = [];
  await mkdir(directory, { recursive: true });

  for (const format of outputFormats(config, sourceFormat)) {
    for (const target of outputWidths(config, width)) {
      variants.push(await encode({ file, directory, format, width: target }));
    }
  }

  const record: ImageRecord = {
    source,
    width,
    height,
    format: sourceFormat,
    sourceModified: modified,
    variants,
  };
  await writeFileAtomically(path.join(directory, IMAGE_RECORD_NAME), `${JSON.stringify(record)}\n`);
  records.set(directory, record);
  return record;
}

/**
 * The formats to write: the site's, then the original's own.
 *
 * The original's is last and never optional, because it is the `<img>` inside
 * the `<picture>` — the thing a browser that understood none of the `<source>`
 * elements falls back to.
 */
function outputFormats(config: ImageConfig, sourceFormat: string): string[] {
  const formats = config.imageFormats.filter((format) => format !== sourceFormat);
  return [...formats, sourceFormat];
}

/**
 * The widths to write: the configured ones narrower than the original, and the
 * original's own width.
 *
 * Nothing is ever upscaled — a browser given a blown-up copy pays for pixels
 * that carry no detail — and the full size is always there, so a wide display
 * has something to pick that is not the unoptimised original.
 */
function outputWidths(config: ImageConfig, width: number): number[] {
  const widths = new Set(config.imageWidths.filter((candidate) => candidate < width));
  widths.add(width);
  return [...widths].sort((a, b) => a - b);
}

/** Write one variant and answer what it turned out to be. */
async function encode(input: {
  file: string;
  directory: string;
  format: string;
  width: number;
}): Promise<ImageVariant> {
  const extension = FORMAT_EXTENSIONS.get(input.format) ?? '.bin';
  const name = `${String(input.width)}${extension}`;

  // `autoOrient` applies the EXIF rotation, and sharp drops metadata unless
  // asked to keep it, so the variant comes out the right way up and carrying
  // no camera, no timestamp and no location.
  const pipeline = sharp(input.file, { autoOrient: true }).resize({
    width: input.width,
    withoutEnlargement: true,
  });

  const encoded = await formatted(pipeline, input.format).toBuffer({ resolveWithObject: true });
  await writeFileAtomically(path.join(input.directory, name), encoded.data);

  return {
    width: encoded.info.width,
    height: encoded.info.height,
    format: input.format,
    file: name,
  };
}

/** The encoder for one format, at settings that trade a little fidelity for a lot of bytes. */
function formatted(pipeline: Sharp, format: string): Sharp {
  switch (format) {
    case 'avif':
      return pipeline.avif({ quality: 55 });
    case 'jpeg':
      return pipeline.jpeg({ quality: 80, mozjpeg: true });
    case 'png':
      return pipeline.png({ compressionLevel: 9 });
    default:
      return pipeline.webp({ quality: 80 });
  }
}

/**
 * What is known about one upload's variants, or `undefined` when nothing is.
 *
 * Synchronous and cached, because it is called once per image while a page
 * renders. `undefined` means the caller should serve the plain original: the
 * upload is not an image, or nothing has been derived from it yet.
 */
export function describeImage(config: ImageConfig, source: string): ImageRecord | undefined {
  const directory = derivedDir(config, source);

  const remembered = records.get(directory);
  if (remembered !== undefined) return current(config, remembered) ? remembered : undefined;

  const record = readRecord(path.join(directory, IMAGE_RECORD_NAME), source);
  if (record === undefined) return undefined;

  records.set(directory, record);
  return current(config, record) ? record : undefined;
}

/**
 * Whether a record still describes the file it was derived from.
 *
 * The original having gone, or having been replaced under the same name,
 * makes the record rubbish; anything else — including the whole derived
 * directory having been swept away — leaves it true, which is what lets a page
 * keep rendering the markup that asks for the variants back.
 */
function current(config: ImageConfig, record: ImageRecord): boolean {
  const file = sourceFile(config, record.source);
  if (file === undefined) return false;
  try {
    return Math.trunc(statSync(file).mtimeMs) === record.sourceModified;
  } catch {
    return false;
  }
}

/** Parse one sidecar, refusing anything that is not the shape it should be. */
function readRecord(file: string, source: string): ImageRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const candidate = parsed as Partial<ImageRecord>;
  if (
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number' ||
    typeof candidate.format !== 'string' ||
    typeof candidate.sourceModified !== 'number' ||
    !Array.isArray(candidate.variants)
  ) {
    return undefined;
  }

  return {
    source,
    width: candidate.width,
    height: candidate.height,
    format: candidate.format,
    sourceModified: candidate.sourceModified,
    variants: candidate.variants.filter(
      (variant): variant is ImageVariant =>
        typeof variant.width === 'number' &&
        typeof variant.height === 'number' &&
        typeof variant.format === 'string' &&
        typeof variant.file === 'string',
    ),
  };
}

/**
 * Take one upload's derived files away.
 *
 * Forgiving by design: an upload with nothing derived from it is the ordinary
 * case, and this runs after the original has already gone, so refusing to
 * finish would leave the site worse than it found it.
 */
export async function removeImageVariants(config: ImageConfig, source: string): Promise<void> {
  if (sourceFile(config, source) === undefined) return;

  const directory = derivedDir(config, source);
  records.delete(directory);
  await rm(directory, { recursive: true, force: true });
}

/**
 * Find one derived file by its request path, generating it if it is not there.
 *
 * `relative` is what follows {@link VARIANT_ASSET_PREFIX}, so
 * `2026/09/photo.jpg/640.webp`. A request for a file that was swept away
 * rebuilds the whole set for that source and then serves it, which is what
 * makes the derived directory disposable in the way decision-9 requires. A
 * request for a width or a format the site does not offer is a 404 and encodes
 * nothing, so nobody can make the server work by asking for sizes.
 */
export async function findImageVariant(
  config: ImageConfig,
  relative: string,
): Promise<StaticAsset | undefined> {
  const root = path.join(config.dataDir, IMAGE_DIRECTORY);

  const found = findAsset(relative, [root]);
  if (found !== undefined) return found;

  if (!config.imageOptimization) return undefined;

  const cut = relative.lastIndexOf('/');
  if (cut <= 0) return undefined;
  const source = relative.slice(0, cut);
  const name = relative.slice(cut + 1);

  // The site's icons live beside the widths and are derived one at a time,
  // because they are asked for one at a time and belong in no `srcset`.
  const icon = iconSize(name);
  if (icon !== undefined) {
    return (await deriveSiteIcon(config, source, icon)) ? findAsset(relative, [root]) : undefined;
  }

  const known = describeImage(config, source);
  if (known !== undefined && !known.variants.some((variant) => variant.file === name)) {
    return undefined;
  }

  const record = await generateImageVariants(config, source);
  if (record === undefined || !record.variants.some((variant) => variant.file === name)) {
    return undefined;
  }

  return findAsset(relative, [root]);
}
