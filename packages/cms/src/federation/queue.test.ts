import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { InProcessMessageQueue } from '@fedify/fedify';
import { SqliteMessageQueue } from '@fedify/sqlite';
import { Temporal } from '@js-temporal/polyfill';

import { queuedMessages } from '../__testing__/federation-queue.ts';
import { FEDERATION_QUEUE_TABLE, openQueueDatabase } from '../store/queue-database.ts';
import { createCountingQueue, createPausingQueue } from './queue.ts';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const keepAll = (): Promise<boolean> => Promise.resolve(false);

describe('createCountingQueue', () => {
  it('settles only once every message handed to it has been handled', async () => {
    const queue = createCountingQueue(new InProcessMessageQueue(), keepAll);
    const controller = new AbortController();
    const handled: unknown[] = [];
    const gate = deferred();
    const entered = deferred();
    void queue.listen(
      async (message) => {
        entered.resolve();
        await gate.promise;
        handled.push(message);
      },
      { signal: controller.signal },
    );

    await queue.enqueue({ id: 'one' });
    await queue.enqueueMany?.([{ id: 'two' }, { id: 'three' }]);

    let settled = false;
    const settling = queue.settled().then(() => {
      settled = true;
    });
    await entered.promise;
    await new Promise(setImmediate);
    assert.equal(settled, false, 'it waited while the handler was still running');

    gate.resolve();
    await settling;
    assert.deepEqual(handled, [{ id: 'one' }, { id: 'two' }, { id: 'three' }]);
    controller.abort();
  });

  it('stops listening when closed', async () => {
    const queue = createCountingQueue(new InProcessMessageQueue(), keepAll);
    const listening = queue.listen(() => undefined);
    queue.close();
    await listening;
  });

  it('does not wait for a retry scheduled for later', async () => {
    const queued: unknown[] = [];
    const queue = createCountingQueue(
      {
        enqueue: (message) => {
          queued.push(message);
          return Promise.resolve();
        },
        listen: () => Promise.resolve(),
      },
      keepAll,
    );
    await queue.enqueue({ id: 'later' }, { delay: Temporal.Duration.from({ hours: 1 }) as never });
    await queue.settled();
    assert.equal(queued.length, 1, 'the retry was still handed on');
  });

  it('counts a message as handled when its handler throws', async () => {
    let deliver: (message: unknown) => Promise<void> | void = () => undefined;
    const carried: unknown[] = [];
    const queue = createCountingQueue(
      {
        enqueue: (message) => {
          carried.push(message);
          return Promise.resolve();
        },
        listen: (handler) => {
          deliver = handler;
          return Promise.resolve();
        },
      },
      keepAll,
    );
    void queue.listen(() => {
      throw new Error('the inbox refused it');
    });
    await queue.enqueue({ id: 'refused' });
    await assert.rejects(Promise.resolve(deliver(carried[0])), /refused/);
    await queue.settled();
    queue.close();
  });

  it('waits for its own messages, not ones a shared queue replays from an earlier worker', async () => {
    const stored: unknown[] = [];
    let deliver: (message: unknown) => Promise<void> | void = () => undefined;
    const shared = {
      enqueue: (message: unknown) => {
        stored.push(message);
        return Promise.resolve();
      },
      listen: (handler: (message: unknown) => Promise<void> | void) => {
        deliver = handler;
        return Promise.resolve();
      },
    };
    await createCountingQueue(shared, keepAll).enqueue({ id: 'left over' });

    const queue = createCountingQueue(shared, keepAll);
    void queue.listen(() => undefined);
    await deliver(stored.shift());
    await queue.enqueue({ id: 'mine' });

    let settled = false;
    const settling = queue.settled().then(() => {
      settled = true;
    });
    await new Promise(setImmediate);
    assert.equal(settled, false, 'it waited for the message it queued itself');

    await deliver(stored.shift());
    await settling;
    queue.close();
  });
});

describe('createPausingQueue', () => {
  async function fileQueue(): Promise<{ dataDir: string; inner: SqliteMessageQueue }> {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-settling-'));
    after(() => rm(dataDir, { recursive: true, force: true }));
    const inner = new SqliteMessageQueue(openQueueDatabase(dataDir), {
      tableName: FEDERATION_QUEUE_TABLE,
    });
    return { dataDir, inner };
  }

  it('stops taking messages when paused, leaves the rest in the queue, and settles once the one in hand is handled', async () => {
    const { dataDir, inner } = await fileQueue();
    const queue = createPausingQueue(inner, keepAll);
    const gate = deferred();
    const entered = deferred();
    const handled: unknown[] = [];
    const listening = queue.listen(async (message) => {
      entered.resolve();
      await gate.promise;
      handled.push(message);
    });

    await queue.enqueue({ id: 'one' });
    await entered.promise;
    queue.pause();
    await queue.enqueue({ id: 'two' });

    let settled = false;
    const settling = queue.settled().then(() => {
      settled = true;
    });
    await new Promise(setImmediate);
    assert.equal(settled, false, 'it waited for the handler in hand');
    gate.resolve();
    await settling;

    assert.deepEqual(handled, [{ id: 'one' }]);
    assert.equal(queuedMessages(dataDir).length, 1, 'the message nobody took is still in the file');
    queue.close();
    await listening;
  });

  it('takes messages again when resumed', async () => {
    const { inner } = await fileQueue();
    const queue = createPausingQueue(inner, keepAll);
    const handled: unknown[] = [];
    const arrived = deferred();
    const listening = queue.listen((message) => {
      handled.push(message);
      arrived.resolve();
    });
    queue.pause();
    await queue.enqueue({ id: 'later' });
    await queue.settled();
    assert.deepEqual(handled, []);

    queue.resume();
    await arrived.promise;
    assert.deepEqual(handled, [{ id: 'later' }]);
    queue.close();
    await listening;
  });

  it('hands a message it drops to nobody', async () => {
    const { dataDir, inner } = await fileQueue();
    const dropped: unknown[] = [];
    const asked = deferred();
    const queue = createPausingQueue(inner, (message) => {
      dropped.push(message);
      asked.resolve();
      return Promise.resolve(true);
    });
    const handled: unknown[] = [];
    const listening = queue.listen((message) => {
      handled.push(message);
    });
    await queue.enqueue({ id: 'dropped' });
    await asked.promise;
    queue.pause();
    await queue.settled();

    assert.deepEqual(dropped, [{ id: 'dropped' }]);
    assert.deepEqual(handled, []);
    assert.deepEqual(queuedMessages(dataDir), [], 'a dropped message is not kept for later');
    queue.close();
    await listening;
  });
});
