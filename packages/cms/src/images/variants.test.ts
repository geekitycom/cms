import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';
import type { Sharp } from 'sharp';

import {
  describeImage,
  findImageVariant,
  generateImageVariants,
  removeImageVariants,
} from './variants.ts';
import type { ImageConfig } from './variants.ts';

const temporary: string[] = [];

after(async () => {
  await Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A throwaway site with an empty content and data directory. */
async function site(overrides: Partial<ImageConfig> = {}): Promise<ImageConfig> {
  const root = await mkdtemp(path.join(tmpdir(), 'geekity-images-'));
  temporary.push(root);
  return {
    contentDir: path.join(root, 'content'),
    dataDir: path.join(root, 'data'),
    imageOptimization: true,
    imageWidths: [320, 640, 960, 1280, 1920],
    imageFormats: ['webp'],
    ...overrides,
  };
}

/** Put an image of a known size under `content/uploads/`, and answer its path. */
async function upload(config: ImageConfig, name: string, image: Sharp | Buffer): Promise<string> {
  const file = path.join(config.contentDir, 'uploads', name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.isBuffer(image) ? image : await image.toBuffer());
  return name;
}

/** A plain rectangle of solid colour, at whatever size the caller asks for. */
function rectangle(width: number, height: number): Sharp {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
  });
}

