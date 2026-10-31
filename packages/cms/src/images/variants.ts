import { statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import type { Metadata, OutputInfo, Sharp } from 'sharp';

import { writeFileAtomically } from '../files/atomic.ts';
import type { StaticAsset } from '../files/static-files.ts';
import { messageOf } from '../util/errors.ts';
import { encodePath, plainRelativePath } from '../util/url.ts';
import {
  deriveSet,
  findDerivedFile,
  forgetDerivedSets,
  settleDerivedSets,
  settledSet,
} from './derived-sets.ts';
import type { DerivedKind } from './derived-sets.ts';
import { isDerivedIcon, SITE_ICONS } from './icons.ts';
import { DECODE_OPTIONS, decodable, locateUpload, sourceVersion, versioned } from './paths.ts';
import { VARIANT_ASSET_PREFIX } from '../content/uploads.ts';
import type { ImageConfig, Upload } from './paths.ts';

/**
 * Image variants: the derived copies of an upload, and the record of them.
 *
 * The original under `content/uploads/` is the only source of truth. Everything
 * this module writes lives under `<dataDir>/images/<the upload's path>/`, is
 * rebuildable from that original, and may be deleted at any moment — which is
 * also the rule for anything derived under `data/`. Nothing here is ever read
 * by the feeds or by a remote instance; only the site's own HTML knows these
 * files exist.
 *
 * Where the files live is `paths.ts`, and the site's icons are `icons.ts`:
 * both kinds of derived file share the directory and the URL prefix.
 */

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
 * The sidecar holds it with the version of the bytes it was derived from. It
 * exists so that rendering a page never opens an image: the dimensions are
 * recorded when the variants are generated and read back, never probed per
 * request.
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
  /** The original's modification time in milliseconds when it was derived from. */
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

/**
 * A record as a page renders it: what was derived, and the hash of the
 * original's bytes that every derived URL carries.
 */
export interface DescribedImage extends ImageRecord {
  /** See {@link sourceVersion}. Without it a derived URL is served for a day, not a year. */
  version?: string | undefined;
}

/** A derived file, and the version of the upload's bytes it was derived from. */
export interface DerivedAsset extends StaticAsset {
  version: string;
}

/** The public URL of one derived file, naming the original's bytes when `version` is given. */
export function variantUrl(source: string, variant: ImageVariant, version?: string): string {
  return versioned(`${VARIANT_ASSET_PREFIX}${encodePath(`${source}/${variant.file}`)}`, version);
}

/** The widths kind of derived set, recorded in `image.json`. */
function widths(config: ImageConfig): DerivedKind<ImageRecord> {
  return {
    sidecar: IMAGE_RECORD_NAME,
    parse: parseRecord,
    derive: (upload) => deriveWidths(config, upload),
    offers: async (upload, name) =>
      (await planWidths(config, upload))?.targets.some((target) => target.file === name) === true,
    holds: (record, name) => record.variants.some((variant) => variant.file === name),
  };
}

/**
 * The upload a source names and the version of its bytes, when it is one the
 * widths can be derived from at all: GIF is not, and nor is anything that is
 * not there.
 */
function widthSource(
  config: ImageConfig,
  source: string,
): { upload: Upload; version: string } | undefined {
  if (!SOURCE_FORMATS.has(path.extname(source).toLowerCase())) return undefined;
  const upload = locateUpload(config, source);
  if (upload === undefined) return undefined;
  const version = sourceVersion(config, upload.source);
  return version === undefined ? undefined : { upload, version };
}

/**
 * Derive every variant of one upload and record what was derived, unless the
 * bytes it holds now have been derived already.
 *
 * Returns `undefined` when optimization is off, when the file is not a raster
 * image the CMS derives from (a GIF, a PDF, a text file), when it is animated,
 * larger than {@link MAX_INPUT_PIXELS}, undecodable, or not there at all. None
 * of those is an error: an upload that has no variants is the ordinary case
 * for most of what a site holds, and the caller falls back to the original,
 * which is what it would have served anyway. A source that could not be
 * derived is remembered as such until its bytes change. A failure to make
 * the directory or write a file is thrown, because it is the server failing
 * and not the upload.
 *
 * Two callers asking for the same image at once share one encode.
 */
export async function generateImageVariants(
  config: ImageConfig,
  source: string,
): Promise<ImageRecord | undefined> {
  if (!config.imageOptimization) return undefined;
  const found = widthSource(config, source);
  if (found === undefined) return undefined;
  const kind = widths(config);
  const known = settledSet(kind, found.upload, found.version);
  return known === undefined ? deriveSet(kind, found.upload, found.version) : known.set;
}

/**
 * Wait for every derivation still running under one site's data directory.
 *
 * A render starts derivation in the background and returns, so an encode can
 * outlive the request that asked for it and, without this, the site it was
 * writing into: closing a site waits here so nothing is left writing under
 * `dataDir` once close returns.
 */
export async function settleImageVariants(config: Pick<ImageConfig, 'dataDir'>): Promise<void> {
  await settleDerivedSets(config.dataDir);
}

/** Every width and format one upload's set holds, as encodable targets. */
interface WidthPlan {
  width: number;
  height: number;
  format: string;
  sourceModified: number;
  targets: { format: string; width: number; file: string }[];
}

/**
 * What would be derived from one upload, read off its header alone, or
 * `undefined` when nothing would.
 */
async function planWidths(config: ImageConfig, upload: Upload): Promise<WidthPlan | undefined> {
  const format = SOURCE_FORMATS.get(path.extname(upload.source).toLowerCase());
  if (format === undefined) return undefined;

  let modified: number;
  let metadata: Metadata;
  try {
    modified = Math.trunc(statSync(upload.file).mtimeMs);
    metadata = await sharp(upload.file, DECODE_OPTIONS).metadata();
  } catch {
    return undefined;
  }
  const stored = { width: metadata.width, height: metadata.height };
  if (stored.width === undefined || stored.height === undefined) return undefined;
  if (!decodable({ width: stored.width, height: stored.height })) return undefined;
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

  const targets = outputFormats(config, format).flatMap((output) =>
    outputWidths(config, output, width, height).map((target) => ({
      format: output,
      width: target,
      file: `${String(target)}${FORMAT_EXTENSIONS.get(output) ?? '.bin'}`,
    })),
  );
  return { width, height, format, sourceModified: modified, targets };
}

async function deriveWidths(config: ImageConfig, upload: Upload): Promise<ImageRecord | undefined> {
  const plan = await planWidths(config, upload);
  if (plan === undefined) return undefined;

  await mkdir(upload.directory, { recursive: true });
  const variants: ImageVariant[] = [];
  for (const target of plan.targets) {
    let encoded: { data: Buffer; info: OutputInfo };
    try {
      encoded = await encode(upload.file, target);
    } catch (error) {
      console.warn(`Could not derive image variants for ${upload.source}: ${messageOf(error)}`);
      return undefined;
    }
    await writeFileAtomically(path.join(upload.directory, target.file), encoded.data);
    variants.push({
      width: encoded.info.width,
      height: encoded.info.height,
      format: target.format,
      file: target.file,
    });
  }

  return {
    source: upload.source,
    width: plan.width,
    height: plan.height,
    format: plan.format,
    sourceModified: plan.sourceModified,
    variants,
  };
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

/** The largest width or height each encoder can write. PNG has no such limit. */
const FORMAT_MAX_DIMENSIONS: ReadonlyMap<string, number> = new Map([
  ['avif', 16384],
  ['jpeg', 65500],
  ['webp', 16383],
]);

/**
 * The widths to write in one format: the configured ones narrower than the
 * original, and the original's own width, or as near it as the format can go.
 *
 * Nothing is ever upscaled — a browser given a blown-up copy pays for pixels
 * that carry no detail — and the full size is always there, so a wide display
 * has something to pick that is not the unoptimised original. A panorama
 * wider or taller than the encoder allows gets its widest copy at the limit.
 */
function outputWidths(
  config: ImageConfig,
  format: string,
  width: number,
  height: number,
): number[] {
  const limit = FORMAT_MAX_DIMENSIONS.get(format) ?? Infinity;
  const widest = Math.min(width, limit, Math.floor((width * limit) / height));
  if (widest < 1) return [];
  const widths = new Set(config.imageWidths.filter((candidate) => candidate < widest));
  widths.add(widest);
  return [...widths].sort((a, b) => a - b);
}

/** Encode one variant. A throw here is sharp failing on the source's pixels. */
async function encode(
  file: string,
  target: { format: string; width: number },
): Promise<{ data: Buffer; info: OutputInfo }> {
  // `autoOrient` applies the EXIF rotation, and sharp drops metadata unless
  // asked to keep it, so the variant comes out the right way up and carrying
  // no camera, no timestamp and no location.
  const pipeline = sharp(file, DECODE_OPTIONS).resize({
    width: target.width,
    withoutEnlargement: true,
  });
  return formatted(pipeline, target.format).toBuffer({ resolveWithObject: true });
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
 * upload is not an image, nothing has been derived from the bytes it holds
 * now, or nothing could be.
 */
export function describeImage(config: ImageConfig, source: string): DescribedImage | undefined {
  const found = widthSource(config, source);
  if (found === undefined) return undefined;
  const record = settledSet(widths(config), found.upload, found.version)?.set;
  return record === undefined ? undefined : { ...record, version: found.version };
}

/** Parse one sidecar's record, refusing anything that is not the shape it should be. */
function parseRecord(value: unknown, upload: Upload): ImageRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<ImageRecord>;
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
    source: upload.source,
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
 * Take one upload's derived files away, once any derivation writing them has
 * finished.
 *
 * Forgiving by design: an upload with nothing derived from it is the ordinary
 * case, and this runs after the original has already gone, so refusing to
 * finish would leave the site worse than it found it.
 */
export async function removeImageVariants(config: ImageConfig, source: string): Promise<void> {
  const upload = locateUpload(config, source);
  if (upload === undefined) return;
  await forgetDerivedSets(upload);
}

/**
 * Find one derived file by its request path, generating it if it is not there.
 *
 * `relative` is what follows {@link VARIANT_ASSET_PREFIX}, so
 * `2026/09/photo.jpg/640.webp`. A request for a file that was swept away
 * rebuilds the whole set for that source and then serves it, which is what
 * makes the derived directory disposable, as everything derived must be. A
 * request for a width or a format the site does not offer is a 404 and encodes
 * nothing, so nobody can make the server work by asking for sizes. An icon
 * name is answered only under `iconSource`, the site icon's upload. A file
 * whose upload has gone is answered with nothing and removed.
 *
 * The file comes back with the version of the bytes it was derived from, and
 * a set derived from older bytes is derived again first.
 */
export async function findImageVariant(
  config: ImageConfig,
  relative: string,
  iconSource?: string,
): Promise<DerivedAsset | undefined> {
  if (!config.imageOptimization || plainRelativePath(relative) === undefined) return undefined;
  const cut = relative.lastIndexOf('/');
  if (cut <= 0) return undefined;
  const upload = locateUpload(config, relative.slice(0, cut));
  if (upload === undefined) return undefined;
  const name = relative.slice(cut + 1);

  const version = sourceVersion(config, upload.source);
  if (version === undefined) {
    await forgetDerivedSets(upload);
    return undefined;
  }

  const icon = iconSource === undefined ? undefined : locateUpload(config, iconSource);
  const asset = !isDerivedIcon(name)
    ? await findDerivedFile(widths(config), upload, version, name)
    : icon?.source === upload.source
      ? await findDerivedFile(SITE_ICONS, upload, version, name)
      : undefined;
  return asset === undefined ? undefined : { ...asset, version };
}

const THUMBNAIL_WIDTH = 400;

export function thumbnailUrl(config: ImageConfig, source: string, url: string): string {
  const image = describeImage(config, source);
  const thumbnail = image?.variants
    .filter((variant) => variant.format === image.variants[0]?.format)
    .find((variant) => variant.width >= THUMBNAIL_WIDTH);
  return image !== undefined && thumbnail !== undefined
    ? variantUrl(image.source, thumbnail, image.version)
    : url;
}
