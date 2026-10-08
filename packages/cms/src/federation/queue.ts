import { InProcessMessageQueue } from '@fedify/fedify';
import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from '@fedify/fedify';

/**
 * Fedify's in-process queue, which can say when everything it was handed has
 * been handled.
 *
 * A delivery is queued and sent a moment later, so a server that closes once
 * its own promises settle would drop a delivery still in the queue: the
 * queue lives in the process. `geekity serve` closes a worker on every
 * reload (TASK-288) as well as on SIGTERM, and a post published just before
 * either is sent once by the worker that queued it rather than never.
 *
 * A retry Fedify schedules for later is not waited for. It is lost on a
 * restart, as it always was; holding a reload for an hour would be worse.
 */
export interface SettlingQueue extends MessageQueue {
  /** Resolve once every message queued for now has been handled. */
  settled(): Promise<void>;
  /** Stop listening, so the process can exit. */
  close(): void;
}

/** A message as it travels through the inner queue: whether it is counted, and itself. */
interface Carried {
  readonly counted: boolean;
  readonly message: unknown;
}

export function createSettlingQueue(
  inner: MessageQueue = new InProcessMessageQueue(),
): SettlingQueue {
  let pending = 0;
  let waiters: (() => void)[] = [];
  const closing = new AbortController();

  function carry(message: unknown, options: MessageQueueEnqueueOptions | undefined): Carried {
    const counted = options?.delay === undefined || options.delay.sign <= 0;
    if (counted) pending += 1;
    return { counted, message };
  }

  function handled(): void {
    pending -= 1;
    if (pending > 0) return;
    const waiting = waiters;
    waiters = [];
    for (const wake of waiting) wake();
  }

  return {
    enqueue(message, options) {
      return inner.enqueue(carry(message, options), options);
    },

    async enqueueMany(messages, options) {
      const carried = messages.map((message) => carry(message, options));
      if (inner.enqueueMany !== undefined) {
        await inner.enqueueMany(carried, options);
        return;
      }
      for (const message of carried) await inner.enqueue(message, options);
    },

    listen(handler, options?: MessageQueueListenOptions) {
      const signal =
        options?.signal === undefined
          ? closing.signal
          : AbortSignal.any([options.signal, closing.signal]);
      return inner.listen(
        async (carried: Carried) => {
          try {
            await handler(carried.message);
          } finally {
            if (carried.counted) handled();
          }
        },
        { ...options, signal },
      );
    },

    async settled() {
      while (pending > 0) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },

    close() {
      closing.abort();
    },
  };
}
