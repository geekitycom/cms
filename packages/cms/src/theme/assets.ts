import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

import { findAsset } from '../files/static-files.ts';
import type { StaticAsset } from '../files/static-files.ts';

/** URL prefix the theme's own files are served under. */
export const THEME_ASSET_PREFIX = '/theme/';

/** How long a browser may keep an upload. A day: the bytes at a URL never change. */
export const UPLOAD_ASSET_MAX_AGE = 86400;

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

/** A theme file. The theme's assets are ordinary {@link StaticAsset}s. */
export type ThemeAsset = StaticAsset;

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
  return new Response(fileBody(asset, 0, asset.stats.size - 1), {
    headers: assetHeaders(asset, options),
  });
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
  return new Response(fileBody(asset, start, end), { status: 206, headers });
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

const CHUNK_BYTES = 64 * 1024;

/**
 * The bytes `start` to `end` of an asset, inclusive, read from the file only
 * once something reads the body.
 *
 * A body that is never read, as for a HEAD request or a client that goes
 * away first, never opens the file, and a cancelled one closes it: a
 * descriptor held by an abandoned stream is not given back until the process
 * exits. The file is checked against the stat the headers came from as it is
 * opened, so a file replaced in between fails the response rather than
 * sending bytes its headers do not describe.
 */
function fileBody(asset: StaticAsset, start: number, end: number): ReadableStream<Uint8Array> {
  let handle: FileHandle | undefined;
  let position = start;

  async function close(): Promise<void> {
    const current = handle;
    handle = undefined;
    await current?.close();
  }

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          handle ??= await openDescribed(asset);
          const length = Math.min(CHUNK_BYTES, end + 1 - position);
          if (length > 0) {
            const { bytesRead, buffer } = await handle.read(
              new Uint8Array(length),
              0,
              length,
              position,
            );
            if (bytesRead === 0) throw new Error(`${asset.file} ended before its stated length`);
            position += bytesRead;
            controller.enqueue(buffer.subarray(0, bytesRead));
          }
          if (position > end) {
            await close();
            controller.close();
          }
        } catch (error) {
          await close();
          throw error;
        }
      },
      cancel: close,
    },
    { highWaterMark: 0 },
  );
}

async function openDescribed(asset: StaticAsset): Promise<FileHandle> {
  const handle = await open(asset.file, 'r');
  const opened = await handle.stat();
  const { stats } = asset;
  if (
    opened.dev !== stats.dev ||
    opened.ino !== stats.ino ||
    opened.size !== stats.size ||
    opened.mtimeMs !== stats.mtimeMs
  ) {
    await handle.close();
    throw new Error(`${asset.file} changed after its headers were written`);
  }
  return handle;
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
