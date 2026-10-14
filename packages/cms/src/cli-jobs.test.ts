import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { cleanupTemporaryDirs, PACKAGE_ROOT, temporaryDir } from './__testing__/cli.ts';
import { nextEvent } from './__testing__/wait.ts';
import { createFileRecords } from './jobs/file-records.ts';
import type { JobStatus } from './jobs/types.ts';
import { askToReload, controlSocketPath, isServing } from './supervisor/control.ts';

after(cleanupTemporaryDirs);

const CLI = path.join(PACKAGE_ROOT, 'src', 'cli.ts');
const TSX = import.meta.resolve('tsx');
const CONFIG = path.join(import.meta.dirname, 'jobs', '__fixtures__', 'serve-config.ts');
const CLAIM = path.join(import.meta.dirname, 'jobs', '__fixtures__', 'claim-process.ts');
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
  logged(line: RegExp, times?: number): Promise<string>;
  recorded(check: (status: JobStatus) => boolean): Promise<JobStatus>;
  runs(): Promise<string[]>;
  release(): Promise<void>;
}

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

async function site(
  options: { plugins?: Record<string, { enabled: boolean }> } = {},
): Promise<Site> {
  const directory = await fs.realpath(await temporaryDir('geekity-jobs-serve-'));
  const dataDir = path.join(directory, 'data');
  await fs.mkdir(path.join(directory, 'content', '_data'), { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'content', '_data', 'site.json'),
    JSON.stringify({ title: 'Jobs', ...(options.plugins ? { plugins: options.plugins } : {}) }),
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

function runInCli(site: Site): { child: ChildProcess; output: Promise<string> } {
  const child = spawn(
    process.execPath,
    ['--import', TSX, CLAIM, path.join(site.dataDir, 'jobs.json'), site.jobId],
    {
      env: { ...process.env, GEEKITY_TEST_JOB_DIR: site.directory },
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  running.push(child);
  let printed = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (printed += chunk));
  const output = new Promise<string>((resolve) => child.once('close', () => resolve(printed)));
  return { child, output };
}

async function reloadWhenUp(site: Site): Promise<void> {
  const socket = controlSocketPath(site.dataDir);
  await whenChanged('the control socket', tmpdir(), () =>
    Promise.resolve(existsSync(socket) ? true : undefined),
  );
  while (!(await isServing(site.dataDir)));
  assert.deepEqual(await askToReload(site.dataDir), { ok: true });
}

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

  it('leaves a job a live CLI process runs alone when the server starts and reloads (TASK-398 AC #1)', async () => {
    const jobs = await site();
    const cli = runInCli(jobs);
    const claimer = cli.child.pid;
    await jobs.logged(new RegExp(`^start 1 ${String(claimer)}$`));

    const server = serve(jobs);
    await reloadWhenUp(jobs);
    const during = await createFileRecords(path.join(jobs.dataDir, 'jobs.json')).get(jobs.jobId);
    assert.equal(during?.state, 'running');
    assert.equal(during.attempt, 1);
    assert.equal(during.state === 'running' && during.claimer?.pid, claimer);

    await jobs.release();
    assert.equal(await cli.output, 'finished 1');
    assert.deepEqual(await jobs.runs(), [
      `start 1 ${String(claimer)}`,
      `done 1 ${String(claimer)}`,
    ]);

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0);
  });

  it('runs a job whose CLI process was killed again as the next attempt (TASK-398 AC #2)', async () => {
    const jobs = await site();
    const cli = runInCli(jobs);
    await jobs.logged(new RegExp(`^start 1 ${String(cli.child.pid)}$`));
    cli.child.kill('SIGKILL');
    await cli.output;

    const server = serve(jobs);
    const second = pidOf(await jobs.logged(/^start 2 /));
    assert.notEqual(second, cli.child.pid);
    await jobs.release();
    const done = await jobs.recorded((status) => status.state === 'finished');
    assert.equal(done.attempt, 2);

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0);
  });

  it('runs a job the new worker of a failed reload had claimed in the resumed worker, as the next attempt (TASK-400 AC #2)', async () => {
    const jobs = await site({ plugins: { '@test/plugin-fail-boot': { enabled: true } } });
    const server = serve(jobs);

    const old = pidOf(await jobs.logged(/^start 1 /));
    await fs.writeFile(path.join(jobs.directory, 'fail-boot'), '');
    assert.deepEqual(await askToReload(jobs.dataDir), {
      ok: false,
      error: 'The test failed this boot.',
    });
    const discarded = pidOf(await jobs.logged(/^start 1 /, 2));
    assert.notEqual(discarded, old);

    const resumed = pidOf(await jobs.logged(/^start 2 /));
    assert.equal(resumed, old, 'the resumed worker ran it');
    await jobs.release();
    const done = await jobs.recorded((status) => status.state === 'finished');
    assert.equal(done.attempt, 2);

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
