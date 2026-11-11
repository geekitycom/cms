import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { lockFileFor, withLockFile } from '../files/lock-file.ts';

import { claimObjectId, readObjectIds, recordDeleted } from './object-ids.ts';
import { recordResolvedTarget, resolvedTarget } from './reply-targets.ts';

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

describe('another process writing the file at the same time', () => {
  async function whileAnotherProcessWrites(
    file: string,
    mine: () => Promise<void>,
    change: (record: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    let writing: Promise<void> | undefined;
    await withLockFile(lockFileFor(file), async () => {
      const record = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
      writing = mine();
      await writeFile(`${file}.theirs`, `${JSON.stringify(change(record), null, 2)}\n`);
      await rename(`${file}.theirs`, file);
    });
    await writing;
  }

  it('keeps the deletion that process recorded, and its own', async () => {
    const { contentDir: dir, file } = await contentDir('{"deleted": [], "reissued": {}}\n');
    const theirs = `${POST}theirs/`;
    await whileAnotherProcessWrites(
      file,
      () => recordDeleted(dir, POST),
      (record) => ({ ...record, deleted: [theirs] }),
    );

    assert.deepEqual([...readObjectIds(dir).deleted].sort(), [POST, theirs].sort());
  });

  it('keeps the reply target that process recorded, and its own', async () => {
    const { contentDir: dir } = await contentDir();
    const file = path.join(dir, '_data', 'federation', 'replyTargets.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{}\n');
    await whileAnotherProcessWrites(
      file,
      () => recordResolvedTarget(dir, 'https://elsewhere.example/a', null),
      (record) => ({ ...record, 'https://elsewhere.example/b': null }),
    );

    assert.equal(resolvedTarget(dir, 'https://elsewhere.example/a'), null);
    assert.equal(resolvedTarget(dir, 'https://elsewhere.example/b'), null);
  });
});
