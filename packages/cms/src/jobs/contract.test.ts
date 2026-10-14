import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';

import { nextEvent } from '../__testing__/wait.ts';
import { systemClock } from '../util/clock.ts';
import { createFileRecords } from './file-records.ts';
import { createInProcessTransport } from './in-process.ts';
import { createJobQueue } from './queue.ts';
import type { JobDefinition, JobRecords, JobStatus, Json, MessageTransport } from './types.ts';

const directories: string[] = [];
after(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function scratch(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

interface ProcessTransport {
  readonly transport: MessageTransport;
  crash(): void;
  dispose(): void;
  handled(count: number): Promise<void>;
}

interface Backend {
  readonly name: string;
  readonly durable: boolean;
  namespace(): Promise<{ connect(): ProcessTransport }>;
}

function crashable(
  inner: MessageTransport,
  dispose: () => void = () => undefined,
): ProcessTransport {
  const dead = new AbortController();
  let handled = 0;
  const listeners = new Set<() => void>();
  return {
    transport: {
      async enqueue(message) {
        if (!dead.signal.aborted) await inner.enqueue(message);
      },
      listen(handler, options) {
        const signal =
          options?.signal === undefined
            ? dead.signal
            : AbortSignal.any([options.signal, dead.signal]);
        return inner.listen(
          async (message) => {
            if (dead.signal.aborted) return new Promise<void>(() => undefined);
            await handler(message);
            handled += 1;
            for (const listener of listeners) listener();
          },
          { signal },
        );
      },
    },
    crash() {
      dead.abort();
    },
    dispose,
    handled(count) {
      return nextEvent(`${String(count)} messages handled`, (done) => {
        const check = () => {
          if (handled >= count) done();
        };
        check();
        listeners.add(check);
        return () => listeners.delete(check);
      });
    },
  };
}

const inProcess: Backend = {
  name: 'in-process transport',
  durable: false,
  namespace() {
    return Promise.resolve({ connect: () => crashable(createInProcessTransport()) });
  },
};

const sqlite: Backend = {
  name: 'Fedify SqliteMessageQueue',
  durable: true,
  async namespace() {
    const file = path.join(await scratch('geekity-jobs-sqlite-'), 'queue.sqlite');
    return {
      connect() {
        const db = new DatabaseSync(file);
        const queue: MessageTransport = new SqliteMessageQueue(db, {
          tableName: 'geekity_job',
          pollInterval: { milliseconds: 50 },
        });
        return crashable(queue, () => {
          db.close();
        });
      },
    };
  },
};

function observed(records: JobRecords): JobRecords & { watch(listener: () => void): () => void } {
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    ...records,
    async create(status) {
      await records.create(status);
      changed();
    },
    async transition(id, expected, next) {
      const moved = await records.transition(id, expected, next);
      if (moved) changed();
      return moved;
    },
    watch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const terminal = (status: JobStatus) =>
  status.state === 'finished' || status.state === 'failed' || status.state === 'interrupted';

const asIs = (payload: Json): Json => payload;

const turns = async (count: number) => {
  for (let turn = 0; turn < count; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

function jobQueueContract(backend: Backend): void {
  describe(backend.name, () => {
    const opened: ProcessTransport[] = [];
    after(() => {
      for (const process of opened) process.dispose();
    });

    async function world() {
      const space = await backend.namespace();
      const records = observed(
        createFileRecords(path.join(await scratch('geekity-jobs-'), 'jobs.json')),
      );
      const runs = new Map<string, number>();
      const gates = new Map<string, { promise: Promise<void>; resolve: () => void }>();
      const gate = (key: string) => {
        let entry = gates.get(key);
        if (entry === undefined) {
          let resolve = (): void => undefined;
          const promise = new Promise<void>((done) => {
            resolve = done;
          });
          entry = { promise, resolve };
          gates.set(key, entry);
        }
        return entry;
      };
      const count = (name: string) => {
        const run = (runs.get(name) ?? 0) + 1;
        runs.set(name, run);
        return run;
      };

      const echo: JobDefinition<Json, { got: Json }> = {
        name: 'echo',
        parse: asIs,
        run(payload) {
          count('echo');
          return Promise.resolve({ got: payload });
        },
      };
      const boom: JobDefinition = {
        name: 'boom',
        parse: asIs,
        run() {
          count('boom');
          return Promise.reject(new Error('nope'));
        },
      };
      const gated: JobDefinition<null, string> = {
        name: 'gated',
        parse: () => null,
        async run(_payload, context) {
          count('gated');
          await context.progress({ done: 1, total: 2, note: 'halfway' });
          await gate('gated').promise;
          return 'opened';
        },
      };
      const patient: JobDefinition<null, string> = {
        name: 'patient',
        parse: () => null,
        async run(_payload, context) {
          if (count('patient') > 1) return 'second run';
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener('abort', () => {
              reject(new Error('stopped'));
            });
          });
          return 'unreachable';
        },
      };
      const hangOnce: JobDefinition<null, { run: number }> = {
        name: 'hang-once',
        parse: () => null,
        async run() {
          const run = count('hang-once');
          if (run === 1) await new Promise(() => undefined);
          return { run };
        },
      };
      const hangAlways: JobDefinition = {
        name: 'hang-always',
        parse: asIs,
        run() {
          count('hang-always');
          return new Promise<never>(() => undefined);
        },
      };
      const jobs = { echo, boom, gated, patient, hangOnce, hangAlways };

      async function boot(options: { start?: boolean; maxAttempts?: number } = {}) {
        const process = space.connect();
        opened.push(process);
        const queue = createJobQueue({
          transport: process.transport,
          records,
          jobs: Object.values(jobs),
          owner: randomUUID(),
          maxAttempts: options.maxAttempts ?? 3,
          now: systemClock,
        });
        if (options.start !== false) await queue.start();
        return { queue, process };
      }

      function waitFor(id: string, test: (status: JobStatus) => boolean): Promise<JobStatus> {
        return nextEvent(`job ${id} to reach the state the test waits for`, (done) => {
          const check = () => {
            void records.get(id).then((status) => {
              if (status !== undefined && test(status)) done(status);
            });
          };
          check();
          return records.watch(check);
        });
      }

      return { boot, records, runs, gate, jobs, waitFor };
    }

    it('C1 runs a job and reports its result', async () => {
      const { boot, jobs, waitFor } = await world();
      const { queue } = await boot();
      const id = await queue.enqueue(jobs.echo, { n: 1, nested: { list: [1, 'x', null] } });
      const status = await waitFor(id, terminal);
      assert.equal(status.state, 'finished');
      assert.deepEqual(status.state === 'finished' && status.result, {
        got: { n: 1, nested: { list: [1, 'x', null] } },
      });
      assert.equal(status.attempt, 1);
      await queue.close();
    });

    it('C2 reports progress while the job runs', async () => {
      const { boot, gate, jobs, waitFor } = await world();
      const { queue } = await boot();
      const id = await queue.enqueue(jobs.gated, null);
      const running = await waitFor(
        id,
        (status) => status.state === 'running' && status.progress !== undefined,
      );
      assert.deepEqual(running.state === 'running' && running.progress, {
        done: 1,
        total: 2,
        note: 'halfway',
      });
      gate('gated').resolve();
      assert.equal((await waitFor(id, terminal)).state, 'finished');
      await queue.close();
    });

    it('C3 records a failure and still runs the next job', async () => {
      const { boot, jobs, waitFor } = await world();
      const { queue } = await boot();
      const failing = await queue.enqueue(jobs.boom, null);
      const next = await queue.enqueue(jobs.echo, 2);
      const failed = await waitFor(failing, terminal);
      assert.equal(failed.state, 'failed');
      assert.equal(failed.state === 'failed' && failed.error, 'nope');
      assert.equal((await waitFor(next, terminal)).state, 'finished');
      await queue.close();
    });

    it('C4 latest(name) gives the newest job of that name', async () => {
      const { boot, jobs, waitFor } = await world();
      const { queue } = await boot();
      const first = await queue.enqueue(jobs.echo, 'a');
      await waitFor(first, terminal);
      const second = await queue.enqueue(jobs.echo, 'b');
      await waitFor(second, terminal);
      assert.equal((await queue.latest('echo'))?.id, second);
      assert.equal(await queue.latest('gated'), undefined);
      await queue.close();
    });

    it('C5 refuses a job no handler is registered for', async () => {
      const { boot } = await world();
      const { queue } = await boot();
      const nobody: JobDefinition = {
        name: 'nobody',
        parse: asIs,
        run: () => Promise.resolve(null),
      };
      await assert.rejects(queue.enqueue(nobody, null), /No handler/);
      await queue.close();
    });

    it('C6 settled() waits for the running job', async () => {
      const { boot, gate, jobs, waitFor } = await world();
      const { queue } = await boot();
      const id = await queue.enqueue(jobs.gated, null);
      await waitFor(id, (status) => status.state === 'running');
      let settled = false;
      const waiting = queue.settled().then(() => (settled = true));
      await turns(20);
      assert.equal(settled, false, 'settled before the job finished');
      gate('gated').resolve();
      await waiting;
      assert.equal((await queue.status(id))?.state, 'finished');
      await queue.close();
    });

    it('C7 stop interrupts the running job, which a restart runs to the end', async () => {
      const { boot, runs, jobs, waitFor } = await world();
      const first = await boot();
      const id = await first.queue.enqueue(jobs.patient, null);
      await waitFor(id, (status) => status.state === 'running');
      await first.queue.close();
      const parked = await first.queue.status(id);
      assert.equal(parked?.state, 'queued', 'a stopped job goes back to queued');
      assert.equal(parked.attempt, 1, 'a graceful stop does not count as an attempt');

      const second = await boot();
      const done = await waitFor(id, terminal);
      assert.equal(done.state, 'finished');
      assert.equal(done.state === 'finished' && done.result, 'second run');
      assert.equal(runs.get('patient'), 2);
      await second.queue.close();
    });

    it('C8 a crash leaves the job to run again as a new attempt, once', async () => {
      const { boot, runs, jobs, waitFor } = await world();
      const first = await boot();
      const id = await first.queue.enqueue(jobs.hangOnce, null);
      await waitFor(id, (status) => status.state === 'running');
      first.process.crash();

      const second = await boot();
      const done = await waitFor(id, terminal);
      assert.equal(done.state, 'finished');
      assert.equal(done.attempt, 2);
      assert.equal(runs.get('hang-once'), 2);
      await second.queue.close();
    });

    it('C9 a job cut off maxAttempts times ends as interrupted and stays there', async () => {
      const { boot, runs, records, jobs, waitFor } = await world();
      const first = await boot({ maxAttempts: 2 });
      const id = await first.queue.enqueue(jobs.hangAlways, null);
      await waitFor(id, (status) => status.state === 'running' && status.attempt === 1);
      first.process.crash();

      const second = await boot({ maxAttempts: 2 });
      await waitFor(id, (status) => status.state === 'running' && status.attempt === 2);
      second.process.crash();

      const third = await boot({ maxAttempts: 2 });
      assert.equal((await waitFor(id, terminal)).state, 'interrupted');
      await third.queue.close();
      assert.equal(runs.get('hang-always'), 2);
      assert.equal((await records.get(id))?.state, 'interrupted');
    });

    it('C10 a duplicate message runs nothing twice', async () => {
      const { boot, runs, jobs, waitFor } = await world();
      const { queue, process } = await boot();
      const id = await queue.enqueue(jobs.echo, 'once');
      await waitFor(id, terminal);
      await process.handled(1);
      await process.transport.enqueue({ id });
      await process.transport.enqueue({ id });
      await process.handled(3);
      assert.equal(runs.get('echo'), 1);
      await queue.close();
    });

    it('C11 a job queued when the process stopped runs after a restart', async () => {
      const { boot, runs, jobs, waitFor } = await world();
      const first = await boot({ start: false });
      const id = await first.queue.enqueue(jobs.echo, 'later');
      first.process.crash();

      const second = await boot();
      assert.equal((await waitFor(id, terminal)).state, 'finished');
      await second.process.handled(backend.durable ? 2 : 1);
      assert.equal(runs.get('echo'), 1);
      await second.queue.close();
    });
  });
}

describe('the job queue contract (decision-54)', () => {
  jobQueueContract(inProcess);
  jobQueueContract(sqlite);
});
