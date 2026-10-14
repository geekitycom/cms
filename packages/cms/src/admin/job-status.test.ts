import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { nextEvent } from '../__testing__/wait.ts';
import { createFileRecords } from '../jobs/file-records.ts';
import { createInProcessTransport } from '../jobs/in-process.ts';
import { createJobQueue } from '../jobs/queue.ts';
import type { JobDefinition, JobQueue } from '../jobs/types.ts';
import { systemClock } from '../util/clock.ts';
import { enqueueUnlessActive } from './job-status.ts';

const directories: string[] = [];
after(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise((resolve) => child.once('close', resolve));
  assert.ok(child.pid !== undefined);
  return child.pid;
}

describe('queueing a job from the admin', () => {
  it('runs a job left running by a CLI process killed after the server started, then queues it again', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'geekity-job-status-'));
    directories.push(directory);
    const file = path.join(directory, 'jobs.json');
    const records = createFileRecords(file);
    let ran: (attempt: number) => void = () => undefined;
    const sweep: JobDefinition<null, string> = {
      name: 'sweep',
      parse: () => null,
      run: (_payload, context) => {
        ran(context.attempt);
        return Promise.resolve('swept');
      },
    };
    const queueOn = (): JobQueue =>
      createJobQueue({
        transport: createInProcessTransport(),
        records,
        jobs: [sweep],
        now: systemClock,
      });

    const server = queueOn();
    await server.start();

    const cut = await queueOn().enqueue(sweep, null);
    assert.ok(
      await records.transition(
        cut,
        { state: 'queued', attempt: 1 },
        {
          state: 'running',
          attempt: 1,
          owner: 'a CLI command',
          claimer: { host: hostname(), pid: await deadPid() },
          startedAt: '2026-10-14T00:00:00.000Z',
        },
      ),
    );

    const rerun = nextEvent<number>('the cut-off job running again', (done) => {
      ran = done;
    });
    assert.equal(await enqueueUnlessActive(server, sweep, null), undefined);
    assert.equal(await rerun, 2);
    await server.settled();
    const done = await records.get(cut);
    assert.equal(done?.state, 'finished');
    assert.equal(done.attempt, 2);

    const again = await enqueueUnlessActive(server, sweep, null);
    assert.equal(typeof again, 'string');
    await server.close();
  });
});
