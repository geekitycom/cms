import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { isAlive } from './processes.ts';

/** A lock file older than this was left by a process that died holding it. */
const STALE_LOCK_MS = 10_000;
const LOCK_RETRY_MS = 5;

/**
 * Hold a lock file for the length of a task, so a second process waits. A
 * lock file whose process has gone, or that has outlived any honest write,
 * is taken over, by one waiter only: it is removed under a guard file that
 * only one waiter can create, after checking again that it is still stale,
 * so a waiter that read the old lock never removes the one that replaced it.
 */
export async function withLockFile<T>(lockFile: string, task: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lockFile), { recursive: true });
  for (;;) {
    if (await create(lockFile)) break;
    if (await isStale(lockFile)) await takeOver(lockFile);
    else await delay(LOCK_RETRY_MS);
  }
  try {
    return await task();
  } finally {
    await unlink(lockFile).catch(() => undefined);
  }
}

async function takeOver(lockFile: string): Promise<void> {
  const guard = `${lockFile}.takeover`;
  if (!(await create(guard))) {
    if (await isStale(guard)) await unlink(guard).catch(() => undefined);
    else await delay(LOCK_RETRY_MS);
    return;
  }
  try {
    if (await isStale(lockFile)) await unlink(lockFile).catch(() => undefined);
  } finally {
    await unlink(guard).catch(() => undefined);
  }
}

/** Create a file holding this process's id, unless it exists. */
async function create(file: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    await handle.writeFile(String(process.pid));
  } finally {
    await handle.close();
  }
  return true;
}

async function isStale(lockFile: string): Promise<boolean> {
  try {
    const [owner, info] = await Promise.all([readFile(lockFile, 'utf8'), stat(lockFile)]);
    if (Date.now() - info.mtimeMs > STALE_LOCK_MS) return true;
    const pid = Number(owner);
    return Number.isInteger(pid) && pid > 0 && !isAlive(pid);
  } catch {
    return false;
  }
}
