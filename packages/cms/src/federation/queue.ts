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

/** Fedify's table in `data/queue.sqlite`. */
export const FEDERATION_QUEUE_TABLE = 'federation_messages';

/**
 * The queue Fedify is handed, wrapped so a worker can stop taking messages
 * and wait for the ones it holds before `geekity serve` hands over (TASK-288)
 * or the process exits.
 *
 * A durable queue, such as the SQLite file the CMS runs on by default
 * (TASK-379), keeps a message nobody has taken for the next worker. Pausing it
 * stops this worker taking messages, and settling waits only for the handlers
 * in flight.
 *
 * An in-memory queue loses whatever it still holds when the process ends, so
 * it is never paused: settling waits until every message this worker queued
 * for now has been handled. A retry scheduled for later is not waited for.
 */
export interface SettlingQueue extends MessageQueue {
  /** Resolve once nothing this worker must finish is still waiting or in hand. */
  settled(): Promise<void>;
  /** Stop taking messages from a durable queue. Does nothing to an in-memory one. */
  pause(): void;
  /** Take messages again after {@link SettlingQueue.pause}. */
  resume(): void;
  /** Stop listening for good, so the process can exit. */
  close(): void;
}

export interface SettlingQueueOptions {
  /** Whether the queue keeps a message nobody took across a restart. */
  readonly durable?: boolean;
  /** Resolves `true` for a message that must be dropped rather than handled. */
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

/** What the CMS runs Fedify on, and what it must do when it lets go of it. */
export interface FederationQueue {
  readonly queue: SettlingQueue;
  /** Stop listening and release whatever the CMS opened for it. */
  close(): void;
}

/**
 * The queue Fedify runs on: the one a site passed in config, or by default a
 * `SqliteMessageQueue` in `data/queue.sqlite`. `null` is no queue at all.
 *
 * Every queue drops an outgoing delivery while dev mode is on (decision-35):
 * the hold before sending stops new ones, and this stops one a copied `data/`
 * brought along from the live site.
 */
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
