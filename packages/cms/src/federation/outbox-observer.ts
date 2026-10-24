import { AsyncLocalStorage } from 'node:async_hooks';

import type { DeliveryOutcome } from '../store/deliveries.ts';
import { messageOf } from '../util/errors.ts';
import type { SettlingQueue } from './queue.ts';

/** The queue Fedify is given, and the error hook to give Fedify beside it. */
export interface ObservedOutbox {
  readonly queue: SettlingQueue;
  /** Fedify's `onOutboxError`: notes why the delivery in hand failed. */
  readonly onOutboxError: (error: unknown) => void;
}

interface Frame {
  readonly activityId: string;
  readonly inbox: string;
  error: string | undefined;
  retried: boolean;
}

interface OutboxMessage {
  readonly type: 'outbox';
  readonly activityId: string;
  readonly inbox: string;
}

/**
 * Report how each outbox delivery settled.
 *
 * Fedify has no success hook: an attempt that worked and one it gave up on
 * both return normally from the handler. What tells them apart is whether
 * `onOutboxError` was called while the handler ran, and a failure it will try
 * again is told from one it gave up on by whether it put the same delivery
 * back on this queue.
 */
export function observeOutbox(
  inner: SettlingQueue,
  settle: (outcome: DeliveryOutcome) => void,
): ObservedOutbox {
  const frames = new AsyncLocalStorage<Frame>();

  // The delivery has already happened by now: a failure to write it down must
  // not reach the queue, which would take it for a failed handler and send the
  // activity again.
  function report(outcome: DeliveryOutcome): void {
    try {
      settle(outcome);
    } catch (thrown) {
      console.warn(
        `Could not record how ${outcome.activityId} to ${outcome.inbox} went: ${messageOf(thrown)}`,
      );
    }
  }

  function noteRetry(message: unknown): void {
    const frame = frames.getStore();
    if (frame === undefined || !isOutbox(message)) return;
    if (message.activityId === frame.activityId && message.inbox === frame.inbox) {
      frame.retried = true;
    }
  }

  return {
    queue: {
      ...inner,
      enqueue(message, options) {
        noteRetry(message);
        return inner.enqueue(message, options);
      },
      async enqueueMany(messages, options) {
        for (const message of messages) noteRetry(message);
        if (inner.enqueueMany !== undefined) {
          await inner.enqueueMany(messages, options);
          return;
        }
        for (const message of messages) await inner.enqueue(message, options);
      },
      listen(handler, options) {
        return inner.listen(async (message) => {
          if (!isOutbox(message)) {
            await handler(message);
            return;
          }
          const frame: Frame = {
            activityId: message.activityId,
            inbox: message.inbox,
            error: undefined,
            retried: false,
          };
          try {
            await frames.run(frame, () => handler(message));
          } catch (thrown) {
            report({ ...where(frame), status: 'queued', error: frame.error ?? messageOf(thrown) });
            throw thrown;
          }
          report(outcomeOf(frame));
        }, options);
      },
    },

    onOutboxError: (error) => {
      const frame = frames.getStore();
      if (frame !== undefined) frame.error = messageOf(error);
    },
  };
}

function where(frame: Frame): Pick<DeliveryOutcome, 'activityId' | 'inbox'> {
  return { activityId: frame.activityId, inbox: frame.inbox };
}

function outcomeOf(frame: Frame): DeliveryOutcome {
  const error = frame.error ?? null;
  if (frame.retried) return { ...where(frame), status: 'queued', error };
  return { ...where(frame), status: error === null ? 'sent' : 'failed', error };
}

function isOutbox(message: unknown): message is OutboxMessage {
  if (typeof message !== 'object' || message === null) return false;
  const fields = message as Record<string, unknown>;
  return (
    fields['type'] === 'outbox' &&
    typeof fields['activityId'] === 'string' &&
    typeof fields['inbox'] === 'string'
  );
}
