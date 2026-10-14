import path from 'node:path';

import { findAsset } from '../files/static-files.ts';
import type { StaticAsset } from '../files/static-files.ts';
import { STRIP_TEMPORARY_SUFFIX } from './metadata/sweep.ts';

/**
 * URL prefix uploads are served under, and the content subdirectory they live
 * in. They are the same word on purpose: doc's Eleventy config copies
 * `content/uploads/` through to `/uploads/`, so a Markdown link the editor
 * writes has to resolve to the same URL whether the site is being served by the
 * CMS or built by Eleventy.
 */
export const UPLOAD_ASSET_PREFIX = '/uploads/';

/** The content subdirectory {@link UPLOAD_ASSET_PREFIX} is served from. */
export const UPLOAD_DIRECTORY = 'uploads';

/** One file under `content/uploads/`, or `undefined`, as for a metadata sweep's temporary file. */
export function findUpload(relative: string, contentDir: string): StaticAsset | undefined {
  if (relative.toLowerCase().endsWith(STRIP_TEMPORARY_SUFFIX)) return undefined;
  return findAsset(relative, [path.join(contentDir, UPLOAD_DIRECTORY)]);
}

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