describe('generateImageVariants', () => {
  it('writes every configured width below the original, plus the original width itself', async () => {
    const config = await site({ imageWidths: [320, 640, 1280] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());

    const record = await generateImageVariants(config, source);

    assert.ok(record !== undefined);
    assert.equal(record.width, 1000);
    assert.equal(record.height, 500);
    assert.equal(record.format, 'png');
    assert.deepEqual(
      record.variants.map((variant) => `${String(variant.width)}.${variant.format}`).sort(),
      ['1000.png', '1000.webp', '320.png', '320.webp', '640.png', '640.webp'],
    );
  });

  it('records the height each width comes out at, so the markup never guesses', async () => {
    const config = await site({ imageWidths: [320] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());

    const record = await generateImageVariants(config, source);

    const narrow = record?.variants.find((variant) => variant.width === 320);
    assert.equal(narrow?.height, 160);
  });

  it('puts the files where the sidecar says they are', async () => {
    const config = await site({ imageWidths: [320] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());

    const record = await generateImageVariants(config, source);

    assert.ok(record !== undefined);
    for (const variant of record.variants) {
      const file = path.join(config.dataDir, 'images', source, variant.file);
      const written = await sharp(await readFile(file)).metadata();
      assert.equal(written.width, variant.width);
      assert.equal(written.height, variant.height);
    }
  });

  it('turns a photo the right way up and reports the size a reader will see', async () => {
    const config = await site({ imageWidths: [320] });
    // Orientation 6 is a portrait photograph stored on its side, which is what
    // a phone held upright produces.
    const sideways = await rectangle(1000, 500)
      .jpeg()
      .keepMetadata()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const source = await upload(config, '2026/09/photo.jpg', sideways);

    const record = await generateImageVariants(config, source);

    assert.equal(record?.width, 500);
    assert.equal(record?.height, 1000);
    const narrow = record?.variants.find(
      (variant) => variant.width === 320 && variant.format === 'jpeg',
    );
    assert.equal(narrow?.height, 640);
  });

  it('leaves the camera behind: no EXIF travels into a variant', async () => {
    const config = await site({ imageWidths: [320] });
    const withExif = await rectangle(1000, 500)
      .jpeg()
      .withExif({ IFD0: { Copyright: 'Somebody', Make: 'A Camera Company' } })
      .toBuffer();
    assert.ok((await sharp(withExif).metadata()).exif !== undefined, 'the fixture has EXIF');
    const source = await upload(config, '2026/09/photo.jpg', withExif);

    const record = await generateImageVariants(config, source);

    assert.ok(record !== undefined);
    for (const variant of record.variants) {
      const file = path.join(config.dataDir, 'images', source, variant.file);
      assert.equal((await sharp(await readFile(file)).metadata()).exif, undefined);
    }
  });

  it('leaves a GIF alone, animated or not', async () => {
    const config = await site();
    const source = await upload(config, '2026/09/loop.gif', rectangle(1000, 500).gif());

    assert.equal(await generateImageVariants(config, source), undefined);
    assert.equal(describeImage(config, source), undefined);
  });

  it('writes nothing at all when optimization is off', async () => {
    const config = await site({ imageOptimization: false });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());

    assert.equal(await generateImageVariants(config, source), undefined);
    assert.equal(describeImage(config, source), undefined);
  });

  it('refuses a source path that climbs out of the uploads directory', async () => {
    const config = await site();
    assert.equal(await generateImageVariants(config, '../../secret.png'), undefined);
  });
});

describe('describeImage', () => {
  it('reads the record a previous process wrote', async () => {
    const config = await site({ imageWidths: [320] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());
    await generateImageVariants(config, source);

    // A second config over the same directories is what a restart looks like:
    // nothing in memory, everything on disk.
    const restarted = { ...config };
    const record = describeImage(restarted, source);

    assert.equal(record?.width, 1000);
    assert.equal(record?.height, 500);
    assert.equal(record?.variants.length, 4);
  });

  it('keeps describing an image whose derived files have been swept away', async () => {
    const config = await site({ imageWidths: [320] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());
    await generateImageVariants(config, source);

    await rm(path.join(config.dataDir, 'images'), { recursive: true, force: true });

    assert.equal(describeImage(config, source)?.width, 1000);
  });

  it('forgets a record whose original has gone', async () => {
    const config = await site({ imageWidths: [320] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());
    await generateImageVariants(config, source);

    await rm(path.join(config.contentDir, 'uploads', source));

    assert.equal(describeImage(config, source), undefined);
  });

  it('answers nothing for an upload nothing has been derived from', async () => {
    const config = await site();
    const source = await upload(config, '2026/09/photo.png', rectangle(200, 100).png());

    assert.equal(describeImage(config, source), undefined);
  });
});

describe('removeImageVariants', () => {
  it('takes the derived directory away with the original', async () => {
    const config = await site({ imageWidths: [320] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());
    await generateImageVariants(config, source);

    await removeImageVariants(config, source);

    assert.equal(describeImage(config, source), undefined);
    await assert.rejects(() => readFile(path.join(config.dataDir, 'images', source, '320.webp')));
  });

  it('says nothing about an upload that never had any', async () => {
    const config = await site();
    await assert.doesNotReject(() => removeImageVariants(config, '2026/09/nothing.png'));
  });
});

describe('findImageVariant', () => {
  it('serves a file that is already there', async () => {
    const config = await site({ imageWidths: [320] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());
    await generateImageVariants(config, source);

    const asset = await findImageVariant(config, `${source}/320.webp`);

    assert.ok(asset !== undefined);
    assert.equal(asset.contentType, 'image/webp');
  });

  it('rebuilds a variant that has been deleted', async () => {
    const config = await site({ imageWidths: [320] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());
    await generateImageVariants(config, source);
    await rm(path.join(config.dataDir, 'images'), { recursive: true, force: true });

    const asset = await findImageVariant(config, `${source}/320.webp`);

    assert.ok(asset !== undefined);
    assert.equal((await sharp(await readFile(asset.file)).metadata()).width, 320);
  });

  it('builds a variant nothing has ever derived, so a page cannot outrun the encoder', async () => {
    const config = await site({ imageWidths: [320] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());

    assert.ok((await findImageVariant(config, `${source}/320.webp`)) !== undefined);
  });

  it('refuses a width the site does not offer rather than encoding it', async () => {
    const config = await site({ imageWidths: [320] });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());
    await generateImageVariants(config, source);

    assert.equal(await findImageVariant(config, `${source}/777.webp`), undefined);
  });

  it('refuses a source that is not an upload', async () => {
    const config = await site();
    assert.equal(await findImageVariant(config, '../../../etc/passwd/320.webp'), undefined);
    assert.equal(await findImageVariant(config, '320.webp'), undefined);
  });

  it('generates nothing when optimization is off', async () => {
    const config = await site({ imageOptimization: false });
    const source = await upload(config, '2026/09/photo.png', rectangle(1000, 500).png());

    assert.equal(await findImageVariant(config, `${source}/320.webp`), undefined);
  });
});
