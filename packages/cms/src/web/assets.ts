import { createReadStream, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

/** URL prefix the theme's own files are served under. */
export const THEME_ASSET_PREFIX = '/theme/';

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

/** How long a browser may keep an upload. A day: the bytes at a URL never change. */
export const UPLOAD_ASSET_MAX_AGE = 86400;

/** One file under `content/uploads/`, or `undefined`. */
export function findUpload(relative: string, contentDir: string): StaticAsset | undefined {
  return findAsset(relative, [path.join(contentDir, UPLOAD_DIRECTORY)]);
}

/** Directory inside a theme that holds the files served over HTTP. */
export const THEME_STATIC_DIR = 'static';

/** How long a browser may keep a theme asset. One hour. */
export const THEME_ASSET_MAX_AGE = 3600;

/** A file on disk, located and described, ready to be served. */
export interface StaticAsset {
  /** Absolute path on disk. */
  file: string;
  /** Size and modification time, for the validators. */
  stats: Stats;
  /** Media type, from the extension. */
  contentType: string;
  /** Strong-looking validator over size and mtime. */
  etag: string;
}

/** A theme file. The theme's assets are ordinary {@link StaticAsset}s. */
export type ThemeAsset = StaticAsset;

/**
 * Find one file under a list of roots, first root that has it winning.
 *
 * Returns `undefined` when the request escapes its root, names a directory, or
 * matches nothing. Traversal is checked after resolution rather than by
 * inspecting the request, so an encoded `..` cannot slip past.
 */
export function findAsset(relative: string, roots: string[]): StaticAsset | undefined {
  const normalized = normalizeAssetPath(relative);
  if (normalized === undefined) return undefined;

  for (const directory of roots) {
    const root = path.resolve(directory);
    const file = path.resolve(root, normalized);

    // `path.resolve` has already collapsed every `..`; anything that landed
    // outside the root was trying to get out.
    if (file !== root && !file.startsWith(root + path.sep)) continue;

    let stats: Stats;
    try {
      stats = statSync(file);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;

    return {
      file,
      stats,
      contentType: contentTypeFor(file),
      etag: `"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`,
    };
  }

  return undefined;
}

/**
 * Find one asset under the `static/` directory of each theme on a search path,
 * the same order templates resolve in.
 *
 * The path comes from `themeSearchPath`, so an asset and a layout are always
 * read from the same themes.
 */
export function findThemeAsset(
  relative: string,
  themeDirs: readonly string[],
): ThemeAsset | undefined {
  return findAsset(
    relative,
    themeDirs.map((themeDir) => path.join(themeDir, THEME_STATIC_DIR)),
  );
}

/** How long a browser may keep an asset, when the caller does not say. */
export interface AssetResponseOptions {
  /** Seconds. Defaults to {@link THEME_ASSET_MAX_AGE}. */
  maxAge?: number | undefined;
}

/** The response body and headers for an asset. */
export function assetResponse(asset: StaticAsset, options: AssetResponseOptions = {}): Response {
  const body = Readable.toWeb(createReadStream(asset.file)) as ReadableStream;
  return new Response(body, { headers: assetHeaders(asset, options) });
}

/** The 304 an unchanged asset gets, which carries the validators and no body. */
export function assetNotModified(asset: StaticAsset, options: AssetResponseOptions = {}): Response {
  const headers = assetHeaders(asset, options);
  headers.delete('content-length');
  headers.delete('content-type');
  return new Response(null, { status: 304, headers });
}

/** {@link assetResponse} at the theme's cache lifetime. */
export function themeAssetResponse(asset: ThemeAsset): Response {
  return assetResponse(asset);
}

/** {@link assetNotModified} at the theme's cache lifetime. */
export function themeAssetNotModified(asset: ThemeAsset): Response {
  return assetNotModified(asset);
}

/** Whether a request's `If-None-Match` covers this asset. */
export function matchesEtag(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  if (ifNoneMatch.trim() === '*') return true;
  return ifNoneMatch
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .includes(etag);
}

function assetHeaders(asset: StaticAsset, options: AssetResponseOptions): Headers {
  const maxAge = options.maxAge ?? THEME_ASSET_MAX_AGE;
  return new Headers({
    'content-type': asset.contentType,
    'content-length': String(asset.stats.size),
    'cache-control': `public, max-age=${String(maxAge)}`,
    'last-modified': new Date(asset.stats.mtimeMs).toUTCString(),
    etag: asset.etag,
  });
}

/**
 * A request path under an asset prefix as a path relative to the directory it
 * is served from, or `undefined` when it is not one worth looking up.
 */
function normalizeAssetPath(relative: string): string | undefined {
  if (relative === '' || relative.endsWith('/')) return undefined;
  if (relative.includes('\0')) return undefined;
  // A leading slash would make `path.resolve` ignore the theme directory.
  return relative.replace(/^\/+/, '');
}

/** Media types for what a theme actually ships. */
const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
]);

function contentTypeFor(file: string): string {
  return CONTENT_TYPES.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream';
}
