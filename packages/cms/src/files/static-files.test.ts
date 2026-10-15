import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { canonicalType, UPLOAD_MEDIA_TYPES } from './upload-types.ts';
import { findAsset } from './static-files.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function roots(): Promise<[string, string]> {
  const parent = await mkdtemp(path.join(tmpdir(), 'geekity-static-'));
  dirs.push(parent);
  const first = path.join(parent, 'first');
  const second = path.join(parent, 'second');
  await mkdir(path.join(first, 'css'), { recursive: true });
  await mkdir(second, { recursive: true });
  await writeFile(path.join(first, 'css', 'site.css'), 'body{}');
  await writeFile(path.join(first, 'both.txt'), 'first');
  await writeFile(path.join(second, 'both.txt'), 'second!');
  await writeFile(path.join(second, 'clip.vtt'), 'WEBVTT');
  await writeFile(path.join(second, 'blob.bin'), 'x');
  await writeFile(path.join(parent, 'secret.txt'), 'no');
  return [first, second];
}

describe('findAsset', () => {
  it('finds a file under the first root that has it, described for serving', async () => {
    const [first, second] = await roots();
    const asset = findAsset('both.txt', [first, second]);
    assert.equal(asset?.file, path.join(first, 'both.txt'));
    assert.equal(asset.stats.size, 5);
    assert.equal(asset.contentType, 'text/plain; charset=utf-8');
    assert.match(asset.etag, /^"5-[0-9a-f]+"$/);
    assert.equal(
      findAsset('/css/site.css', [first, second])?.contentType,
      'text/css; charset=utf-8',
    );
  });

  it('names a media type by extension, and octet-stream for one it does not know', async () => {
    const [first, second] = await roots();
    assert.equal(findAsset('clip.vtt', [first, second])?.contentType, 'text/vtt; charset=utf-8');
    assert.equal(findAsset('blob.bin', [first, second])?.contentType, 'application/octet-stream');
  });

  it('finds nothing outside its roots, at a directory, or for a name nothing has', async () => {
    const [first, second] = await roots();
    assert.equal(findAsset('../secret.txt', [first, second]), undefined);
    assert.equal(findAsset('css/../../secret.txt', [first]), undefined);
    assert.equal(findAsset('css', [first]), undefined);
    assert.equal(findAsset('css/', [first]), undefined);
    assert.equal(findAsset('', [first]), undefined);
    assert.equal(findAsset('nul\0.txt', [first]), undefined);
    assert.equal(findAsset('missing.txt', [first, second]), undefined);
  });

  it('serves an uploaded PDF as application/pdf, so a browser opens it', async () => {
    const [, second] = await roots();
    await writeFile(path.join(second, 'resume.pdf'), '%PDF-1.7');
    assert.equal(findAsset('resume.pdf', [second])?.contentType, 'application/pdf');
  });

  it('serves every extension an upload may have as the type that upload is', async () => {
    const [, second] = await roots();
    for (const [extension, media] of UPLOAD_MEDIA_TYPES) {
      await writeFile(path.join(second, `upload${extension}`), '');
      const served = findAsset(`upload${extension}`, [second])?.contentType;
      assert.equal(served?.split(';')[0], canonicalType(media), extension);
    }
  });
});
