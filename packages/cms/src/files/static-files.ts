import { statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';

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
