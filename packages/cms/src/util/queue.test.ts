import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createConcurrencyLimit, createSerialQueue } from './queue.ts';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('createSerialQueue', () => {
  it('runs jobs one at a time, in the order they were queued', async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    const gate = deferred();

    const first = queue.run(async () => {
      log.push('first start');
      await gate.promise;
      log.push('first end');
      return 1;
    });
    const second = queue.run(() => {
      log.push('second');
      return Promise.resolve(2);
    });

    await Promise.resolve();
    assert.deepEqual(log, ['first start']);
    gate.resolve();

    assert.equal(await first, 1);
    assert.equal(await second, 2);
    assert.deepEqual(log, ['first start', 'first end', 'second']);
  });

  it('hands a failing job its rejection and runs the next job anyway', async () => {
    const queue = createSerialQueue();

    const failing = queue.run(() => Promise.reject(new Error('boom')));
    const next = queue.run(() => Promise.resolve('ran'));

    await assert.rejects(failing, /boom/);
    assert.equal(await next, 'ran');
    await queue.settled();
  });

  it('settles only after jobs queued while it drains', async () => {
    const queue = createSerialQueue();
    const log: string[] = [];

    void queue.run(async () => {
      await Promise.resolve();
      log.push('first');
      void queue
        .run(async () => {
          await new Promise(setImmediate);
          log.push('queued while draining');
          throw new Error('late failure');
        })
        .catch(() => undefined);
    });

    await queue.settled();
    assert.deepEqual(log, ['first', 'queued while draining']);
    assert.equal(queue.pending(), 0);
  });

  it('settles at once when nothing is queued', async () => {
    const queue = createSerialQueue();
    assert.equal(queue.pending(), 0);
    await queue.settled();
  });

  it('counts the running job and the ones waiting behind it', async () => {
    const queue = createSerialQueue();
    const gate = deferred();
    const seen: number[] = [];

    void queue.run(async () => {
      seen.push(queue.pending());
      await gate.promise;
    });
    void queue.run(() => {
      seen.push(queue.pending());
      return Promise.resolve();
    });

    assert.equal(queue.pending(), 2);
    gate.resolve();
    await queue.settled();
    assert.deepEqual(seen, [2, 1]);
    assert.equal(queue.pending(), 0);
  });
});

describe('createConcurrencyLimit', () => {
  it('runs no more jobs at once than the limit, and the rest in turn', async () => {
    const limit = createConcurrencyLimit(2);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const jobs = gates.map((gate, index) =>
      limit.run(async () => {
        started.push(index);
        await gate.promise;
        return index;
      }),
    );

    await Promise.resolve();
    assert.deepEqual(started, [0, 1]);
    gates[0]?.resolve();
    await jobs[0];
    await Promise.resolve();
    assert.deepEqual(started, [0, 1, 2]);
    gates[1]?.resolve();
    gates[2]?.resolve();
    assert.deepEqual(await Promise.all(jobs), [0, 1, 2]);
  });

  it('frees the slot of a job that fails', async () => {
    const limit = createConcurrencyLimit(1);
    await assert.rejects(
      limit.run(() => Promise.reject(new Error('no'))),
      /no/,
    );
    assert.equal(await limit.run(() => Promise.resolve('next')), 'next');
  });
});
