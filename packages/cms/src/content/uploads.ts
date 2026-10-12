import path from 'node:path';

import { findAsset } from '../files/static-files.ts';
import type { StaticAsset } from '../files/static-files.ts';

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

/** One file under `content/uploads/`, or `undefined`. */
export function findUpload(relative: string, contentDir: string): StaticAsset | undefined {
  return findAsset(relative, [path.join(contentDir, UPLOAD_DIRECTORY)]);
}
