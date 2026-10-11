import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { exists, isFile, isFileSync, isNotFound } from './files.ts';

describe('file checks', () => {
  let dir = '';
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'geekity-files-'));
    await writeFile(path.join(dir, 'a.txt'), 'a');
    await mkdir(path.join(dir, 'sub'));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('exists is true for a file or a directory and false for a missing path', async () => {
    assert.equal(await exists(path.join(dir, 'a.txt')), true);
    assert.equal(await exists(path.join(dir, 'sub')), true);
    assert.equal(await exists(path.join(dir, 'missing.txt')), false);
    assert.equal(await exists(path.join(dir, 'a.txt', 'below')), false);
  });

  it('isFile is true only for a file', async () => {
    assert.equal(await isFile(path.join(dir, 'a.txt')), true);
    assert.equal(await isFile(path.join(dir, 'sub')), false);
    assert.equal(await isFile(path.join(dir, 'missing.txt')), false);
  });

  it('isFileSync agrees with isFile', () => {
    assert.equal(isFileSync(path.join(dir, 'a.txt')), true);
    assert.equal(isFileSync(path.join(dir, 'sub')), false);
    assert.equal(isFileSync(path.join(dir, 'missing.txt')), false);
  });

  it('isNotFound names the errors that mean nothing is there', () => {
    assert.equal(isNotFound(Object.assign(new Error('x'), { code: 'ENOENT' })), true);
    assert.equal(isNotFound(Object.assign(new Error('x'), { code: 'ENOTDIR' })), true);
    assert.equal(isNotFound(Object.assign(new Error('x'), { code: 'EACCES' })), false);
    assert.equal(isNotFound('ENOENT'), false);
    assert.equal(isNotFound(null), false);
  });
});
