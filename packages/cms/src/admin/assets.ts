import { fileURLToPath } from 'node:url';

import { assetNotModified, assetResponse, findAsset, matchesEtag } from '../web/assets.ts';
import type { StaticAsset } from '../web/assets.ts';
import { ADMIN_PREFIX } from './session.ts';

/**
 * Where the admin's own files live: stylesheets and, later, whatever the
 * editor needs. Resolved from this module rather than the working directory,
 * like the templates beside them.
 */
export const ADMIN_STATIC_DIR: string = fileURLToPath(
  new URL('../../admin/static/', import.meta.url),
);

/**
 * URL prefix the admin's files are served under.
 *
 * The leading underscore keeps it out of the way of the screens: `/admin/posts`
 * is a screen and `/admin/_static/admin.css` never can be.
 */
export const ADMIN_ASSET_PREFIX = `${ADMIN_PREFIX}/_static/`;

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
export function adminAssetResponse(
  relative: string,
  ifNoneMatch: string | undefined,
): Response | undefined {
  const asset = findAdminAsset(relative);
  if (asset === undefined) return undefined;

  const options = { maxAge: ADMIN_ASSET_MAX_AGE };
  return matchesEtag(ifNoneMatch, asset.etag)
    ? assetNotModified(asset, options)
    : assetResponse(asset, options);
}
