import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { UPLOAD_ASSET_PREFIX, VARIANT_ASSET_PREFIX } from '../content/uploads.ts';
import { writeFileAtomically } from '../files/atomic.ts';
import { encodePath } from '../util/url.ts';
import { ICON_SOURCES, parseIconSetting } from './icon-setting.ts';
import {
  DECODE_OPTIONS,
  decodable,
  locateUpload,
  MAX_INPUT_PIXELS,
  sourceVersion,
  versioned,
} from './paths.ts';
import type { ImageConfig, Upload } from './paths.ts';
import { deriveSet, settledSet } from './derived-sets.ts';
import type { DerivedKind } from './derived-sets.ts';
import { messageOf } from '../util/errors.ts';

/**
 * The site's icons: the favicons, the touch icon, the manifest's icons and
 * `/favicon.ico`, derived from the site's `icon` setting, else its avatar.
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
 * They are their own derived set, drawn only from the site icon's upload,
 * which keeps the sizes out of every upload's variant set, where they would
 * turn up in a `srcset` as candidates nobody wants.
 */

/** One icon as the head links it. */
export interface SiteIcon {
  /** `icon` or `apple-touch-icon`. */
  rel: string;
  /** The `sizes` attribute, `32x32`; empty for an SVG, which has every size. */
  sizes: string;
  /** `image/png`, or `image/svg+xml` for a site whose icon is an SVG. */
  type: string;
  /** Where the file is served, as a site-root path. */
  href: string;
}

/** One icon as a web app manifest lists it. */
export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  /** Present only for the maskable icon; a manifest reads an absent one as `any`. */
  purpose?: 'maskable';
}

/**
 * How one derived file is drawn.
 *
 * `square` is the picture cropped to its middle at one size. `maskable` is the
 * same crop shrunk into the middle 80% of the canvas and padded out opaque,
 * because a platform that masks an icon to a circle or a squircle may cut
 * anything outside that zone. `ico` is several squares in one Windows icon
 * file, for the `/favicon.ico` every browser and crawler asks for.
 */
type IconShape =
  | { readonly kind: 'square'; readonly size: number }
  | { readonly kind: 'maskable'; readonly size: number }
  | { readonly kind: 'ico'; readonly sizes: readonly number[] };

/**
 * Every file derived from the site's icon, by the name it is served under.
 *
 * The request path is checked against this table, so the URL space cannot be
 * used to make the server encode arbitrary sizes, the rule the widths already
 * follow.
 */
const DERIVED_ICONS: ReadonlyMap<string, IconShape> = new Map<string, IconShape>([
  ['icon-32.png', { kind: 'square', size: 32 }],
  ['icon-16.png', { kind: 'square', size: 16 }],
  ['icon-180.png', { kind: 'square', size: 180 }],
  ['icon-192.png', { kind: 'square', size: 192 }],
  ['icon-512.png', { kind: 'square', size: 512 }],
  ['maskable-512.png', { kind: 'maskable', size: 512 }],
  ['favicon.ico', { kind: 'ico', sizes: [16, 32, 48] }],
]);

/** The derived file `/favicon.ico` serves. */
export const FAVICON_FILE = 'favicon.ico';

/**
 * The icons the head links, in order: the 32 and 16 pixel favicons and the 180
 * pixel touch icon Apple asks for. An SVG icon goes ahead of them as itself.
 */
const HEAD_ICONS: readonly { rel: string; file: string; size: number }[] = [
  { rel: 'icon', file: 'icon-32.png', size: 32 },
  { rel: 'icon', file: 'icon-16.png', size: 16 },
  { rel: 'apple-touch-icon', file: 'icon-180.png', size: 180 },
];

/**
 * The icons the manifest lists: the 192 and 512 a browser needs before it
 * offers to install the site, and the maskable 512 a launcher crops.
 */
const MANIFEST_ICONS: readonly { file: string; size: number; maskable: boolean }[] = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'maskable-512.png', size: 512, maskable: true },
];

/**
 * How much of a maskable icon's width the picture may fill: the safe zone is
 * a circle of 40% radius, so the picture is drawn 80% wide in the middle.
 */
const MASKABLE_SAFE_ZONE = 0.8;

/** Whether a derived filename names an icon this site offers. */
export function isDerivedIcon(file: string): boolean {
  return DERIVED_ICONS.has(file);
}

