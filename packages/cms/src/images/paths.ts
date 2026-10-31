import path from 'node:path';

import type { ResolvedConfig } from '../config.ts';
import { UPLOAD_DIRECTORY } from '../content/uploads.ts';
import { IMAGES, dataPath } from '../files/data-files.ts';
import { findAsset } from '../files/static-files.ts';
import { assetVersion, ASSET_VERSION_PARAM } from '../theme/assets.ts';

/**
 * Where a derived image comes from and where it goes.
 *
 * Its own file because both kinds of derived file need it — the widths in
 * `variants.ts` and the site's icons in `icons.ts` — and one of those has to
 * be able to ask the other to derive a file without the two importing each
 * other.
 */

/** The part of the config the derived images are derived according to. */
export type ImageConfig = Pick<
  ResolvedConfig,
  'contentDir' | 'dataDir' | 'imageOptimization' | 'imageWidths' | 'imageFormats'
>;

/**
 * The most pixels a derived image is decoded from: a 60 megapixel camera's
 * full frame, and well under sharp's own default. A flat PNG of a few hundred
 * kilobytes can declare far more, and decoding it costs memory in proportion.
 */
export const MAX_INPUT_PIXELS = 60_000_000;

/** sharp's input options for a picture the site derives from. */
export const DECODE_OPTIONS = { autoOrient: true, limitInputPixels: MAX_INPUT_PIXELS } as const;

/** Whether a header's dimensions are within {@link MAX_INPUT_PIXELS}. */
export function decodable(size: { width: number; height: number }): boolean {
  return size.width * size.height <= MAX_INPUT_PIXELS;
}

/** One upload as the files derived from it know it. */
export interface Upload {
  /** Its path under `content/uploads/`, `/`-separated, spelled the one way the directory spells it. */
  readonly source: string;
  /** The upload on disk. */
  readonly file: string;
  /** Where the files derived from it live. */
  readonly directory: string;
}

/**
 * The upload a source path names, or `undefined` when it names none.
 *
 * The source is rebuilt from the resolved file, so however a caller spelled
 * it, a record and the URLs built from it carry the canonical path.
 */
export function locateUpload(config: ImageConfig, source: string): Upload | undefined {
  const file = sourceFile(config, source);
  if (file === undefined) return undefined;
  const segments = path
    .relative(path.resolve(config.contentDir, UPLOAD_DIRECTORY), file)
    .split(path.sep);
  return {
    source: segments.join('/'),
    file,
    directory: dataPath(config.dataDir, IMAGES, ...segments),
  };
}

/**
 * The upload as an absolute path, or `undefined` when it is not one.
 *
 * A source path can arrive off a URL, so containment is checked after
 * resolution rather than by inspecting the string — the rule `findAsset`
 * applies to every other request for a file.
 */
export function sourceFile(
  config: Pick<ImageConfig, 'contentDir'>,
  source: string,
): string | undefined {
  if (source === '' || source.includes('\0')) return undefined;
  const root = path.resolve(config.contentDir, UPLOAD_DIRECTORY);
  const file = path.resolve(root, source);
  return file.startsWith(root + path.sep) ? file : undefined;
}

/**
 * A short hash of the upload's bytes, or `undefined` when it is not there.
 *
 * A derived file's URL carries it, because the name alone does not pin the
 * bytes: deleting an upload frees its name, and a different picture uploaded
 * under it would otherwise inherit URLs browsers were told never to refetch.
 * Memoised on size and mtime like a theme asset's, so a render pays a `stat`.
 */
export function sourceVersion(config: ImageConfig, source: string): string | undefined {
  const asset = findAsset(source, [path.join(config.contentDir, UPLOAD_DIRECTORY)]);
  return asset === undefined ? undefined : assetVersion(asset);
}

/** A derived file's URL with the source's version on it, when there is one. */
export function versioned(href: string, version: string | undefined): string {
  return version === undefined ? href : `${href}?${ASSET_VERSION_PARAM}=${version}`;
}
