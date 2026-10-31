/**
 * The rest of the icon set and the web app manifest (TASK-147): `/favicon.ico`
 * at the root, an SVG icon when the site has one, an `icon` setting apart from
 * the avatar, a maskable 512 and `/manifest.webmanifest`. All of it is asserted
 * over HTTP against the packaged theme, the way a browser and a crawler meet it.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { sandbox } from '../admin/__testing__/harness.ts';
import { sourceVersion } from '../images/paths.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { shared } from './__testing__/shared.ts';

const box = sandbox();
after(() => box.cleanup());

const AVATAR = '/uploads/2026/09/avatar.png';
const LOGO = '/uploads/2026/09/logo.svg';
const LOGO_PNG = '/uploads/2026/09/logo.png';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" fill="#0b5fff"/></svg>';

/** A site with `site.json` saying `settings`, and these uploads on disk. */
async function site(
  settings: Record<string, unknown>,
  uploads: Record<string, Buffer | string> = {},
  config: GeekityConfig = {},
): Promise<Cms> {
  const contentDir = await box.dir('geekity-icons-content-');
  const dataDir = await box.dir('geekity-icons-data-');

  const files: Record<string, Buffer | string> = {
    '_data/site.json': JSON.stringify({ title: 'A Site of Words', ...settings }),
    'posts/hello.md': "---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\n---\n\nBody.\n",
  };
  for (const [at, contents] of Object.entries(uploads)) files[at.slice(1)] = contents;

  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }

  return box.open({ contentDir, dataDir, ...config });
}

const sharedSite = shared(site);

/** A square PNG of one colour. */
async function png(size: number, background = { r: 179, g: 57, b: 0 }): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background } })
    .png()
    .toBuffer();
}

async function get(cms: Cms, pathname: string): Promise<Response> {
  return cms.app.request(pathname);
}

/** Every `<link>` of the home page, as its attributes. */
async function headLinks(cms: Cms): Promise<Record<string, string>[]> {
  const response = await get(cms, '/');
  assert.equal(response.status, 200);
  const html = await response.text();
  return [...html.matchAll(/<link ([^>]*)>/g)].map((match) =>
    Object.fromEntries(
      [...(match[1] ?? '').matchAll(/([a-z-]+)="([^"]*)"/g)].map((pair) => [
        pair[1] ?? '',
        pair[2] ?? '',
      ]),
    ),
  );
}

/** The frames of an ICO file: each one's declared size and the PNG it holds. */
function icoFrames(bytes: Buffer): { width: number; height: number; image: Buffer }[] {
  assert.equal(bytes.readUInt16LE(0), 0, 'the ICO header is not reserved zero');
  assert.equal(bytes.readUInt16LE(2), 1, 'the file is not an icon');
  const count = bytes.readUInt16LE(4);

  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    return {
      width: bytes.readUInt8(entry) || 256,
      height: bytes.readUInt8(entry + 1) || 256,
      image: bytes.subarray(offset, offset + length),
    };
  });
}

