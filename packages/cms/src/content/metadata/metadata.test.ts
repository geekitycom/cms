import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import sharp from 'sharp';

import {
  avifWithMetadata,
  gifWithMetadata,
  jpegWithMetadata,
  leakedSecrets,
  mp4WithLocation,
  pngWithMetadata,
  webpWithMetadata,
} from '../../__testing__/metadata.ts';
import { stripMetadata, UnreadableMetadataError } from './index.ts';

describe('stripMetadata', () => {
  const fixtures = async (): Promise<[string, Uint8Array][]> => [
    ['.jpg', await jpegWithMetadata()],
    ['.jpg', await jpegWithMetadata(6)],
    ['.png', await pngWithMetadata()],
    ['.png', await pngWithMetadata(3)],
    ['.webp', await webpWithMetadata()],
    ['.webp', await webpWithMetadata(6)],
    ['.avif', await avifWithMetadata()],
    ['.gif', await gifWithMetadata()],
    ['.mp4', mp4WithLocation()],
  ];

  it('says what it removed, and finds nothing the second time', async () => {
    for (const [extension, original] of await fixtures()) {
      const first = stripMetadata(extension, original);
      assert.ok(first.removed.length > 0, extension);
      assert.deepEqual(leakedSecrets(first.bytes), [], extension);

      const second = stripMetadata(extension, first.bytes);
      assert.deepEqual(second.removed, [], extension);
      assert.equal(second.bytes, first.bytes, `${extension} comes back as the same array`);
    }
  });

  it('names the kinds of metadata it took out of a JPEG', async () => {
    const { removed } = stripMetadata('.jpg', await jpegWithMetadata());
    assert.deepEqual([...removed].sort(), ['EXIF', 'IPTC', 'XMP', 'comment']);
  });

  it('keeps a turned WebP the way up it was taken', async () => {
    const original = await webpWithMetadata(6);
    const { bytes } = stripMetadata('.webp', original);

    assert.equal((await sharp(bytes).metadata()).orientation, 6);
    assert.deepEqual(
      await sharp(bytes).rotate().raw().toBuffer(),
      await sharp(original).rotate().raw().toBuffer(),
    );
  });

  it('takes the comment and XMP out of a GIF without touching a frame', async () => {
    const original = await gifWithMetadata();
    const { bytes, removed } = stripMetadata('.gif', original);

    assert.deepEqual([...removed].sort(), ['XMP', 'comment']);
    assert.deepEqual(await sharp(bytes).raw().toBuffer(), await sharp(original).raw().toBuffer());
  });

  it('passes a format it has no stripper for through untouched', () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 /Author (Ada)');
    assert.equal(stripMetadata('.pdf', pdf).bytes, pdf);
  });

  it('leaves a file that ends before any metadata as it is', () => {
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(stripMetadata('.png', signature).bytes, signature);
    const header = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    assert.equal(stripMetadata('.mp4', header).bytes, header);
  });

  it('refuses a JPEG whose segments cannot be followed', () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 0x45, 0x78]);
    assert.throws(() => stripMetadata('.jpg', broken), UnreadableMetadataError);
  });
});
