import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { findUpload, UPLOAD_ASSET_PREFIX, UPLOAD_DIRECTORY } from './uploads.ts';

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('findUpload', () => {
  it('finds a file under content/uploads/ by the path after /uploads/', async () => {
    const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-uploads-'));
    dirs.push(contentDir);
    await mkdir(path.join(contentDir, UPLOAD_DIRECTORY, '2026'), { recursive: true });
    await writeFile(path.join(contentDir, UPLOAD_DIRECTORY, '2026', 'a.png'), 'png');
    await writeFile(path.join(contentDir, 'secret.md'), 'no');

    const url = `${UPLOAD_ASSET_PREFIX}2026/a.png`;
    const found = findUpload(url.slice(UPLOAD_ASSET_PREFIX.length), contentDir);
    assert.equal(found?.file, path.join(contentDir, 'uploads', '2026', 'a.png'));
    assert.equal(found.stats.size, 3);
    assert.equal(findUpload('../secret.md', contentDir), undefined);
    assert.equal(findUpload('2026/missing.png', contentDir), undefined);
  });
});
