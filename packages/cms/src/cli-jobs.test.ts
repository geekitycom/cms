/**
 * Admin jobs under `geekity serve` (TASK-391): a reload hands a running job
 * to the next worker, and a worker killed mid-job leaves it to run again.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, PACKAGE_ROOT, temporaryDir } from './__testing__/cli.ts';
import { nextEvent } from './__testing__/wait.ts';
import { createFileRecords } from './jobs/file-records.ts';
import type { JobStatus } from './jobs/types.ts';
import { askToReload } from './supervisor/control.ts';

after(cleanupTemporaryDirs);

const CLI = path.join(PACKAGE_ROOT, 'src', 'cli.ts');
const TSX = import.meta.resolve('tsx');
const CONFIG = path.join(import.meta.dirname, 'jobs', '__fixtures__', 'serve-config.ts');
const PROCESS_EVENT_TIMEOUT_MS = 90_000;
const JOB = 'wait-for-release';

const running: ChildProcess[] = [];
after(() => {
  for (const child of running) child.kill('SIGKILL');
});

interface Site {
  readonly directory: string;
  readonly dataDir: string;
  readonly jobId: string;
  /** Resolve with the `times`th line of the runs log that matches. */
  logged(line: RegExp, times?: number): Promise<string>;
  /** Resolve with the job's record once it passes the check. */
  recorded(check: (status: JobStatus) => boolean): Promise<JobStatus>;
  runs(): Promise<string[]>;
  release(): Promise<void>;
}

/** Resolve once `read` gives a value, reading again each time something in the directory changes. */
function whenChanged<T>(
  what: string,
  directory: string,
  read: () => Promise<T | undefined>,
): Promise<T> {
  return nextEvent<T>(
    what,
    (done) => {
      const check = () => {
        void read().then(
          (value) => {
            if (value !== undefined) done(value);
          },
          () => undefined,
        );
      };
      const watcher = watch(directory, check);
      check();
      return () => watcher.close();
    },
    PROCESS_EVENT_TIMEOUT_MS,
  );
}

async function site(): Promise<Site> {
  const directory = await fs.realpath(await temporaryDir('geekity-jobs-serve-'));
  const dataDir = path.join(directory, 'data');
  await fs.mkdir(path.join(directory, 'content', '_data'), { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'content', '_data', 'site.json'),
    JSON.stringify({ title: 'Jobs' }),
  );
  await fs.writeFile(
    path.join(directory, 'geekity.config.ts'),
    `export { default } from ${JSON.stringify(CONFIG)};\n`,
  );
  const records = createFileRecords(path.join(dataDir, 'jobs.json'));
  const jobId = 'queued-before-boot';
  await records.create({
    id: jobId,
    name: JOB,
    payload: null,
    queuedAt: '2026-10-14T00:00:00.000Z',
    state: 'queued',
    attempt: 1,
  });

  const runsLog = path.join(directory, 'runs.log');
  const runs = async () => {
    try {
      return (await fs.readFile(runsLog, 'utf8')).trim().split('\n');
    } catch {
      return [];
    }
  };
  return {
    directory,
    dataDir,
    jobId,
    runs,
    logged: (line, times = 1) =>
      whenChanged(`a run logging ${String(line)}`, directory, async () =>
        (await runs()).filter((entry) => line.test(entry)).at(times - 1),
      ),
    recorded: (check) =>
      whenChanged('the job record the test waits for', dataDir, async () => {
        const status = await records.get(jobId);
        return status !== undefined && check(status) ? status : undefined;
      }),
    release: () => fs.writeFile(path.join(directory, 'release'), ''),
  };
}

function serve(site: Site): { child: ChildProcess; exited: Promise<number | null> } {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GEEKITY_') && name !== 'PORT'),
  );
  const child = spawn(process.execPath, ['--import', TSX, CLI, 'serve'], {
    cwd: site.directory,
    env: {
      ...inherited,
      GEEKITY_PORT: '0',
      GEEKITY_WATCH: 'false',
      GEEKITY_ACCESS_LOG: 'false',
      GEEKITY_TEST_JOB_DIR: site.directory,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  running.push(child);
  const exited = new Promise<number | null>((resolve) => child.once('close', resolve));
  return { child, exited };
}

const pidOf = (line: string) => Number(line.split(' ').at(-1));

describe('admin jobs under geekity serve', () => {
  it('hands a running job back on a reload, and the next worker runs it to the end (AC #5)', async () => {
    const jobs = await site();
    const server = serve(jobs);

    const first = pidOf(await jobs.logged(/^start 1 /));
    assert.deepEqual(await askToReload(jobs.dataDir), { ok: true });
    await jobs.logged(new RegExp(`^aborted 1 ${String(first)}$`));

    const second = pidOf(await jobs.logged(/^start 1 /, 2));
    assert.notEqual(second, first, 'the next worker ran the job, as the same attempt');

    await jobs.release();
    const done = await jobs.recorded((status) => status.state === 'finished');
    assert.equal(done.attempt, 1, 'a graceful stop used no attempt');
    assert.equal(done.state === 'finished' && done.result, 'released');

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0);
  });

  it('runs a job cut off by a killed worker again as the next attempt (AC #6)', async () => {
    const jobs = await site();
    const server = serve(jobs);

    const first = pidOf(await jobs.logged(/^start 1 /));
    process.kill(first, 'SIGKILL');
    await jobs.logged(/^start 2 /);
    await jobs.release();
    const done = await jobs.recorded((status) => status.state === 'finished');
    assert.equal(done.attempt, 2);
    assert.deepEqual(
      (await jobs.runs()).map((line) => line.split(' ').slice(0, 2).join(' ')),
      ['start 1', 'start 2', 'done 2'],
    );

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0);
  });

  it('shows a job cut off three times as interrupted, and runs it no more (AC #6)', async () => {
    const jobs = await site();
    const server = serve(jobs);

    for (const attempt of [1, 2, 3]) {
      process.kill(pidOf(await jobs.logged(new RegExp(`^start ${String(attempt)} `))), 'SIGKILL');
    }
    const ended = await jobs.recorded((status) => status.state === 'interrupted');
    assert.equal(ended.attempt, 3);

    assert.deepEqual(await askToReload(jobs.dataDir), { ok: true });
    assert.deepEqual(
      (await jobs.runs()).map((line) => line.split(' ').slice(0, 2).join(' ')),
      ['start 1', 'start 2', 'start 3'],
      'no worker ran it again',
    );
    assert.equal(
      (await createFileRecords(path.join(jobs.dataDir, 'jobs.json')).get(jobs.jobId))?.state,
      'interrupted',
    );

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0);
  });
});
