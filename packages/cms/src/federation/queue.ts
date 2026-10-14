import { randomUUID } from 'node:crypto';

import type {
  MessageQueue,
  MessageQueueEnqueueOptions,
  MessageQueueListenOptions,
} from '@fedify/fedify';
import { SqliteMessageQueue } from '@fedify/sqlite';

import { holdOutbound } from '../dev-mode.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { openQueueDatabase } from '../store/queue-database.ts';
import type { Clock } from '../util/clock.ts';

export const FEDERATION_QUEUE_TABLE = 'federation_messages';

interface Settling extends MessageQueue {
  settled(): Promise<void>;
  close(): void;
}

/**
 * Over a queue the site supplies, which may hold its messages in memory: never
 * paused, and settled once every message it was handed is handled.
 */
export interface CountingQueue extends Settling {
  readonly kind: 'counting';
}

/**
 * Over the durable queue it owns: paused before a drain, which leaves what
 * waits in the file, and settled once the handlers in hand finish.
 */
export interface PausingQueue extends Settling {
  readonly kind: 'pausing';
  pause(): void;
  resume(): void;
}

export type SettlingQueue = CountingQueue | PausingQueue;

export type Drop = (message: unknown) => Promise<boolean>;

type Handler = (message: unknown) => Promise<void> | void;

interface Carried {
  readonly countedBy: string | null;
  readonly message: unknown;
}

function busyCounter(): { begin(): void; end(): void; quiet(): Promise<void> } {
  let busy = 0;
  let waiters: (() => void)[] = [];
  return {
    begin() {
      busy += 1;
    },
    end() {
      busy -= 1;
      if (busy > 0) return;
      const waiting = waiters;
      waiters = [];
      for (const resolve of waiting) resolve();
    },
    async quiet() {
      while (busy > 0) await new Promise<void>((resolve) => waiters.push(resolve));
    },
  };
}

function untilClosed(signal: AbortSignal | undefined, closing: AbortSignal): AbortSignal {
  return signal === undefined ? closing : AbortSignal.any([signal, closing]);
}

async function enqueueAll(
  inner: MessageQueue,
  messages: readonly unknown[],
  options: MessageQueueEnqueueOptions | undefined,
): Promise<void> {
  if (inner.enqueueMany !== undefined) {
    await inner.enqueueMany(messages, options);
    return;
  }
  for (const message of messages) await inner.enqueue(message, options);
}

async function deliver(handler: Handler, message: unknown, drop: Drop): Promise<void> {
  if (await drop(message)) return;
  await handler(message);
}

export function createCountingQueue(inner: MessageQueue, drop: Drop): CountingQueue {
  const thisQueue = randomUUID();
  const busy = busyCounter();
  const closing = new AbortController();

  function carry(message: unknown, enqueue: MessageQueueEnqueueOptions | undefined): Carried {
    const counted = enqueue?.delay === undefined || enqueue.delay.sign <= 0;
    if (counted) busy.begin();
    return { countedBy: counted ? thisQueue : null, message };
  }

  return {
    kind: 'counting',

    enqueue(message, enqueue) {
      return inner.enqueue(carry(message, enqueue), enqueue);
    },

    enqueueMany(messages, enqueue) {
      return enqueueAll(
        inner,
        messages.map((message) => carry(message, enqueue)),
        enqueue,
      );
    },

    listen(handler, listen) {
      const carriedHandler = async (received: unknown): Promise<void> => {
        const carried = received as Carried;
        busy.begin();
        try {
          await deliver(handler, carried.message, drop);
        } finally {
          if (carried.countedBy === thisQueue) busy.end();
          busy.end();
        }
      };
      return inner.listen(carriedHandler, {
        ...listen,
        signal: untilClosed(listen?.signal, closing.signal),
      });
    },

    settled: () => busy.quiet(),

    close() {
      closing.abort();
    },
  };
}

export function createPausingQueue(inner: MessageQueue & Disposable, drop: Drop): PausingQueue {
  const busy = busyCounter();
  const closing = new AbortController();
  let stopped: Promise<unknown> = Promise.resolve();
  let listener:
    { handler: Handler; options: MessageQueueListenOptions; signal: AbortSignal } | undefined;
  let taking: { readonly stop: AbortController; readonly ended: Promise<void> } | undefined;
  let paused = false;

  function take(): void {
    if (listener === undefined || paused || taking !== undefined) return;
    if (listener.signal.aborted) return;
    const stop = new AbortController();
    const signal = AbortSignal.any([listener.signal, stop.signal]);
    taking = { stop, ended: inner.listen(listener.handler, { ...listener.options, signal }) };
  }

  return {
    kind: 'pausing',

    enqueue(message, enqueue) {
      return inner.enqueue(message, enqueue);
    },

    enqueueMany(messages, enqueue) {
      return enqueueAll(inner, messages, enqueue);
    },

    async listen(handler, listen) {
      const signal = untilClosed(listen?.signal, closing.signal);
      listener = {
        handler: async (message) => {
          busy.begin();
          try {
            await deliver(handler, message, drop);
          } finally {
            busy.end();
          }
        },
        options: listen ?? {},
        signal,
      };
      take();
      if (!signal.aborted) {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      await Promise.all([stopped, taking?.ended]);
    },

    async settled() {
      await stopped;
      await busy.quiet();
    },

    pause() {
      paused = true;
      if (taking === undefined) return;
      taking.stop.abort();
      stopped = Promise.all([stopped, taking.ended]);
      taking = undefined;
    },

    resume() {
      paused = false;
      take();
    },

    close() {
      closing.abort();
      inner[Symbol.dispose]();
    },
  };
}

export function createFederationQueue(
  supplied: MessageQueue | null | undefined,
  site: { readonly settings: SettingsRegistry; readonly config: DropConfig },
): SettlingQueue | undefined {
  if (supplied === null) return undefined;
  const drop = dropWhileInDevMode(site.settings, site.config);
  if (supplied !== undefined) return createCountingQueue(supplied, drop);
  const inner = new SqliteMessageQueue(openQueueDatabase(site.config.dataDir), {
    tableName: FEDERATION_QUEUE_TABLE,
  });
  return createPausingQueue(inner, drop);
}

interface DropConfig {
  readonly dataDir: string;
  readonly now: Clock;
}

interface Outgoing {
  readonly activityType: string;
  readonly activityId: string;
  readonly to: readonly string[];
}

function dropWhileInDevMode(settings: SettingsRegistry, config: DropConfig): Drop {
  return async (message) => {
    const outgoing = outgoingOf(message);
    if (outgoing === undefined) return false;
    return await holdOutbound(settings, config, {
      kind: 'activitypub',
      what: `${outgoing.activityType} ${outgoing.activityId}`,
      to: outgoing.to,
    });
  };
}

function outgoingOf(message: unknown): Outgoing | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const fields = message as Record<string, unknown>;
  const activityType =
    typeof fields['activityType'] === 'string' ? fields['activityType'].replace(/^.*#/, '') : '';
  const activityId = typeof fields['activityId'] === 'string' ? fields['activityId'] : '';
  if (fields['type'] === 'outbox' && typeof fields['inbox'] === 'string') {
    return { activityType, activityId, to: [fields['inbox']] };
  }
  const inboxes = fields['inboxes'];
  if (fields['type'] === 'fanout' && typeof inboxes === 'object' && inboxes !== null) {
    return { activityType, activityId, to: Object.keys(inboxes) };
  }
  return undefined;
}
