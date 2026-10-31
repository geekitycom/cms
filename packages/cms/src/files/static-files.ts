import { realpathSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';

import { servedType, UPLOAD_MEDIA_TYPES } from './upload-types.ts';

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
    if (!within(root, file)) continue;

    let stats: Stats;
    try {
      stats = statSync(file);
      if (!stats.isFile() || !within(realpathSync(root), realpathSync(file))) continue;
    } catch {
      continue;
    }

    return {
      file,
      stats,
      contentType: contentTypeFor(file),
      etag: `"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`,
    };
  }

  return undefined;
}

function within(root: string, file: string): boolean {
  return file === root || file.startsWith(root + path.sep);
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

const THEME_CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.webmanifest', 'application/manifest+json'],
]);

function contentTypeFor(file: string): string {
  const extension = path.extname(file).toLowerCase();
  const upload = UPLOAD_MEDIA_TYPES.get(extension);
  if (upload !== undefined) return servedType(upload);
  return THEME_CONTENT_TYPES.get(extension) ?? 'application/octet-stream';
}
