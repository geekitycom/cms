import path from 'node:path';

import { UPLOAD_ASSET_PREFIX } from '../content/uploads.ts';

/**
 * The extensions an icon may be derived from.
 *
 * Wider than the responsive variants' set — an SVG has no pixels to resize but
 * rasterises to a square perfectly well, and only the first frame of a GIF was
 * ever going to be a favicon — and narrower than "anything sharp might open",
 * so a site whose icon setting points at a PDF links no icons rather than
 * three that 404.
 */
export const ICON_SOURCES: ReadonlySet<string> = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
]);

export function parseIconSetting(
  setting: string,
): { source: string } | { problem: 'not-an-upload' | 'not-an-image' } {
  if (!setting.startsWith(UPLOAD_ASSET_PREFIX)) return { problem: 'not-an-upload' };

  const relative = setting.slice(UPLOAD_ASSET_PREFIX.length);
  if (relative === '' || relative.includes('..')) return { problem: 'not-an-upload' };
  if (!ICON_SOURCES.has(path.extname(relative).toLowerCase())) return { problem: 'not-an-image' };

  // The setting holds a URL and the lookup wants a path, so whatever the
  // upload endpoint encoded comes off again here.
  try {
    return { source: relative.split('/').map(decodeURIComponent).join('/') };
  } catch {
    return { problem: 'not-an-upload' };
  }
}
