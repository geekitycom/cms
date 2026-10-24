import { createSerialQueue } from '../util/queue.ts';
import type { MessageTransport } from './types.ts';

type Handler = (message: unknown) => Promise<void>;

/**
 * The first transport: one message at a time on
 * {@link createSerialQueue}, in this process's memory. A message sent while
 * nothing listens is held for the next listener; one that is waiting when the
 * listener stops is held again. A message is lost with the process, which the
 * job records make up for: start-up recovery sends every queued job again.
 */
export function createInProcessTransport(): MessageTransport {
  const serial = createSerialQueue();
  const held: unknown[] = [];
  let current: Handler | undefined;

  function dispatch(message: unknown): void {
    void serial.run(async () => {
      if (current === undefined) {
        held.push(message);
        return;
      }
      await current(message).catch(() => undefined);
    });
  }

  return {
    enqueue(message) {
      dispatch(message);
      return Promise.resolve();
    },

    async listen(handler, options = {}) {
      const { signal } = options;
      if (signal?.aborted === true) return;
      current = handler;
      for (const message of held.splice(0)) dispatch(message);
      if (signal === undefined) return new Promise<never>(() => undefined);
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (current === handler) current = undefined;
      await serial.settled();
    },
  };
}
