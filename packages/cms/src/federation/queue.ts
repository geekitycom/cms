import { randomUUID } from 'node:crypto';

import { InProcessMessageQueue } from '@fedify/fedify';
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

export interface SettlingQueue extends MessageQueue {
  settled(): Promise<void>;
  pause(): void;
  resume(): void;
  close(): void;
}

export interface SettlingQueueOptions {
  readonly durable?: boolean;
  readonly hold?: (message: unknown) => Promise<boolean>;
}

interface Carried {
  readonly countedBy: string | null;
  readonly message: unknown;
}

type Handler = (message: unknown) => Promise<void> | void;

export function createSettlingQueue(
  inner: MessageQueue = new InProcessMessageQueue(),
  options: SettlingQueueOptions = {},
): SettlingQueue {
  const durable = options.durable ?? false;
  const thisQueue = randomUUID();
  let pending = 0;
  let inFlight = 0;
  let waiters: (() => void)[] = [];
  const closing = new AbortController();
  const stopped: Promise<void>[] = [];
  let listener: { handler: Handler; options: MessageQueueListenOptions } | undefined;
  let taking: { readonly stop: AbortController; readonly ended: Promise<void> } | undefined;
  let paused = false;

  function carry(message: unknown, enqueue: MessageQueueEnqueueOptions | undefined): unknown {
    if (durable) return message;
    const counted = enqueue?.delay === undefined || enqueue.delay.sign <= 0;
    if (counted) pending += 1;
    return { countedBy: counted ? thisQueue : null, message } satisfies Carried;
  }

  function quiet(): boolean {
    return inFlight === 0 && pending === 0;
  }

  function wake(): void {
    if (!quiet()) return;
    const waiting = waiters;
    waiters = [];
    for (const resolve of waiting) resolve();
  }

  function take(): void {
    if (listener === undefined || paused || taking !== undefined) return;
    if (listener.options.signal?.aborted === true) return;
    const stop = new AbortController();
    const signal = AbortSignal.any([listener.options.signal ?? closing.signal, stop.signal]);
    taking = { stop, ended: inner.listen(listener.handler, { ...listener.options, signal }) };
  }

  async function handle(handler: Handler, received: unknown): Promise<void> {
    const carried = durable ? { countedBy: null, message: received } : (received as Carried);
    inFlight += 1;
    try {
      if (await options.hold?.(carried.message)) return;
      await handler(carried.message);
    } finally {
      inFlight -= 1;
      if (carried.countedBy === thisQueue) pending -= 1;
      wake();
    }
  }

  return {
    enqueue(message, enqueue) {
      return inner.enqueue(carry(message, enqueue), enqueue);
    },

    async enqueueMany(messages, enqueue) {
      const carried = messages.map((message) => carry(message, enqueue));
      if (inner.enqueueMany !== undefined) {
        await inner.enqueueMany(carried, enqueue);
        return;
      }
      for (const message of carried) await inner.enqueue(message, enqueue);
    },

    async listen(handler, listen?: MessageQueueListenOptions) {
      const signal =
        listen?.signal === undefined
          ? closing.signal
          : AbortSignal.any([listen.signal, closing.signal]);
      listener = {
        handler: (received) => handle(handler, received),
        options: { ...listen, signal },
      };
      take();
      if (!signal.aborted) {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      await Promise.all([...stopped, taking?.ended]);
    },

    async settled() {
      await Promise.all(stopped);
      while (!quiet()) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },

    pause() {
      if (!durable) return;
      paused = true;
      if (taking === undefined) return;
      taking.stop.abort();
      stopped.push(taking.ended);
      taking = undefined;
    },

    resume() {
      paused = false;
      take();
    },

    close() {
      closing.abort();
    },
  };
}

export interface FederationQueue {
  readonly queue: SettlingQueue;
  close(): void;
}

export function createFederationQueue(
  supplied: MessageQueue | null | undefined,
  site: { readonly settings: SettingsRegistry; readonly config: HoldConfig },
): FederationQueue | undefined {
  if (supplied === null) return undefined;
  const hold = holdWhileInDevMode(site.settings, site.config);
  if (supplied !== undefined) {
    const queue = createSettlingQueue(supplied, {
      durable: !(supplied instanceof InProcessMessageQueue),
      hold,
    });
    return { queue, close: () => queue.close() };
  }
  const inner = new SqliteMessageQueue(openQueueDatabase(site.config.dataDir), {
    tableName: FEDERATION_QUEUE_TABLE,
  });
  const queue = createSettlingQueue(inner, { durable: true, hold });
  return {
    queue,
    close() {
      queue.close();
      inner[Symbol.dispose]();
    },
  };
}

interface HoldConfig {
  readonly dataDir: string;
  readonly now: Clock;
}

interface Outgoing {
  readonly activityType: string;
  readonly activityId: string;
  readonly to: readonly string[];
}

function holdWhileInDevMode(
  settings: SettingsRegistry,
  config: HoldConfig,
): (message: unknown) => Promise<boolean> {
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
  if (fields['type'] === 'fanout' && typeof fields['inboxes'] === 'object') {
    return { activityType, activityId, to: Object.keys(fields['inboxes'] ?? {}) };
  }
  return undefined;
}
