import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import {
  avifWithMetadata,
  jpegWithMetadata,
  leakedSecrets,
  mp4WithLocation,
  pngWithMetadata,
  topLevelBoxes,
  webpWithMetadata,
} from '../__testing__/metadata.ts';
import { resolveConfig } from '../config.ts';
import { refusedUpload, storeUpload } from './uploads.ts';

const directories: string[] = [];
after(async () => {
  await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Store one file through storeUpload and read back the bytes that landed. */
async function upload(name: string, bytes: Uint8Array, type = ''): Promise<Uint8Array> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'geekity-strip-'));
  directories.push(root);
  const config = resolveConfig({
    contentDir: path.join(root, 'content'),
    dataDir: path.join(root, 'data'),
    uploadTypes: ['.jpg', '.png', '.webp', '.avif', '.gif', '.mp4', '.m4v'],
  });
  const outcome = await storeUpload(new File([new Uint8Array(bytes)], name, { type }), config);
  if (refusedUpload(outcome)) assert.fail(outcome.error);
  const relative = outcome.url.slice('/uploads/'.length).split('/');
  return new Uint8Array(await readFile(path.join(config.contentDir, 'uploads', ...relative)));
}

function contains(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));
}

async function pixels(bytes: Uint8Array): Promise<Buffer> {
  return await sharp(bytes).rotate().raw().toBuffer();
}

describe('storeUpload strips location and camera metadata', () => {
  it('stores a JPEG with no EXIF, XMP, IPTC or comment', async () => {
    const original = await jpegWithMetadata();
    assert.equal(leakedSecrets(original).length, 5, 'the fixture carries what it says');

    const stored = await upload('photo.jpg', original, 'image/jpeg');

    assert.deepEqual(leakedSecrets(stored), []);
    assert.equal(contains(stored, 'Exif\0\0'), false);
    assert.equal(contains(stored, 'http://ns.adobe.com/xap/1.0/'), false);
    assert.equal(contains(stored, 'Photoshop 3.0'), false);
  });

  it('stores a PNG with no eXIf, text or time chunks', async () => {
    const stored = await upload('photo.png', await pngWithMetadata(), 'image/png');

    assert.deepEqual(leakedSecrets(stored), []);
    for (const chunk of ['eXIf', 'iTXt', 'tEXt', 'zTXt', 'tIME']) {
      assert.equal(contains(stored, chunk), false, chunk);
    }
  });

  it('stores a WebP with no EXIF or XMP chunk', async () => {
    const original = await webpWithMetadata();
    assert.ok(contains(original, 'EXIF') && contains(original, 'XMP '));

    const stored = await upload('photo.webp', original, 'image/webp');

    assert.deepEqual(leakedSecrets(stored), []);
    assert.equal(contains(stored, 'EXIF'), false);
    assert.equal(contains(stored, 'XMP '), false);
    assert.deepEqual(await pixels(stored), await pixels(original));
  });

  it('stores an AVIF whose Exif and XMP items hold nothing', async () => {
    const original = await avifWithMetadata();
    assert.ok(leakedSecrets(original).length >= 3);

    const stored = await upload('photo.avif', original, 'image/avif');

    assert.deepEqual(leakedSecrets(stored), []);
    assert.equal(stored.length, original.length, 'nothing moved, so no offset needed fixing');
    assert.equal(contains(stored, 'GPS'), false);
    const exif = (await sharp(stored).metadata()).exif;
    assert.ok(exif === undefined || !exif.includes(Buffer.from([0x88, 0x25])), 'no GPS IFD');
    assert.deepEqual(await pixels(stored), await pixels(original));
  });

  it('keeps a JPEG the way up it was taken', async () => {
    const original = await jpegWithMetadata(6);

    const stored = await upload('sideways.jpg', original, 'image/jpeg');

    assert.deepEqual(leakedSecrets(stored), []);
    assert.equal((await sharp(stored).metadata()).orientation, 6);
    const shown = await sharp(stored).rotate().toBuffer({ resolveWithObject: true });
    assert.deepEqual([shown.info.width, shown.info.height], [20, 40]);
    assert.deepEqual(await pixels(stored), await pixels(original));
  });

  it('removes JPEG and PNG metadata without re-encoding a pixel', async () => {
    for (const [name, original] of [
      ['photo.jpg', await jpegWithMetadata()],
      ['photo.png', await pngWithMetadata()],
      ['turned.png', await pngWithMetadata(8)],
    ] as const) {
      const stored = await upload(name, original);
      assert.deepEqual(await pixels(stored), await pixels(original), name);
      assert.deepEqual(
        await sharp(stored).raw().toBuffer(),
        await sharp(original).raw().toBuffer(),
        name,
      );
    }
  });

  it('stores an MP4 and an M4V with no location, camera or XMP', async () => {
    for (const name of ['clip.mp4', 'clip.m4v']) {
      const original = mp4WithLocation();
      assert.ok(leakedSecrets(original).length >= 3);

      const stored = await upload(name, original, 'video/mp4');

      assert.deepEqual(leakedSecrets(stored), []);
      assert.equal(contains(stored, '©xyz'), false);
      assert.equal(stored.length, original.length, 'chunk offsets still point at the same bytes');
      assert.deepEqual(
        topLevelBoxes(stored).map((found) => found.type),
        ['ftyp', 'moov', 'free', 'mdat'],
      );
      assert.deepEqual(stored.subarray(-64), original.subarray(-64), 'media data untouched');
    }
  });
});
