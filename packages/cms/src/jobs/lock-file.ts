import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { isAlive } from './processes.ts';

const STALE_LOCK_MS = 10_000;
const LOCK_RETRY_MS = 5;

/** The lock file that guards one file. */
export function lockFileFor(file: string): string {
  return `${file}.lock`;
}

/** The file only one waiter can create, to take over or release a lock. */
export function guardFileFor(lockFile: string): string {
  return `${lockFile}.takeover`;
}

/**
 * Hold a lock file for the length of a task, so a second process waits. A
 * lock file whose process has gone, or that has outlived any honest write,
 * is taken over, by one waiter only: it is removed under a guard file that
 * only one waiter can create, after checking again that it is still stale,
 * so a waiter that read the old lock never removes the one that replaced it.
 * A holder that ran past the stale age may have lost its lock that way, so it
 * unlocks under the same guard and only when the lock is still its own.
 */
export async function withLockFile<T>(lockFile: string, task: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lockFile), { recursive: true });
  const token = newToken();
  for (;;) {
    if (await create(lockFile, token)) break;
    if (await isStale(lockFile)) await takeOver(lockFile);
    else await delay(LOCK_RETRY_MS);
  }
  try {
    return await task();
  } finally {
    while (!(await underGuard(lockFile, () => unlock(lockFile, token)))) {
      await delay(LOCK_RETRY_MS);
    }
  }
}

async function unlock(lockFile: string, token: string): Promise<void> {
  const holder = await readFile(lockFile, 'utf8').catch(() => undefined);
  if (holder === token) await unlink(lockFile).catch(() => undefined);
}

async function takeOver(lockFile: string): Promise<void> {
  const tookGuard = await underGuard(lockFile, async () => {
    if (await isStale(lockFile)) await unlink(lockFile).catch(() => undefined);
  });
  if (!tookGuard) await delay(LOCK_RETRY_MS);
}

async function underGuard(lockFile: string, task: () => Promise<void>): Promise<boolean> {
  const guard = guardFileFor(lockFile);
  if (!(await create(guard, newToken()))) {
    if (await isStale(guard)) await unlink(guard).catch(() => undefined);
    return false;
  }
  try {
    await task();
  } finally {
    await unlink(guard).catch(() => undefined);
  }
  return true;
}

async function create(file: string, contents: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
  return true;
}

async function isStale(lockFile: string): Promise<boolean> {
  try {
    const [token, info] = await Promise.all([readFile(lockFile, 'utf8'), stat(lockFile)]);
    if (Date.now() - info.mtimeMs > STALE_LOCK_MS) return true;
    const pid = pidOf(token);
    return Number.isInteger(pid) && pid > 0 && !isAlive(pid);
  } catch {
    return false;
  }
}

function newToken(): string {
  return `${String(process.pid)} ${randomUUID()}`;
}

function pidOf(token: string): number {
  return Number(token.split(' ')[0]);
}