describe('/favicon.ico (TASK-147 AC #1)', () => {
  it('serves an ICO of 16, 32 and 48 pixel frames derived from the icon source', async () => {
    const cms = await sharedSite({ avatar: AVATAR }, { [AVATAR]: await png(240) });

    const response = await get(cms, '/favicon.ico');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/x-icon');
    assert.ok(response.headers.get('etag'), 'the favicon carries no validator');

    const frames = icoFrames(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual(
      frames.map((frame) => `${String(frame.width)}x${String(frame.height)}`),
      ['16x16', '32x32', '48x48'],
    );
    for (const frame of frames) {
      const meta = await sharp(frame.image).metadata();
      assert.deepEqual(
        { width: meta.width, height: meta.height, format: meta.format },
        { width: frame.width, height: frame.height, format: 'png' },
        'a frame does not hold the PNG its entry declares',
      );
    }
  });

  it('answers 404 when the site has nothing to derive one from', async () => {
    const cms = await sharedSite({});
    assert.equal((await get(cms, '/favicon.ico')).status, 404);
  });
});

describe('an SVG icon, and an icon apart from the avatar (TASK-147 AC #2)', () => {
  it('links the icon setting rather than the avatar when the site sets one', async () => {
    const cms = await sharedSite(
      { avatar: AVATAR, icon: LOGO_PNG },
      { [AVATAR]: await png(240), [LOGO_PNG]: await png(240, { r: 11, g: 95, b: 255 }) },
    );

    const icons = (await headLinks(cms)).filter((link) => link['rel']?.includes('icon'));
    assert.ok(icons.length > 0, 'no icon is linked');
    for (const icon of icons) {
      assert.match(icon['href'] ?? '', /\/logo\.png\//, `${icon['href'] ?? ''} is not the icon`);
    }

    const favicon = icoFrames(Buffer.from(await (await get(cms, '/favicon.ico')).arrayBuffer()));
    const frame = favicon[0];
    assert.ok(frame !== undefined);
    const pixel = await pixels(frame.image, frame.width);
    assert.deepEqual(
      pixel(8, 8).slice(0, 3),
      [11, 95, 255],
      'the favicon is not drawn from the icon',
    );
  });

  it('links an SVG icon as itself, ahead of the PNGs rasterised from it', async () => {
    const cms = await sharedSite({ icon: LOGO }, { [LOGO]: SVG });

    const icons = (await headLinks(cms)).filter((link) => link['rel']?.includes('icon'));
    assert.deepEqual(
      icons.map((icon) => `${icon['rel'] ?? ''} ${icon['type'] ?? ''} ${icon['sizes'] ?? ''}`),
      [
        'icon image/svg+xml ',
        'icon image/png 32x32',
        'icon image/png 16x16',
        'apple-touch-icon image/png 180x180',
      ],
    );
    assert.equal(icons[0]?.['href'], LOGO);

    for (const icon of icons) {
      const response = await get(cms, icon['href'] ?? '');
      assert.equal(response.status, 200, `GET ${icon['href'] ?? ''}`);
      assert.equal(response.headers.get('content-type'), icon['type']);
    }
  });

  it('links no SVG for a raster icon', async () => {
    const cms = await sharedSite({ avatar: AVATAR }, { [AVATAR]: await png(240) });
    const types = (await headLinks(cms))
      .filter((link) => link['rel']?.includes('icon'))
      .map((link) => link['type']);
    assert.ok(!types.includes('image/svg+xml'), 'a PNG avatar is linked as an SVG');
  });
});

/** The manifest of a site, parsed, after checking how it is served. */
async function manifest(cms: Cms): Promise<Record<string, unknown>> {
  const response = await get(cms, '/manifest.webmanifest');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  return (await response.json()) as Record<string, unknown>;
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

describe('the maskable icon (TASK-147 AC #3)', () => {
  it('derives an opaque 512 square with the picture inside the 80% safe zone', async () => {
    // White with a red frame: the frame is the picture's edge, so it has to
    // land on the edge of the safe zone, with padding and not red outside it.
    const avatar = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 200, g: 20, b: 20 } },
    })
      .composite([{ input: await png(160, { r: 255, g: 255, b: 255 }), top: 20, left: 20 }])
      .png()
      .toBuffer();
    const cms = await sharedSite({ avatar: AVATAR }, { [AVATAR]: avatar });

    const icons = (await manifest(cms))['icons'] as ManifestIcon[];
    const maskable = icons.find((icon) => icon.purpose === 'maskable');
    assert.ok(maskable !== undefined, 'the manifest lists no maskable icon');
    assert.equal(maskable.sizes, '512x512');
    assert.equal(maskable.type, 'image/png');

    const response = await get(cms, maskable.src);
    assert.equal(response.status, 200);
    const pixel = await pixels(Buffer.from(await response.arrayBuffer()), 512);

    const red = (rgba: number[]): boolean => (rgba[0] ?? 0) > 150 && (rgba[1] ?? 255) < 80;
    for (const [x, y] of [
      [0, 0],
      [511, 511],
      [256, 20],
      [20, 256],
    ] as const) {
      assert.equal(pixel(x, y)[3], 255, `(${String(x)}, ${String(y)}) is transparent`);
      assert.ok(!red(pixel(x, y)), `(${String(x)}, ${String(y)}) is the picture, not padding`);
    }
    assert.ok(red(pixel(60, 256)), 'the picture does not begin at the edge of the safe zone');
    assert.ok(red(pixel(452, 256)), 'the picture does not end at the edge of the safe zone');
    assert.ok(!red(pixel(256, 256)), 'the middle of the picture is not in the middle');
  });
});

