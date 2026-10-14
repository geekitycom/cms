import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import type { JobRecords, JobStateName, JobStatus } from './types.ts';

/** How many finished, failed or interrupted jobs of one name are kept. Queued and running ones always are. */
export const KEPT_PER_NAME = 5;

/** A lock file older than this was left by a process that died holding it. */
const STALE_LOCK_MS = 10_000;
const LOCK_RETRY_MS = 5;

const TERMINAL: ReadonlySet<JobStateName> = new Set(['finished', 'failed', 'interrupted']);

/**
 * The first record store (decision-54): every job in one JSON file, oldest
 * first. A change reads the file, changes it and renames a new copy over it,
 * holding the in-process lock on the path and a lock file beside it, so a CLI
 * process and the server never both win one compare-and-set. A read takes no
 * lock: the rename means it sees a whole file.
 */
export function createFileRecords(file: string, options: { keep?: number } = {}): JobRecords {
  const keep = options.keep ?? KEPT_PER_NAME;
  const lockFile = `${file}.lock`;

  async function read(): Promise<JobStatus[]> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return parseJobs(text, file);
  }

  function change<T>(edit: (jobs: JobStatus[]) => { jobs?: JobStatus[]; value: T }): Promise<T> {
    return withFileLock(file, () =>
      withLockFile(lockFile, async () => {
        const { jobs, value } = edit(await read());
        if (jobs !== undefined) {
          writeFileAtomicallySync(file, `${JSON.stringify(pruned(jobs, keep), null, 2)}\n`);
        }
        return value;
      }),
    );
  }

  return {
    create(status) {
      return change((jobs) => {
        if (jobs.some((job) => job.id === status.id)) {
          throw new Error(`A job with the id ${status.id} is already recorded.`);
        }
        return { jobs: [...jobs, status], value: undefined };
      });
    },

    async get(id) {
      return (await read()).find((job) => job.id === id);
    },

    async latest(name) {
      return (await read()).findLast((job) => job.name === name);
    },

    async list(states) {
      return (await read()).filter((job) => states.includes(job.state));
    },

    transition(id, expected, next) {
      return change((jobs) => {
        const index = jobs.findIndex((job) => job.id === id);
        const job = jobs[index];
        if (job?.state !== expected.state || job.attempt !== expected.attempt) {
          return { value: false };
        }
        const { id: _id, name, payload, queuedAt } = job;
        const moved: JobStatus = { id, name, payload, queuedAt, ...next };
        return { jobs: jobs.with(index, moved), value: true };
      });
    },
  };
}

function pruned(jobs: readonly JobStatus[], keep: number): JobStatus[] {
  const seen = new Map<string, number>();
  const kept: JobStatus[] = [];
  for (const job of jobs.toReversed()) {
    if (TERMINAL.has(job.state)) {
      const count = (seen.get(job.name) ?? 0) + 1;
      seen.set(job.name, count);
      if (count > keep) continue;
    }
    kept.push(job);
  }
  return kept.reverse();
}

function parseJobs(text: string, file: string): JobStatus[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every(isJobStatus)) {
    throw new Error(`${file} is not a list of job records.`);
  }
  return parsed;
}

function isJobStatus(value: unknown): value is JobStatus {
  if (typeof value !== 'object' || value === null) return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.id === 'string' &&
    typeof job.name === 'string' &&
    typeof job.queuedAt === 'string' &&
    typeof job.attempt === 'number' &&
    typeof job.state === 'string' &&
    ['queued', 'running', 'finished', 'failed', 'interrupted'].includes(job.state)
  );
}

/**
 * Hold a lock file for the length of a task, so a second process waits. A
 * lock file whose process has gone, or that has outlived any honest write,
 * is taken over.
 */
async function withLockFile<T>(lockFile: string, task: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(lockFile), { recursive: true });
  for (;;) {
    try {
      const handle = await open(lockFile, 'wx');
      try {
        await handle.writeFile(String(process.pid));
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await isStale(lockFile)) {
        await unlink(lockFile).catch(() => undefined);
        continue;
      }
      await delay(LOCK_RETRY_MS);
    }
  }
  try {
    return await task();
  } finally {
    await unlink(lockFile).catch(() => undefined);
  }
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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
