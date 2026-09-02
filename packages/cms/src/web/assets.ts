import { createReadStream, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { PACKAGED_THEME_DIR } from './templates.ts';

/** URL prefix the theme's own files are served under. */
export const THEME_ASSET_PREFIX = '/theme/';

/** Directory inside a theme that holds the files served over HTTP. */
export const THEME_STATIC_DIR = 'static';

/** How long a browser may keep a theme asset. One hour. */
export const THEME_ASSET_MAX_AGE = 3600;

/** A theme file, located and described. */
export interface ThemeAsset {
  /** Absolute path on disk. */
  file: string;
  /** Size and modification time, for the validators. */
  stats: Stats;
  /** Media type, from the extension. */
  contentType: string;
  /** Strong-looking validator over size and mtime. */
  etag: string;
}

/**
 * Find one asset, site theme first and packaged theme second, the same order
 * templates resolve in.
 *
 * Returns `undefined` when the request escapes the theme directory, names a
 * directory, or matches nothing. Traversal is checked after resolution rather
 * than by inspecting the request, so an encoded `..` cannot slip past.
 */
export function findThemeAsset(relative: string, themeDirs: string[]): ThemeAsset | undefined {
  const normalized = normalizeAssetPath(relative);
  if (normalized === undefined) return undefined;

  for (const themeDir of themeDirs) {
    const root = path.resolve(themeDir, THEME_STATIC_DIR);
    const file = path.resolve(root, normalized);

    // `path.resolve` has already collapsed every `..`; anything that landed
    // outside the theme's static directory was trying to get out.
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

/** The theme directories to search, in order: the site's, then the package's. */
export function themeSearchPath(siteThemeDir: string): string[] {
  return [siteThemeDir, PACKAGED_THEME_DIR];
}

/** The response body and headers for an asset. */
export function themeAssetResponse(asset: ThemeAsset): Response {
  const body = Readable.toWeb(createReadStream(asset.file)) as ReadableStream;
  return new Response(body, { headers: themeAssetHeaders(asset) });
}

/** The 304 an unchanged asset gets, which carries the validators and no body. */
export function themeAssetNotModified(asset: ThemeAsset): Response {
  const headers = themeAssetHeaders(asset);
  headers.delete('content-length');
  headers.delete('content-type');
  return new Response(null, { status: 304, headers });
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

function themeAssetHeaders(asset: ThemeAsset): Headers {
  return new Headers({
    'content-type': asset.contentType,
    'content-length': String(asset.stats.size),
    'cache-control': `public, max-age=${String(THEME_ASSET_MAX_AGE)}`,
    'last-modified': new Date(asset.stats.mtimeMs).toUTCString(),
    etag: asset.etag,
  });
}

/**
 * A request path under `/theme/` as a path relative to a theme's `static/`
 * directory, or `undefined` when it is not one worth looking up.
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
