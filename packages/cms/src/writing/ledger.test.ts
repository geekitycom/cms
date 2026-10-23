import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { CORE_DATA_FILES, classifyFiles } from '../files/data-files.ts';
import { creditWriting, discardWritingLedger, readWritingLedger } from './ledger.ts';

const dirs: string[] = [];
after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-writing-'));
  dirs.push(dir);
  return dir;
}

const CHICAGO = 'America/Chicago';

function credit(
  dir: string,
  userId: number,
  before: string,
  after: string,
  at = '2026-10-23T15:00:00Z',
  timezone = 'UTC',
): Promise<number> {
  return creditWriting(dir, { userId, before, after, at: new Date(at), timezone });
}

describe('the writing ledger', () => {
  it('reads as empty for a user who has written nothing', async () => {
    assert.deepEqual(readWritingLedger(await dataDir(), 1), { days: {} });
  });

  it('adds the words one body adds to another to the day, and answers the day total', async () => {
    const dir = await dataDir();
    assert.equal(await credit(dir, 1, '', 'one two three'), 3);
    assert.equal(await credit(dir, 1, 'one two three', 'one two three four five'), 5);
    assert.deepEqual(readWritingLedger(dir, 1), { days: { '2026-10-23': 5 } });
  });

  it('stores no day for a credit of nothing, and still answers the day total', async () => {
    const dir = await dataDir();
    assert.equal(await credit(dir, 1, 'one two', 'one'), 0);
    assert.deepEqual(readWritingLedger(dir, 1), { days: {} });
    assert.deepEqual(await readdir(dir), []);
    await credit(dir, 1, '', 'one two');
    assert.equal(await credit(dir, 1, 'one two', 'one two'), 2);
  });

  it('buckets days in the site timezone: 23:59 and 00:01 there are different days', async () => {
    const dir = await dataDir();
    await credit(dir, 1, '', 'late night words', '2026-10-24T04:59:00Z', CHICAGO);
    await credit(dir, 1, '', 'early', '2026-10-24T05:01:00Z', CHICAGO);
    assert.deepEqual(readWritingLedger(dir, 1), {
      days: { '2026-10-23': 3, '2026-10-24': 1 },
    });
  });

  it('keeps each user in a file of their own', async () => {
    const dir = await dataDir();
    await credit(dir, 1, '', 'one two');
    await credit(dir, 2, '', 'one two three');
    assert.deepEqual(readWritingLedger(dir, 1), { days: { '2026-10-23': 2 } });
    assert.deepEqual(readWritingLedger(dir, 2), { days: { '2026-10-23': 3 } });
  });

  it('loses no credit when two land at once', async () => {
    const dir = await dataDir();
    await Promise.all(Array.from({ length: 20 }, () => credit(dir, 1, '', 'word')));
    assert.deepEqual(readWritingLedger(dir, 1), { days: { '2026-10-23': 20 } });
  });

  it('writes data/writing/<userId>.json, declared kept, mode 0600', async () => {
    const dir = await dataDir();
    await credit(dir, 7, '', 'one two');

    const files = classifyFiles(dir, CORE_DATA_FILES);
    assert.deepEqual(
      files.map((file) => [file.relative, file.declaration?.dataClass.kind]),
      [['writing/7.json', 'kept']],
    );
    const absolute = path.join(dir, 'writing', '7.json');
    assert.equal((await stat(absolute)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(absolute, 'utf8')), {
      days: { '2026-10-23': 2 },
    });
  });

  it('deletes a user ledger and leaves the others', async () => {
    const dir = await dataDir();
    await credit(dir, 1, '', 'one');
    await credit(dir, 2, '', 'two');
    discardWritingLedger(dir, 1);
    discardWritingLedger(dir, 3);
    assert.deepEqual(readWritingLedger(dir, 1), { days: {} });
    assert.deepEqual(await readdir(path.join(dir, 'writing')), ['2.json']);
  });

  it('leaves a ledger it cannot read alone and warns instead of failing the write', async (t) => {
    const warn = t.mock.method(console, 'warn', () => undefined);
    const dir = await dataDir();
    await credit(dir, 1, '', 'one');
    const file = path.join(dir, 'writing', '1.json');
    await writeFile(file, '{ not json');
    assert.equal(await credit(dir, 1, '', 'two'), 0);
    assert.equal(await readFile(file, 'utf8'), '{ not json');
    assert.match(String(warn.mock.calls[0]?.arguments[0]), /writing\/1\.json/);
    assert.throws(() => readWritingLedger(dir, 1), /writing\/1\.json/);
  });
});
