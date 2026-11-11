import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { MessageQueue } from '@fedify/fedify';
import { SqliteMessageQueue } from '@fedify/sqlite';

import { queuedMessages } from '../__testing__/federation-queue.ts';
import { nextEvent } from '../__testing__/wait.ts';
import { FEDERATION_QUEUE_TABLE, openQueueDatabase } from '../store/queue-database.ts';
import { queueOrder } from '../store/queue-order.ts';
import { createOrderedSqliteQueue } from './ordered-queue.ts';

interface Message {
  readonly name: string;
  readonly orderingKey: string;
}

type Refuse = (message: Message) => number | undefined;

const dirs: string[] = [];

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-ordered-queue-'));
  dirs.push(dir);
  return dir;
}

interface Worker {
  readonly queue: MessageQueue;
  readonly handled: string[];
  /** Resolves once a refused message is back in the queue. */
  readonly putBack: Promise<void>;
  readonly stop: () => Promise<void>;
}

/**
 * A worker over the queue file that handles as Fedify's outbox does: a message
 * it refuses is put back under the same key, to be tried again after a delay.
 */
function worker(dir: string, refuse: Refuse = () => undefined): Worker {
  const db = openQueueDatabase(dir);
  const queue = createOrderedSqliteQueue(
    new SqliteMessageQueue(db, { tableName: FEDERATION_QUEUE_TABLE }),
    queueOrder(db, FEDERATION_QUEUE_TABLE),
  );
  const handled: string[] = [];
  const stopping = new AbortController();
  let refused = (): void => undefined;
  const putBack = new Promise<void>((resolve) => {
    refused = resolve;
  });
  const listening = queue.listen(
    async (received) => {
      const message = received as Message;
      await clockMovedOn();
      const retryIn = refuse(message);
      if (retryIn === undefined) {
        handled.push(message.name);
        return;
      }
      await queue.enqueue(message, {
        delay: Temporal.Duration.from({ milliseconds: retryIn }),
        orderingKey: message.orderingKey,
      });
      refused();
    },
    { signal: stopping.signal },
  );
  return {
    queue,
    handled,
    putBack,
    stop: async () => {
      stopping.abort();
      await listening;
      queue[Symbol.dispose]();
    },
  };
}

/**
 * An attempt takes time, as a POST to an inbox does: the queue schedules in
 * whole milliseconds, and a message behind the one in hand is due the next.
 */
function clockMovedOn(): Promise<void> {
  const started = Date.now();
  return nextEvent('the clock moving on', (done) => {
    const timer = setInterval(() => {
      if (Date.now() !== started) done();
    }, 1);
    return () => {
      clearInterval(timer);
    };
  });
}

function waitingInOrder(dir: string): string[] {
  return queuedMessages(dir).map((message) => (message as Message).name);
}

function send(queue: MessageQueue, name: string, orderingKey: string): Promise<void> {
  return queue.enqueue({ name, orderingKey }, { orderingKey });
}

function handledCount(handled: readonly string[], count: number): Promise<void> {
  return nextEvent(`${String(count)} handled messages`, (done) => {
    const timer = setInterval(() => {
      if (handled.length >= count) done();
    }, 5);
    return () => {
      clearInterval(timer);
    };
  });
}

function refuseTimes(name: string, times: number, retryIn: number): Refuse {
  let left = times;
  return (message) => {
    if (message.name !== name || left === 0) return undefined;
    left -= 1;
    return retryIn;
  };
}

describe('createOrderedSqliteQueue', () => {
  it('handles a message put back for a retry before the ones enqueued behind it', async () => {
    const { queue, handled, stop } = worker(await dataDir(), refuseTimes('create', 1, 200));
    await send(queue, 'create', 'post');
    await send(queue, 'update', 'post');
    await send(queue, 'delete', 'post');

    await handledCount(handled, 3);
    await stop();
    assert.deepEqual(handled, ['create', 'update', 'delete']);
  });

  it('keeps a message that fails more than once ahead each time', async () => {
    const { queue, handled, stop } = worker(await dataDir(), refuseTimes('create', 3, 60));
    await send(queue, 'create', 'post');
    await send(queue, 'update', 'post');

    await handledCount(handled, 2);
    await stop();
    assert.deepEqual(handled, ['create', 'update']);
  });

  it('places a message enqueued while a retry waits behind that retry', async () => {
    const { queue, handled, putBack, stop } = worker(
      await dataDir(),
      refuseTimes('create', 1, 200),
    );
    await send(queue, 'create', 'post');
    await putBack;
    await send(queue, 'update', 'post');

    await handledCount(handled, 2);
    await stop();
    assert.deepEqual(handled, ['create', 'update']);
  });

  it('does not hold another key’s messages behind a waiting retry', async () => {
    const { queue, handled, stop } = worker(await dataDir(), refuseTimes('create', 1, 60_000));
    await send(queue, 'create', 'post\nhttps://dead.example/inbox');
    await send(queue, 'update', 'post\nhttps://dead.example/inbox');
    await send(queue, 'create elsewhere', 'post\nhttps://live.example/inbox');

    await handledCount(handled, 1);
    await stop();
    assert.deepEqual(handled, ['create elsewhere']);
  });

  it('leaves the order in the queue file for the worker that starts next', async () => {
    const dir = await dataDir();
    const first = worker(dir, refuseTimes('create', 1, 60_000));
    await send(first.queue, 'create', 'post');
    await send(first.queue, 'update', 'post');
    await first.putBack;
    await first.stop();
    assert.deepEqual(first.handled, []);

    assert.deepEqual(waitingInOrder(dir), ['create', 'update']);
  });
});
