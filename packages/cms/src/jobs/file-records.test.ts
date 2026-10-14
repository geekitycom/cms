import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { createFileRecords, KEPT_PER_NAME } from './file-records.ts';
import type { JobStatus } from './types.ts';

const execFile = promisify(execFileCallback);
const TSX = import.meta.resolve('tsx');
const OTHER_PROCESS_TIMEOUT_MS = 30_000;
const OTHER_PROCESS = path.join(import.meta.dirname, '__fixtures__', 'records-process.ts');

const directories: string[] = [];
after(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'geekity-job-records-'));
  directories.push(directory);
  return directory;
}

function queued(id: string, name = 'sweep'): JobStatus {
  return {
    id,
    name,
    payload: { id },
    queuedAt: '2026-10-14T00:00:00.000Z',
    state: 'queued',
    attempt: 1,
  };
}

async function finish(records: ReturnType<typeof createFileRecords>, id: string): Promise<void> {
  assert.ok(
    await records.transition(
      id,
      { state: 'queued', attempt: 1 },
      { state: 'finished', attempt: 1, finishedAt: '2026-10-14T00:01:00.000Z', result: null },
    ),
  );
}

function inOtherProcesses(file: string, processes: number, args: (index: number) => string[]) {
  return Promise.all(
    Array.from({ length: processes }, (_, index) =>
      execFile(process.execPath, ['--import', TSX, OTHER_PROCESS, file, ...args(index)], {
        timeout: OTHER_PROCESS_TIMEOUT_MS,
      }),
    ),
  );
}

describe('the job records file', () => {
  it('keeps every job in one JSON file and leaves nothing else beside it', async () => {
    const directory = await scratch();
    const file = path.join(directory, 'jobs.json');
    const records = createFileRecords(file);

    await records.create(queued('one'));
    await records.create(queued('two'));
    await finish(records, 'one');

    assert.deepEqual(await readdir(directory), ['jobs.json']);
    const stored = JSON.parse(await readFile(file, 'utf8')) as JobStatus[];
    assert.deepEqual(
      stored.map((job) => [job.id, job.state]),
      [
        ['one', 'finished'],
        ['two', 'queued'],
      ],
    );
    assert.deepEqual(await createFileRecords(file).get('two'), queued('two'));
  });

  it('moves a job only from the state and attempt the caller expected', async () => {
    const records = createFileRecords(path.join(await scratch(), 'jobs.json'));
    await records.create(queued('one'));

    const claim = {
      state: 'running',
      attempt: 1,
      owner: 'a',
      startedAt: '2026-10-14T00:00:01.000Z',
    } as const;
    assert.equal(await records.transition('one', { state: 'queued', attempt: 2 }, claim), false);
    assert.equal(await records.transition('one', { state: 'queued', attempt: 1 }, claim), true);
    assert.equal(await records.transition('one', { state: 'queued', attempt: 1 }, claim), false);
    assert.equal(
      await records.transition('missing', { state: 'queued', attempt: 1 }, claim),
      false,
    );
  });

  it(`keeps the newest ${String(KEPT_PER_NAME)} ended jobs of each name, and every queued and running one`, async () => {
    const records = createFileRecords(path.join(await scratch(), 'jobs.json'));
    await records.create(queued('waiting'));
    for (let index = 0; index < KEPT_PER_NAME + 3; index += 1) {
      await records.create(queued(`sweep-${String(index)}`));
      await finish(records, `sweep-${String(index)}`);
    }
    await records.create(queued('other', 'resend'));
    await finish(records, 'other');

    const kept = await records.list(['queued', 'finished']);
    assert.deepEqual(
      kept.map((job) => job.id),
      ['waiting', 'sweep-3', 'sweep-4', 'sweep-5', 'sweep-6', 'sweep-7', 'other'],
    );
    assert.equal((await records.latest('sweep'))?.id, 'sweep-7');
  });

  it('refuses to read a file that is not a list of job records rather than dropping it', async () => {
    const file = path.join(await scratch(), 'jobs.json');
    await writeFile(file, '{"not": "a list"}');
    await assert.rejects(createFileRecords(file).get('one'), /is not a list of job records/);
  });

  it('loses no write when several processes create jobs at once', async () => {
    const file = path.join(await scratch(), 'jobs.json');
    await inOtherProcesses(file, 4, (index) => ['create', `process-${String(index)}`, '25']);

    const stored = await createFileRecords(file).list(['queued']);
    assert.equal(stored.length, 100);
    assert.equal(new Set(stored.map((job) => job.id)).size, 100);
  });

  it('creates a job only when the newest of its name does not block it', async () => {
    const records = createFileRecords(path.join(await scratch(), 'jobs.json'));
    const waiting = (latest: JobStatus) => latest.state === 'queued';

    assert.equal(await records.create(queued('one'), waiting), undefined);
    assert.deepEqual(await records.create(queued('two'), waiting), queued('one'));
    assert.equal(await records.create(queued('other', 'resend'), waiting), undefined);
    await finish(records, 'one');
    assert.equal(await records.create(queued('three'), waiting), undefined);

    assert.deepEqual(
      (await records.list(['queued', 'finished'])).map((job) => job.id),
      ['one', 'other', 'three'],
    );
  });

  it('lets one of several processes create a job its blocker refuses to the rest', async () => {
    const file = path.join(await scratch(), 'jobs.json');
    await inOtherProcesses(file, 4, (index) => [
      'create-unless-queued',
      `process-${String(index)}`,
      '10',
    ]);

    assert.equal((await createFileRecords(file).list(['queued'])).length, 1);
  });

  it('lets one process claim each job when several run the same jobs at once', async () => {
    const directory = await scratch();
    const file = path.join(directory, 'jobs.json');
    const log = path.join(directory, 'runs.log');
    const records = createFileRecords(file, { keep: 100 });
    for (let index = 0; index < 20; index += 1) {
      const id = `shared-${String(index)}`;
      await records.create({ ...queued(id, 'logged'), payload: id });
    }

    const outputs = await inOtherProcesses(file, 4, () => ['run', 'shared', '20', log]);

    const runs = (await readFile(log, 'utf8')).trim().split('\n');
    const ran = runs.map((line) => line.split(' ')[0]).sort();
    assert.deepEqual(
      ran,
      Array.from({ length: 20 }, (_, index) => `shared-${String(index)}`).sort(),
      'every job ran exactly once',
    );
    for (const { stdout } of outputs) {
      assert.deepEqual(new Set(stdout.split('\n')), new Set(['finished']));
    }
  });
});
