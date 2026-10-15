import type { Context, Next } from 'hono';

import {
  findUpload,
  isStripTemporary,
  UPLOAD_ASSET_PREFIX,
  VARIANT_ASSET_PREFIX,
} from '../content/uploads.ts';
import type { GeekityEnv } from './env.ts';
import { FAVICON_FILE, iconSetting, siteIconSource } from '../images/icons.ts';
import { sourceVersion } from '../images/paths.ts';
import { findImageVariant } from '../images/variants.ts';
import {
  ASSET_VERSION_PARAM,
  assetNotModified,
  assetRangeResponse,
  assetResponse,
  assetVersion,
  findThemeAsset,
  IMMUTABLE_ASSET,
  matchesEtag,
  THEME_ASSET_PREFIX,
  UPLOAD_ASSET_MAX_AGE,
} from '../theme/assets.ts';
import { notFound, requestPath } from './request.ts';

/**
 * A file from the theme's `static/` directory, the site's copy first.
 *
 * Assets are cacheable and validated, so a browser that already has one pays a
 * conditional request rather than a download. A URL whose `v` is the hash of
 * the bytes being served, which is what the `asset` filter writes, is cached
 * for a year without revalidation. Any other `v`, or none, gets the short
 * lifetime: a stale hash from a cached page still gets the file, but the
 * current bytes are never pinned under a name that describes older ones.
 */
export function themeAsset(c: Context<GeekityEnv>): Response {
  const relative = requestPath(c).slice(THEME_ASSET_PREFIX.length);
  const asset = findThemeAsset(relative, c.var.renderer.themeDirs());
  if (asset === undefined) return notFound(c);

  const fingerprinted = c.req.query(ASSET_VERSION_PARAM) === assetVersion(asset);
  const options = fingerprinted ? IMMUTABLE_ASSET : {};
  return matchesEtag(c.req.header('if-none-match'), asset.etag)
    ? assetNotModified(asset, options)
    : assetResponse(asset, options);
}

/**
 * One derived copy of an upload, generated on the spot if it is not there.
 *
 * The directory these live in is disposable (decision-9): deleting it costs
 * the next reader of each picture one encode and costs the site nothing else,
 * which is what this handler is for. A width or a format the site does not
 * offer is a 404 and encodes nothing, so the URL space cannot be used to make
 * the server work.
 *
 * A variant is cached for a year without revalidation only when its `v` is
 * the hash of the upload it was derived from, which is what the page markup
 * and the icon links write. The name alone cannot promise that: deleting an
 * upload frees its name for different bytes. Any other `v`, or none, as in a
 * page cached before URLs carried one, still gets the file, for a day.
 */
export async function imageVariant(c: Context<GeekityEnv>): Promise<Response> {
  const relative = decodeVariantPath(requestPath(c).slice(VARIANT_ASSET_PREFIX.length));
  const asset = await findImageVariant(c.var.config, relative);
  if (asset === undefined) return notFound(c);

  const source = relative.slice(0, relative.lastIndexOf('/'));
  const version = sourceVersion(c.var.config, source);
  const fingerprinted = version !== undefined && c.req.query(ASSET_VERSION_PARAM) === version;
  const options = fingerprinted ? IMMUTABLE_ASSET : { maxAge: UPLOAD_ASSET_MAX_AGE };
  return matchesEtag(c.req.header('if-none-match'), asset.etag)
    ? assetNotModified(asset, options)
    : assetResponse(asset, options);
}

/**
 * `/favicon.ico`, derived from the site's icon beside its other icons.
 *
 * Its URL carries no version, so it is cached like an upload rather than for
 * a year: a site that changes its icon is seen with the new one within a day.
 */
export async function favicon(c: Context<GeekityEnv>): Promise<Response> {
  const source = siteIconSource(c.var.config, iconSetting(c.var.renderer.site()));
  if (source === undefined) return notFound(c);

  const asset = await findImageVariant(c.var.config, `${source}/${FAVICON_FILE}`);
  if (asset === undefined) return notFound(c);

  const options = { maxAge: UPLOAD_ASSET_MAX_AGE };
  return matchesEtag(c.req.header('if-none-match'), asset.etag)
    ? assetNotModified(asset, options)
    : assetResponse(asset, options);
}

/** A request path as a path on disk: percent-encoding off, segment by segment. */
function decodeVariantPath(relative: string): string {
  try {
    return relative.split('/').map(decodeURIComponent).join('/');
  } catch {
    return relative;
  }
}

/**
 * A file from `content/uploads/`, at the URL Eleventy's passthrough copy puts
 * it at.
 *
 * Uploads are not documents — the index never sees them — so they are served
 * as files, with the same validators and the same traversal check the theme's
 * assets get. The cache lifetime is longer than a theme asset's because an
 * upload's URL names one set of bytes: the upload endpoint never overwrites,
 * it suffixes.
 *
 * A path with no file behind it is not answered here (TASK-377): it goes on to
 * the not-found handler, so an upload that moved can be led on by
 * `redirect_from` or a declared redirect, which never shadow a file that is
 * there. A metadata sweep's temporary file is the exception and 404s.
 */
export async function upload(c: Context<GeekityEnv>, next: Next): Promise<Response | undefined> {
  const relative = requestPath(c).slice(UPLOAD_ASSET_PREFIX.length);
  if (isStripTemporary(relative)) return notFound(c);
  const asset = findUpload(relative, c.var.config.contentDir);
  if (asset === undefined) {
    await next();
    return undefined;
  }

  const options = { maxAge: UPLOAD_ASSET_MAX_AGE };
  if (matchesEtag(c.req.header('if-none-match'), asset.etag)) {
    return assetNotModified(asset, options);
  }
  const part = assetRangeResponse(asset, c.req.header('range'), c.req.header('if-range'), options);
  const whole = part ?? assetResponse(asset, options);
  whole.headers.set('accept-ranges', 'bytes');
  return whole;
}
