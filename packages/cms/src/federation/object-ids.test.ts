import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { claimObjectId, readObjectIds, recordDeleted } from './object-ids.ts';

const POST = 'https://blog.example/2026/09/hello/';

const directories: string[] = [];
after(() => Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true }))));

async function contentDir(objectIds?: string): Promise<{ contentDir: string; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-object-ids-'));
  directories.push(dir);
  const file = path.join(dir, '_data', 'federation', 'objectIds.json');
  if (objectIds !== undefined) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, objectIds);
  }
  return { contentDir: dir, file };
}

describe('a damaged objectIds.json', () => {
  it('reads as empty, and says so once', async (t) => {
    const warn = t.mock.method(console, 'warn', () => undefined);
    const { contentDir: dir, file } = await contentDir('{"deleted": [');

    assert.deepEqual(readObjectIds(dir), { deleted: [], reissued: {} });
    assert.deepEqual(readObjectIds(dir), { deleted: [], reissued: {} });

    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0]?.arguments[0]), new RegExp(file.replaceAll('.', '\\.')));
  });

  it('refuses a write rather than overwriting what it could not read', async (t) => {
    t.mock.method(console, 'warn', () => undefined);
    const damaged = '{"deleted": "not a list", "reissued": {}}';
    const { contentDir: dir, file } = await contentDir(damaged);

    await assert.rejects(recordDeleted(dir, POST), /objectIds\.json/);
    await assert.rejects(claimObjectId(dir, POST), /objectIds\.json/);
    assert.equal(await readFile(file, 'utf8'), damaged);
  });
});

describe('claiming an object id', () => {
  it('reissues a deleted id with the next revision, and keeps it', async () => {
    const { contentDir: dir } = await contentDir();

    assert.equal(await claimObjectId(dir, POST), POST);
    await recordDeleted(dir, POST);
    assert.equal(await claimObjectId(dir, POST), `${POST}?v=2`);
    assert.equal(await claimObjectId(dir, POST), `${POST}?v=2`);
    await recordDeleted(dir, `${POST}?v=2`);
    assert.equal(await claimObjectId(dir, POST), `${POST}?v=3`);
    assert.deepEqual(readObjectIds(dir).reissued, { [POST]: [`${POST}?v=2`, `${POST}?v=3`] });
  });

  it('sees a change written to the file by something else', async () => {
    const { contentDir: dir, file } = await contentDir();
    assert.equal(await claimObjectId(dir, POST), POST);

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ deleted: [POST], reissued: {} }));

    assert.deepEqual(readObjectIds(dir).deleted, [POST]);
  });
});
