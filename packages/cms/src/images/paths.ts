import path from 'node:path';

import type { ResolvedConfig } from '../config.ts';
import { UPLOAD_ASSET_PREFIX, UPLOAD_DIRECTORY } from '../web/assets.ts';

/**
 * Where a derived image comes from and where it goes.
 *
 * Its own file because both kinds of derived file need it — the widths in
 * `variants.ts` and the site's icons in `icons.ts` — and one of those has to
 * be able to ask the other to derive a file without the two importing each
 * other.
 */

/** The directory under `dataDir` that holds every derived image. */
export const IMAGE_DIRECTORY = 'images';

/**
 * URL prefix the derived files are served under.
 *
 * It sits inside `/uploads/` rather than beside it so a site's asset host, its
 * cache rules and its Eleventy passthrough only ever have to know about one
 * path. `_` cannot collide with a real upload: the CMS files uploads under
 * `{yyyy}/{mm}/`, and Eleventy — like the CMS's own content walk — ignores
 * underscore-prefixed directories anyway.
 */
export const VARIANT_ASSET_PREFIX = `${UPLOAD_ASSET_PREFIX}_/`;

/** The part of the config the derived images are derived according to. */
export type ImageConfig = Pick<
  ResolvedConfig,
  'contentDir' | 'dataDir' | 'imageOptimization' | 'imageWidths' | 'imageFormats'
>;

/** The derived directory for one upload. */
export function derivedDir(config: ImageConfig, source: string): string {
  return path.join(config.dataDir, IMAGE_DIRECTORY, ...source.split('/'));
}

/**
 * The upload as an absolute path, or `undefined` when it is not one.
 *
 * A source path can arrive off a URL, so containment is checked after
 * resolution rather than by inspecting the string — the rule `findAsset`
 * applies to every other request for a file.
 */
export function sourceFile(config: ImageConfig, source: string): string | undefined {
  if (source === '' || source.includes('\0')) return undefined;
  const root = path.resolve(config.contentDir, UPLOAD_DIRECTORY);
  const file = path.resolve(root, source);
  return file.startsWith(root + path.sep) ? file : undefined;
}