/**
 * The upload the site's icons are drawn from, as the setting names it: the
 * `icon` setting when the site has one, else its avatar.
 *
 * A site whose mark is a logo rather than a face sets `icon` and keeps the
 * avatar for the fediverse and the share card.
 */
export function iconSetting(site: { icon?: unknown; avatar?: unknown }): string | undefined {
  for (const value of [site.icon, site.avatar]) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

/**
 * The upload a site's icons are derived from, as a path under the uploads
 * directory, or `undefined` when there is none to derive from.
 *
 * None when the setting is empty, names no upload of this site, names a file
 * no icon can be made of, or when image optimization is off.
 */
export function siteIconSource(
  config: ImageConfig,
  setting: string | undefined,
): string | undefined {
  return config.imageOptimization ? iconSource(setting) : undefined;
}

/**
 * The site icon's upload and the version of its bytes, once the icons have
 * been drawn from those bytes.
 *
 * Nothing may link a file this server would answer 404 for, and only drawing
 * the icons shows whether the upload is there and can be read. So a version
 * not drawn yet is drawn in the background and links nothing until it is,
 * the way a page's images stay plain until their variants exist.
 */
function drawnIcons(
  config: ImageConfig,
  setting: string | undefined,
): { source: string; version: string } | undefined {
  const named = siteIconSource(config, setting);
  const upload = named === undefined ? undefined : locateUpload(config, named);
  if (upload === undefined) return undefined;
  const version = sourceVersion(config, upload.source);
  if (version === undefined) return undefined;

  const known = settledSet(SITE_ICONS, upload, version);
  if (known === undefined) {
    void deriveSet(SITE_ICONS, upload, version).catch((error: unknown) => {
      console.warn(`Could not derive the site's icons from ${upload.source}: ${messageOf(error)}`);
    });
    return undefined;
  }
  return known.set === undefined ? undefined : { source: upload.source, version };
}

/**
 * Draw the site's icons now if the bytes the setting names have not been
 * drawn from, so a page that shows them right after the setting changes has
 * them to show.
 */
export async function deriveSiteIcons(
  config: ImageConfig,
  setting: string | undefined,
): Promise<void> {
  const named = siteIconSource(config, setting);
  const upload = named === undefined ? undefined : locateUpload(config, named);
  if (upload === undefined) return;
  const version = sourceVersion(config, upload.source);
  if (version === undefined || settledSet(SITE_ICONS, upload, version) !== undefined) return;
  await deriveSet(SITE_ICONS, upload, version);
}

/** The icons the head of a site whose icon setting is this links, or none at all. */
export function siteIcons(config: ImageConfig, setting: string | undefined): SiteIcon[] {
  const drawn = drawnIcons(config, setting);
  if (drawn === undefined) return [];

  const { source, version } = drawn;
  const svg: SiteIcon[] = isSvg(source)
    ? [{ rel: 'icon', sizes: '', type: 'image/svg+xml', href: uploadHref(source) }]
    : [];
  return [
    ...svg,
    ...HEAD_ICONS.map(({ rel, file, size }) => ({
      rel,
      sizes: squareSizes(size),
      type: 'image/png',
      href: versioned(iconHref(source, file), version),
    })),
  ];
}

/** The icons a web app manifest lists for a site whose icon setting is this. */
export function manifestIcons(config: ImageConfig, setting: string | undefined): ManifestIcon[] {
  const drawn = drawnIcons(config, setting);
  if (drawn === undefined) return [];

  const { source, version } = drawn;
  const svg: ManifestIcon[] = isSvg(source)
    ? [{ src: uploadHref(source), sizes: 'any', type: 'image/svg+xml' }]
    : [];
  return [
    ...svg,
    ...MANIFEST_ICONS.map(({ file, size, maskable }) => ({
      src: versioned(iconHref(source, file), version),
      sizes: squareSizes(size),
      type: 'image/png',
      ...(maskable ? { purpose: 'maskable' as const } : {}),
    })),
  ];
}

/** The sidecar that records which bytes the site's icons were drawn from. */
export const ICON_RECORD_NAME = 'icons.json';

/**
 * The site's icons as a derived set: every one of them, drawn together from
 * one version of the icon upload, so a replaced icon is redrawn whole.
 */
export const SITE_ICONS: DerivedKind<readonly string[]> = {
  sidecar: ICON_RECORD_NAME,
  parse: (value) =>
    Array.isArray(value) &&
    value.every((name) => typeof name === 'string' && DERIVED_ICONS.has(name))
      ? (value as string[])
      : undefined,
  derive: deriveIcons,
  offers: (_upload, name) => Promise.resolve(DERIVED_ICONS.has(name)),
  holds: (names, name) => names.includes(name),
};

/**
 * Draw every icon, or answer `undefined` having written nothing when sharp
 * cannot read the picture.
 *
 * Enlarging is allowed, unlike a width variant: 512 pixels is what a launcher
 * asks for, and a site whose icon is smaller than that is better served a soft
 * icon than none. The crop is the middle of the picture, which is where a face
 * is. The icons are drawn one at a time, so deriving them holds one decode.
 */
async function deriveIcons(upload: Upload): Promise<readonly string[] | undefined> {
  if (!ICON_SOURCES.has(path.extname(upload.source).toLowerCase())) return undefined;

  const drawn: [string, Buffer][] = [];
  try {
    const { width, height } = await sharp(upload.file, DECODE_OPTIONS).metadata();
    if (width === undefined || height === undefined || !decodable({ width, height })) {
      return undefined;
    }
    for (const [name, shape] of DERIVED_ICONS)
      drawn.push([name, await drawIcon(upload.file, shape)]);
  } catch (error) {
    console.warn(`Could not derive the site's icons from ${upload.source}: ${messageOf(error)}`);
    return undefined;
  }

  await mkdir(upload.directory, { recursive: true });
  for (const [name, png] of drawn) {
    await writeFileAtomically(path.join(upload.directory, name), png);
  }
  return drawn.map(([name]) => name);
}

async function drawIcon(file: string, shape: IconShape): Promise<Buffer> {
  switch (shape.kind) {
    case 'square':
      return square(file, shape.size);
    case 'maskable':
      return maskable(file, shape.size);
    case 'ico': {
      const frames: { size: number; png: Buffer }[] = [];
      for (const size of shape.sizes) frames.push({ size, png: await square(file, size) });
      return icoFile(frames);
    }
  }
}

/**
 * The picture cropped to its middle at one size.
 *
 * `autoOrient` applies the EXIF rotation, and sharp keeps no metadata unless
 * asked, so the icon comes out the right way up carrying no camera and no
 * location.
 */
async function square(file: string, size: number): Promise<Buffer> {
  return sharp(file, DECODE_OPTIONS)
    .resize({ width: size, height: size, fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * The picture inside the safe zone, padded out to the full square with its
 * own dominant colour so the padding reads as part of it, and flattened onto
 * that colour, because a launcher draws a maskable icon's transparency as
 * black.
 */
async function maskable(file: string, size: number): Promise<Buffer> {
  const inner = Math.round(size * MASKABLE_SAFE_ZONE);
  const edge = Math.floor((size - inner) / 2);
  const { dominant } = await sharp(file, DECODE_OPTIONS).stats();
  const background = { ...dominant, alpha: 1 };

  const picture = await sharp(file, DECODE_OPTIONS)
    .resize({ width: inner, height: inner, fit: 'cover', position: 'centre' })
    .toBuffer();
  return sharp(picture, { limitInputPixels: MAX_INPUT_PIXELS })
    .flatten({ background })
    .extend({
      top: edge,
      left: edge,
      bottom: size - inner - edge,
      right: size - inner - edge,
      background,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * A Windows icon file holding one PNG per size.
 *
 * Every browser since Internet Explorer 9 reads PNG frames in an ICO, which
 * keeps this to a header, a directory and the PNGs as they are.
 */
function icoFile(frames: readonly { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  let offset = header.length;
  frames.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    // A dimension of 256 is written as 0: the field is one byte.
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...frames.map((frame) => frame.png)]);
}

function squareSizes(size: number): string {
  return `${String(size)}x${String(size)}`;
}

function isSvg(source: string): boolean {
  return path.extname(source).toLowerCase() === '.svg';
}

function iconSource(setting: string | undefined): string | undefined {
  if (setting === undefined) return undefined;
  const parsed = parseIconSetting(setting);
  return 'source' in parsed ? parsed.source : undefined;
}

/** Where one derived icon of one upload is served. */
function iconHref(source: string, file: string): string {
  return `${VARIANT_ASSET_PREFIX}${encodePath(`${source}/${file}`)}`;
}

/** Where the upload itself is served. */
function uploadHref(source: string): string {
  return `${UPLOAD_ASSET_PREFIX}${encodePath(source)}`;
}
