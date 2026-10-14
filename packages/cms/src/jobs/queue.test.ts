import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { systemClock } from '../util/clock.ts';
import { createFileRecords } from './file-records.ts';
import { createInProcessTransport } from './in-process.ts';
import { createJobQueue, MAX_PAYLOAD_BYTES } from './queue.ts';
import type { Claimer, JobDefinition, JobQueue, Json } from './types.ts';

const directories: string[] = [];
after(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function recordsFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'geekity-job-queue-'));
  directories.push(directory);
  return path.join(directory, 'jobs.json');
}

const count: JobDefinition<{ to: number }, { counted: number }> = {
  name: 'count',
  parse(payload) {
    const to = (payload as { to?: unknown } | null)?.to;
    if (typeof to !== 'number') throw new Error('count needs a number to count to.');
    return { to };
  },
  async run({ to }, context) {
    for (let done = 1; done <= to; done += 1) await context.progress({ done, total: to });
    return { counted: to };
  },
};

function queueOn(file: string, jobs: readonly JobDefinition[] = [count]): JobQueue {
  return createJobQueue({
    transport: createInProcessTransport(),
    records: createFileRecords(file),
    jobs,
    now: systemClock,
  });
}

describe('a job queue', () => {
  it('checks a payload against its job definition when it is queued', () => {
    const queue = queueOn('unused.json');
    const typed = (): Promise<string> => queue.enqueue(count, { to: 3 });
    // @ts-expect-error -- the payload of a count job is { to: number }
    const mistyped = (): Promise<string> => queue.enqueue(count, { to: 'three' });
    assert.equal(typeof typed, 'function');
    assert.equal(typeof mistyped, 'function');
  });

  it('refuses a payload over 64 KB', async () => {
    const big: JobDefinition = {
      name: 'big',
      parse: (payload: Json) => payload,
      run: () => Promise.resolve(null),
    };
    const queue = queueOn(await recordsFile(), [big]);
    await assert.rejects(queue.enqueue(big, 'x'.repeat(MAX_PAYLOAD_BYTES)), /over 65536 bytes/);
  });

  it('fails a job whose payload its definition does not accept', async () => {
    const queue = queueOn(await recordsFile());
    const id = await queue.enqueue(count, { to: 'three' } as unknown as { to: number });
    const status = await queue.run(id);
    assert.equal(status.state, 'failed');
    assert.equal(status.state === 'failed' && status.error, 'count needs a number to count to.');
  });

  it('fails a queued job whose definition is no longer registered', async () => {
    const file = await recordsFile();
    const id = await queueOn(file).enqueue(count, { to: 1 });
    const status = await queueOn(file, []).run(id);
    assert.equal(status.state, 'failed');
    assert.match(
      status.state === 'failed' ? status.error : '',
      /No handler is registered for count/,
    );
  });

  it('runs one job in this process, with progress and a result, without being started', async () => {
    const queue = queueOn(await recordsFile());
    const id = await queue.enqueue(count, { to: 3 });
    const status = await queue.run(id);
    assert.equal(status.state, 'finished');
    assert.deepEqual(status.state === 'finished' && status.result, { counted: 3 });
    assert.deepEqual(await queue.latest('count'), status);
  });

  it('runs no start-up recovery when it runs one job, leaving a job another worker runs alone', async () => {
    const file = await recordsFile();
    const records = createFileRecords(file);
    const server = await queueOn(file).enqueue(count, { to: 1 });
    assert.ok(
      await records.transition(
        server,
        { state: 'queued', attempt: 1 },
        {
          state: 'running',
          attempt: 1,
          owner: 'the server',
          startedAt: '2026-10-14T00:00:00.000Z',
        },
      ),
    );

    const cli = queueOn(file);
    const id = await cli.enqueue(count, { to: 1 });
    assert.equal((await cli.run(id)).state, 'finished');

    const untouched = await records.get(server);
    assert.equal(untouched?.state, 'running');
    assert.equal(untouched.state === 'running' && untouched.owner, 'the server');
    assert.equal(untouched.attempt, 1);
  });
});

describe('start-up recovery', () => {
  async function recoveredAttempt(claimer: Claimer): Promise<number | undefined> {
    const file = await recordsFile();
    const records = createFileRecords(file);
    const id = await queueOn(file).enqueue(count, { to: 1 });
    assert.ok(
      await records.transition(
        id,
        { state: 'queued', attempt: 1 },
        {
          state: 'running',
          attempt: 1,
          owner: 'another worker',
          claimer,
          startedAt: '2026-10-14T00:00:00.000Z',
        },
      ),
    );
    const server = queueOn(file);
    await server.start();
    const attempt = (await records.get(id))?.attempt;
    await server.close();
    return attempt;
  }

  it('recovers a job whose claiming process id now names a process that started since', async () => {
    const attempt = await recoveredAttempt({
      host: hostname(),
      pid: process.ppid,
      since: 'not when that process started',
    });
    assert.equal(attempt, 2);
  });

  it('recovers a job claimed on another host, whose process it cannot see', async () => {
    assert.equal(await recoveredAttempt({ host: `not-${hostname()}`, pid: process.ppid }), 2);
  });

  it('recovers a job that names no claiming process', async () => {
    const file = await recordsFile();
    const records = createFileRecords(file);
    const id = await queueOn(file).enqueue(count, { to: 1 });
    await records.transition(
      id,
      { state: 'queued', attempt: 1 },
      { state: 'running', attempt: 1, owner: 'old', startedAt: '2026-10-14T00:00:00.000Z' },
    );
    const server = queueOn(file);
    await server.start();
    assert.equal((await records.get(id))?.attempt, 2);
    await server.close();
  });
});
