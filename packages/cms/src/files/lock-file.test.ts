import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { withLockFile } from './lock-file.ts';

const execFile = promisify(execFileCallback);
const OTHER_PROCESS_TIMEOUT_MS = 30_000;
const OTHER_PROCESS = path.join(import.meta.dirname, '__fixtures__', 'lock-process.ts');

const directories: string[] = [];
after(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function staleLock(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'geekity-lock-file-'));
  directories.push(directory);
  const lock = path.join(directory, 'jobs.json.lock');
  await writeFile(lock, String(process.pid));
  const long = new Date(0);
  await utimes(lock, long, long);
  return lock;
}

const turns = async (count: number) => {
  for (let turn = 0; turn < count; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

describe('the records lock file', () => {
  it('lets one of several waiters that find it stale at once take it over', async () => {
    const lock = await staleLock();
    let holding = 0;
    let most = 0;
    let ran = 0;

    await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        await turns(index);
        await withLockFile(lock, async () => {
          holding += 1;
          most = Math.max(most, holding);
          await turns(20);
          holding -= 1;
          ran += 1;
        });
      }),
    );

    assert.equal(ran, 40);
    assert.equal(most, 1, 'two waiters held the lock at once');
    assert.deepEqual(await readdir(path.dirname(lock)), []);
  });

  it('lets one of several processes that find it stale at once take it over', async () => {
    const lock = await staleLock();
    const log = path.join(path.dirname(lock), 'holders.log');

    await Promise.all(
      Array.from({ length: 6 }, () =>
        execFile(process.execPath, [OTHER_PROCESS, lock, log, '4'], {
          timeout: OTHER_PROCESS_TIMEOUT_MS,
        }),
      ),
    );

    const lines = (await readFile(log, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 6 * 4 * 2);
    lines.forEach((line, index) => {
      assert.equal(line.split(' ')[0], index % 2 === 0 ? 'enter' : 'leave', 'held at once');
      if (index % 2 === 1) assert.equal(line.split(' ')[1], lines[index - 1]?.split(' ')[1]);
    });
  });

  it('leaves the lock of a waiter that took it over when the holder that ran past the stale age unlocks', async () => {
    const lock = await staleLock();
    await rm(lock);
    let waiterInside: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => (waiterInside = resolve));
    let releaseWaiter: () => void = () => undefined;
    const released = new Promise<void>((resolve) => (releaseWaiter = resolve));
    let waiter: Promise<void> | undefined;

    await withLockFile(lock, async () => {
      const long = new Date(0);
      await utimes(lock, long, long);
      waiter = withLockFile(lock, async () => {
        waiterInside();
        await released;
      });
      await inside;
    });

    assert.ok(existsSync(lock), 'the late holder removed the lock the waiter now holds');
    releaseWaiter();
    await waiter;
    assert.deepEqual(await readdir(path.dirname(lock)), []);
  });
});
