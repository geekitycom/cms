import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
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

/** How long a browser may keep a theme asset at its unhashed URL. One hour. */
export const THEME_ASSET_MAX_AGE = 3600;

/**
 * How long a browser may keep a file whose URL names its bytes. A year, the
 * longest lifetime HTTP caches are asked to honour.
 */
export const IMMUTABLE_ASSET_MAX_AGE = 31536000;

/** The query parameter a fingerprinted theme asset URL carries its hash in. */
export const ASSET_VERSION_PARAM = 'v';

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
export function findAsset(relative: string, roots: readonly string[]): StaticAsset | undefined {
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
  /** Whether the bytes at this URL can never change, so a browser need not revalidate. */
  immutable?: boolean | undefined;
}

/** The lifetime of a response whose URL names its bytes. */
export const IMMUTABLE_ASSET: AssetResponseOptions = {
  maxAge: IMMUTABLE_ASSET_MAX_AGE,
  immutable: true,
};

const versions = new Map<string, { etag: string; version: string }>();

/**
 * A short hash of an asset's bytes, the part of a fingerprinted URL that
 * changes when the file does.
 *
 * Memoised per file on the size-and-mtime validator, so a page pays a `stat`
 * rather than a read, and an edit in place is seen on the next render with no
 * restart and no watcher.
 */
export function assetVersion(asset: StaticAsset): string {
  const known = versions.get(asset.file);
  if (known?.etag === asset.etag) return known.version;

  const version = createHash('sha256').update(readFileSync(asset.file)).digest('hex').slice(0, 12);
  versions.set(asset.file, { etag: asset.etag, version });
  return version;
}

/**
 * The URL a theme should link one of its files at: under
 * {@link THEME_ASSET_PREFIX} with a hash of the bytes the search path resolves
 * to, so it can be cached for a year and still change the moment the file
 * does. A file no theme has gets its plain URL, which will 404 as it would
 * have anyway.
 */
export function themeAssetUrl(relative: string, themeDirs: readonly string[]): string {
  const pathname = `${THEME_ASSET_PREFIX}${relative.replace(/^\/+/, '')}`;
  const asset = findThemeAsset(relative, themeDirs);
  if (asset === undefined) return pathname;
  return `${pathname}?${ASSET_VERSION_PARAM}=${assetVersion(asset)}`;
}

/** The response body and headers for an asset. */
export function assetResponse(asset: StaticAsset, options: AssetResponseOptions = {}): Response {
  const body = Readable.toWeb(createReadStream(asset.file)) as ReadableStream;
  return new Response(body, { headers: assetHeaders(asset, options) });
}

/**
 * Part of an asset, for a request that asked for one byte range of it.
 *
 * Audio and video are why this exists: Safari will not play a file whose
 * server does not answer a range request, and every player seeks by asking
 * for the bytes at the new position rather than downloading the whole
 * episode first. One range is all a player asks for, so a header naming
 * several, or one that cannot be read, gets the whole file, which is what
 * HTTP allows a server that ignores `Range` to send. So does a request whose
 * `If-Range` no longer names this file: its earlier part was of other bytes.
 *
 * Returns `undefined` when the whole file is the answer.
 */
export function assetRangeResponse(
  asset: StaticAsset,
  range: string | undefined,
  ifRange: string | undefined,
  options: AssetResponseOptions = {},
): Response | undefined {
  if (range === undefined) return undefined;
  if (ifRange !== undefined && ifRange.trim() !== asset.etag) return undefined;

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match === null) return undefined;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return undefined;

  if (first !== '' && last !== '' && Number(last) < Number(first)) return undefined;

  const size = asset.stats.size;
  // `bytes=-500` is the last five hundred bytes; `bytes=500-` is all but the first five hundred.
  const start = first === '' ? Math.max(0, size - Number(last)) : Number(first);
  const end = first === '' || last === '' ? size - 1 : Math.min(Number(last), size - 1);

  const headers = assetHeaders(asset, options);
  headers.set('accept-ranges', 'bytes');
  if (start >= size) {
    headers.delete('content-type');
    headers.set('content-length', '0');
    headers.set('content-range', `bytes */${String(size)}`);
    return new Response(null, { status: 416, headers });
  }

  headers.set('content-length', String(end - start + 1));
  headers.set('content-range', `bytes ${String(start)}-${String(end)}/${String(size)}`);
  const body = Readable.toWeb(createReadStream(asset.file, { start, end })) as ReadableStream;
  return new Response(body, { status: 206, headers });
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
  const immutable = options.immutable === true ? ', immutable' : '';
  return new Headers({
    'content-type': asset.contentType,
    'content-length': String(asset.stats.size),
    'cache-control': `public, max-age=${String(maxAge)}${immutable}`,
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

/** Media types for what a theme ships and what the upload endpoint accepts. */
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
  // A `<track>` is ignored unless its file is served as `text/vtt`.
  ['.vtt', 'text/vtt; charset=utf-8'],
  ['.srt', 'application/x-subrip; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.ogg', 'audio/ogg'],
  ['.oga', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.webmanifest', 'application/manifest+json'],
]);

function contentTypeFor(file: string): string {
  return CONTENT_TYPES.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream';
}