/** Read an image's pixels, as an `(x, y) => [r, g, b, a]` lookup. */
async function pixels(
  bytes: Buffer,
  expectedSize: number,
): Promise<(x: number, y: number) => number[]> {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual(
    { width: info.width, height: info.height },
    {
      width: expectedSize,
      height: expectedSize,
    },
  );
  return (x, y) => {
    const at = (y * info.width + x) * info.channels;
    return [...data.subarray(at, at + info.channels)];
  };
}

describe('the web app manifest colours (TASK-493)', () => {
  const SLATE = { light: '#f4f7fb', dark: '#12161c' };

  for (const [mode, expected] of [
    ['system', SLATE.light],
    ['light', SLATE.light],
    ['dark', SLATE.dark],
  ] as const) {
    it(`are the chosen scheme's ${mode === 'dark' ? 'dark' : 'light'} theme colour in ${mode} mode (AC #1)`, async () => {
      const body = await manifest(await sharedSite({ colorScheme: 'slate', colorMode: mode }));
      assert.equal(body['theme_color'], expected);
      assert.equal(body['background_color'], expected);
    });
  }

  it('are the top-level light theme colour under a theme with no schemes (AC #1)', async () => {
    const themesDir = await box.dir('geekity-icons-themes-');
    const theme = path.join(themesDir, 'plain');
    await mkdir(path.join(theme, 'static'), { recursive: true });
    await writeFile(
      path.join(theme, 'theme.json'),
      JSON.stringify({
        name: 'Plain',
        kind: 'site',
        themeColor: { light: '#abcdef', dark: '#123456' },
      }),
    );
    await writeFile(path.join(theme, 'static', 'style.css'), ':root { --color-body: #abcdef; }');

    const body = await manifest(
      await site({ theme: 'plain', colorMode: 'dark' }, {}, { themesDir }),
    );

    assert.equal(body['theme_color'], '#abcdef');
    assert.equal(body['background_color'], '#abcdef');
  });
});

describe('the web app manifest (TASK-147 AC #4)', () => {
  it('is served with the name, the icons, the start URL, the colours and the display', async () => {
    const cms = await sharedSite({ avatar: AVATAR }, { [AVATAR]: await png(240) });
    const body = await manifest(cms);

    assert.equal(body['name'], 'A Site of Words');
    assert.equal(body['short_name'], 'A Site of Words');
    assert.equal(body['start_url'], '/');
    assert.equal(body['display'], 'minimal-ui');
    assert.equal(body['theme_color'], '#faf7f2');
    assert.equal(body['background_color'], '#faf7f2');

    const icons = body['icons'] as ManifestIcon[];
    assert.deepEqual(
      icons.map((icon) => `${icon.sizes} ${icon.type} ${icon.purpose ?? 'any'}`),
      ['192x192 image/png any', '512x512 image/png any', '512x512 image/png maskable'],
    );
    for (const icon of icons) {
      const response = await get(cms, icon.src);
      assert.equal(response.status, 200, `GET ${icon.src}`);
      const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert.equal(`${String(meta.width)}x${String(meta.height)}`, icon.sizes, icon.src);
    }
  });

  it('lists an SVG icon at any size', async () => {
    const cms = await sharedSite({ icon: LOGO }, { [LOGO]: SVG });
    const icons = (await manifest(cms))['icons'] as ManifestIcon[];
    assert.deepEqual(icons[0], { src: LOGO, sizes: 'any', type: 'image/svg+xml' });
  });

  it('is served, without icons, by a site with nothing to derive them from', async () => {
    const body = await manifest(await sharedSite({}));
    assert.deepEqual(body['icons'], []);
  });

  it('answers a repeat request with 304', async () => {
    const cms = await sharedSite({});
    const first = await get(cms, '/manifest.webmanifest');
    const etag = first.headers.get('etag');
    assert.ok(etag !== null);
    const again = await cms.app.request('/manifest.webmanifest', {
      headers: { 'if-none-match': etag },
    });
    assert.equal(again.status, 304);
  });

  it('is linked from the head of every page', async () => {
    const cms = await sharedSite({});
    const manifests = (await headLinks(cms)).filter((link) => link['rel'] === 'manifest');
    assert.deepEqual(
      manifests.map((link) => link['href']),
      ['/manifest.webmanifest'],
    );
  });
});

