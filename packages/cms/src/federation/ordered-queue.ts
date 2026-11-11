import { AsyncLocalStorage } from 'node:async_hooks';

import type { MessageQueue, MessageQueueEnqueueOptions } from '@fedify/fedify';
import type { SqliteMessageQueue } from '@fedify/sqlite';

import type { QueueOrder } from '../store/queue-order.ts';

/**
 * The SQLite queue, with the messages of one ordering key handled in the order
 * they were first enqueued.
 *
 * `SqliteMessageQueue` takes the waiting message that is due first, and its
 * ordering key only stops two messages of a key from being handled at once. A
 * message put back with a delay after a failed attempt would so be handled
 * after the messages enqueued behind it. Here the message put back keeps its
 * place: the key's other messages are rescheduled to just after it. The order
 * is the `scheduled` column, so it holds across a restart.
 */
export function createOrderedSqliteQueue(
  inner: SqliteMessageQueue,
  order: QueueOrder,
): MessageQueue & Disposable {
  inner.initialize();
  const keyInHand = new AsyncLocalStorage<string | undefined>();
  let enqueued: Promise<void> = Promise.resolve();

  function behindWaiting(
    key: string,
    options: MessageQueueEnqueueOptions,
  ): MessageQueueEnqueueOptions {
    const last = order.lastDue(key);
    if (last === undefined) return options;
    const wait = last + 1 - Date.now();
    if (wait <= (options.delay?.total('millisecond') ?? 0)) return options;
    return { ...options, delay: Temporal.Duration.from({ milliseconds: wait }) };
  }

  // One at a time: a row another enqueue added between the insert of a message
  // put back and the rescheduling behind it would be counted as waiting ahead.
  function inTurn(task: () => Promise<void>): Promise<void> {
    const run = enqueued.then(task);
    enqueued = run.catch(() => undefined);
    return run;
  }

  function enqueue(message: unknown, options?: MessageQueueEnqueueOptions): Promise<void> {
    const key = options?.orderingKey;
    if (options === undefined || key == null) return inner.enqueue(message, options);
    const putBack = keyInHand.getStore() === key;
    return inTurn(async () => {
      if (putBack) {
        await inner.enqueue(message, options);
        order.moveNewestAhead(key);
      } else {
        await inner.enqueue(message, behindWaiting(key, options));
      }
    });
  }

  return {
    nativeRetrial: inner.nativeRetrial,
    enqueue,

    async enqueueMany(messages, options) {
      if (options?.orderingKey == null) {
        await inner.enqueueMany(messages, options);
        return;
      }
      for (const message of messages) await enqueue(message, options);
    },

    listen(handler, options) {
      return inner.listen(
        (message) => keyInHand.run(orderingKeyOf(message), () => handler(message)),
        options,
      );
    },

    [Symbol.dispose]() {
      inner[Symbol.dispose]();
    },
  };
}

/**
 * The queue hands a handler the message without the key it was enqueued under;
 * Fedify's outbox messages carry that key themselves.
 */
function orderingKeyOf(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const key = (message as Record<string, unknown>)['orderingKey'];
  return typeof key === 'string' ? key : undefined;
}
