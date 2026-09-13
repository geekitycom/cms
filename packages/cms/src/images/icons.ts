import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { writeFileAtomically } from '../files/atomic.ts';
import { UPLOAD_ASSET_PREFIX } from '../web/assets.ts';
import { derivedDir, sourceFile, VARIANT_ASSET_PREFIX } from './paths.ts';
import type { ImageConfig } from './paths.ts';

/**
 * The site's icons: the two favicons and the touch icon, derived from the
 * site's avatar.
 *
 * They are derived copies of an upload like every other file under
 * {@link VARIANT_ASSET_PREFIX} — rebuildable, disposable, never read by a feed
 * or a remote instance — but they are not `srcset` candidates, and they are
 * shaped differently on purpose. A responsive variant is a width and whatever
 * height the picture has; an icon is a square, because that is what
 * `<link rel="icon" sizes="32x32">` promises and what a browser draws in a
 * tab. So an icon is cropped to the middle of the avatar rather than scaled to
 * a width, is always a PNG whatever the site's formats are, and is named
 * `icon-32.png` rather than `32.png` so it can never be confused with the
 * width of that number.
 *
 * Nothing is derived until somebody asks: the head links three URLs, and the
 * first browser to follow one encodes it. That keeps the three sizes out of
 * every upload's variant set, where they would turn up in a `srcset` as
 * candidates nobody wants.
 */

/** One icon as the head links it. */
export interface SiteIcon {
  /** `icon` or `apple-touch-icon`. */
  rel: string;
  /** The `sizes` attribute, `32x32`. */
  sizes: string;
  /** Where the derived file is served, as a site-root path. */
  href: string;
}

/**
 * The icons a site offers, in the order the head lists them: the 32 and 16
 * pixel favicons and the 180 pixel touch icon Apple asks for.
 *
 * Three is the whole set. A site that wants a web manifest, a mask icon or a
 * tile colour writes them into its own theme's `head` block; the package links
 * what every browser reads and nothing that needs a second file to explain it.
 */
const ICONS: readonly { rel: string; size: number }[] = [
  { rel: 'icon', size: 32 },
  { rel: 'icon', size: 16 },
  { rel: 'apple-touch-icon', size: 180 },
];

/** What a derived icon is called inside its source's directory. */
const ICON_FILE = /^icon-(\d{1,4})\.png$/;

/**
 * The extensions an icon may be derived from.
 *
 * Wider than the responsive variants' set — an SVG has no pixels to resize but
 * rasterises to a square perfectly well, and only the first frame of a GIF was
 * ever going to be a favicon — and narrower than "anything sharp might open",
 * so a site whose avatar setting points at a PDF links no icons rather than
 * three that 404.
 */
const ICON_SOURCES: ReadonlySet<string> = new Set([
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

/** The name one size is derived under. */
export function iconFileName(size: number): string {
  return `icon-${String(size)}.png`;
}

/**
 * The size a derived filename names, or `undefined` when it names no icon this
 * site offers.
 *
 * The check the request path goes through, so the URL space cannot be used to
 * make the server encode arbitrary sizes — the rule the widths already follow.
 */
export function iconSize(file: string): number | undefined {
  const size = Number(ICON_FILE.exec(file)?.[1] ?? NaN);
  return ICONS.some((icon) => icon.size === size) ? size : undefined;
}

/**
 * The icons of a site whose avatar is this upload, or none at all.
 *
 * None when the site has no avatar, when the avatar is not one of its own
 * uploads, when it is a file no icon can be made of, or when image
 * optimization is off — because the head must never link a file this server
 * would answer 404 for.
 */
export function siteIcons(config: ImageConfig, avatar: string | undefined): SiteIcon[] {
  if (!config.imageOptimization) return [];

  const source = iconSource(avatar);
  if (source === undefined) return [];

  return ICONS.map(({ rel, size }) => ({
    rel,
    sizes: `${String(size)}x${String(size)}`,
    href: iconHref(source, size),
  }));
}

/**
 * Derive one icon, or answer `false` having written nothing.
 *
 * Enlarging is allowed, unlike a width variant: 180 pixels is what the touch
 * icon has to be, and a site whose avatar is smaller than that is better
 * served a soft icon than none. The crop is the middle of the picture, which
 * is where a face is.
 */
export async function deriveSiteIcon(
  config: ImageConfig,
  source: string,
  size: number,
): Promise<boolean> {
  const file = sourceFile(config, source);
  if (file === undefined || !ICON_SOURCES.has(path.extname(source).toLowerCase())) return false;

  const directory = derivedDir(config, source);

  try {
    // `autoOrient` applies the EXIF rotation, and sharp keeps no metadata
    // unless asked, so the icon comes out the right way up carrying no camera
    // and no location.
    const encoded = await sharp(file, { autoOrient: true })
      .resize({ width: size, height: size, fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await mkdir(directory, { recursive: true });
    await writeFileAtomically(path.join(directory, iconFileName(size)), encoded);
    return true;
  } catch {
    // An avatar sharp cannot read is a site with no icons, not a failed
    // request: the handler answers 404 and the page it came from is fine.
    return false;
  }
}

/** The upload an avatar setting names, or `undefined` when it names none. */
function iconSource(avatar: string | undefined): string | undefined {
  if (avatar === undefined || !avatar.startsWith(UPLOAD_ASSET_PREFIX)) return undefined;

  const relative = avatar.slice(UPLOAD_ASSET_PREFIX.length);
  if (relative === '' || relative.includes('..')) return undefined;
  if (!ICON_SOURCES.has(path.extname(relative).toLowerCase())) return undefined;

  // The setting holds a URL and the lookup wants a path, so whatever the
  // upload endpoint encoded comes off again here.
  try {
    return relative.split('/').map(decodeURIComponent).join('/');
  } catch {
    return undefined;
  }
}

/** Where one size of one upload's icon is served. */
function iconHref(source: string, size: number): string {
  const segments = [...source.split('/'), iconFileName(size)].map((segment) =>
    encodeURIComponent(segment),
  );
  return `${VARIANT_ASSET_PREFIX}${segments.join('/')}`;
}
