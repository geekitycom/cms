import { readFile } from 'node:fs/promises';

import { withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { lockFileFor, withLockFile } from './lock-file.ts';
import { JOB_STATES } from './types.ts';
import type { JobRecords, JobStateName, JobStatus } from './types.ts';

export const KEPT_PER_NAME = 5;

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
  const lockFile = lockFileFor(file);

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
    create(status, blocks) {
      return change<JobStatus | undefined>((jobs) => {
        if (jobs.some((job) => job.id === status.id)) {
          throw new Error(`A job with the id ${status.id} is already recorded.`);
        }
        const latest = jobs.findLast((job) => job.name === status.name);
        if (latest !== undefined && blocks?.(latest) === true) return { value: latest };
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
        const { name, payload, queuedAt } = job;
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
    (JOB_STATES as readonly unknown[]).includes(job.state)
  );
}