describe('icon names under an upload that is not the site icon', () => {
  it('answer 404 and write nothing', async () => {
    const cms = await site(
      { avatar: AVATAR },
      { [AVATAR]: await png(240), '/uploads/2026/09/other.png': await png(300) },
    );

    for (const name of ['icon-512.png', 'favicon.ico', 'maskable-512.png']) {
      const response = await get(cms, `/uploads/_/2026/09/other.png/${name}`);
      await response.arrayBuffer();
      assert.equal(response.status, 404, name);
    }
    assert.equal(
      existsSync(path.join(cms.config.dataDir, 'images', '2026', '09', 'other.png')),
      false,
      'icons were drawn from an upload that is not the site icon',
    );
    assert.equal((await get(cms, '/uploads/_/2026/09/avatar.png/icon-512.png')).status, 200);
  });
});

describe('derived files after their upload is replaced in place', () => {
  const RED = { r: 220, g: 20, b: 20 };
  const BLUE = { r: 20, g: 20, b: 220 };

  async function isRed(response: Response): Promise<boolean> {
    const { dominant } = await sharp(Buffer.from(await response.arrayBuffer())).stats();
    return dominant.r > dominant.b;
  }

  async function iconHref(cms: Cms): Promise<string> {
    const link = (await headLinks(cms)).find((attributes) =>
      attributes.href?.includes('icon-32.png'),
    );
    assert.ok(link?.href !== undefined, 'the head links no icon-32.png');
    return link.href.replaceAll('&amp;', '&');
  }

  it('serve the new picture at the icon URL the head links for the new bytes', async () => {
    const cms = await site({ avatar: AVATAR }, { [AVATAR]: await png(240, RED) });
    assert.ok(await isRed(await get(cms, await iconHref(cms))), 'the first icon is red');

    await writeFile(path.join(cms.config.contentDir, AVATAR), await png(300, BLUE));
    const href = await iconHref(cms);
    const second = await get(cms, href);

    assert.equal(second.status, 200);
    assert.equal(await isRed(second), false, `${href} served the old red icon`);
    assert.match(second.headers.get('cache-control') ?? '', /immutable/);
  });

  it('never mark a width derived from the old bytes immutable under the new hash', async () => {
    const photo = '/uploads/2026/09/photo.png';
    const cms = await site({}, { [photo]: await png(640, RED) }, { imageWidths: [320] });
    const first = await get(cms, '/uploads/_/2026/09/photo.png/320.webp');
    assert.equal(first.status, 200);
    await first.arrayBuffer();

    await writeFile(path.join(cms.config.contentDir, photo), await png(700, BLUE));
    const version = sourceVersion(cms.config, '2026/09/photo.png');
    assert.ok(version !== undefined);
    const second = await get(cms, `/uploads/_/2026/09/photo.png/320.webp?v=${version}`);
    const cacheControl = second.headers.get('cache-control') ?? '';

    assert.equal(second.status, 200);
    assert.ok(
      !((await isRed(second)) && cacheControl.includes('immutable')),
      `the old red variant was served under the new hash with "${cacheControl}"`,
    );
  });
});
