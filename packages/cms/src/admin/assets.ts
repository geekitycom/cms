import { fileURLToPath } from 'node:url';

import { findAsset } from '../files/static-files.ts';
import type { StaticAsset } from '../files/static-files.ts';
import { assetReply } from '../theme/assets.ts';

/**
 * Where the admin's own files live: the compiled stylesheet, the admin bar's
 * stylesheet and script, and the editor's bundle and helpers. Resolved from
 * this module rather than the working directory, like the templates beside
 * them.
 */
export const ADMIN_STATIC_DIR: string = fileURLToPath(
  new URL('../../admin/static/', import.meta.url),
);

/** How long a browser may keep an admin asset. One hour, as for a theme's. */
export const ADMIN_ASSET_MAX_AGE = 3600;

/** One file under {@link ADMIN_STATIC_DIR}, or `undefined`. */
export function findAdminAsset(relative: string): StaticAsset | undefined {
  return findAsset(relative, [ADMIN_STATIC_DIR]);
}

/**
 * Answer a request for an admin asset.
 *
 * Returns `undefined` when there is no such file, so the caller can fall
 * through to whatever it does with an unknown URL.
 */
export function adminAssetResponse(relative: string, request: Headers): Response | undefined {
  const asset = findAdminAsset(relative);
  if (asset === undefined) return undefined;

  const options = { maxAge: ADMIN_ASSET_MAX_AGE };
  return assetReply(asset, request, options);
}
