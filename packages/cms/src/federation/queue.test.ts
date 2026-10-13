import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Temporal } from '@js-temporal/polyfill';

import { createSettlingQueue } from './queue.ts';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('createSettlingQueue', () => {
  it('settles only once every message handed to it has been handled', async () => {
    const queue = createSettlingQueue();
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
    const queue = createSettlingQueue();
    const listening = queue.listen(() => undefined);
    queue.close();
    await listening;
  });

  it('does not wait for a retry scheduled for later', async () => {
    const queued: unknown[] = [];
    const queue = createSettlingQueue({
      enqueue: (message) => {
        queued.push(message);
        return Promise.resolve();
      },
      listen: () => Promise.resolve(),
    });
    await queue.enqueue({ id: 'later' }, { delay: Temporal.Duration.from({ hours: 1 }) as never });
    await queue.settled();
    assert.equal(queued.length, 1, 'the retry was still handed on');
  });

  it('counts a message as handled when its handler throws', async () => {
    let deliver: (message: unknown) => Promise<void> | void = () => undefined;
    const carried: unknown[] = [];
    const queue = createSettlingQueue({
      enqueue: (message) => {
        carried.push(message);
        return Promise.resolve();
      },
      listen: (handler) => {
        deliver = handler;
        return Promise.resolve();
      },
    });
    await queue.listen(() => {
      throw new Error('the inbox refused it');
    });
    await queue.enqueue({ id: 'refused' });
    await assert.rejects(Promise.resolve(deliver(carried[0])), /refused/);
    await queue.settled();
  });

  it('waits for its own messages, not ones a durable queue kept from an earlier worker', async () => {
    const stored: unknown[] = [];
    let deliver: (message: unknown) => Promise<void> | void = () => undefined;
    const durable = {
      enqueue: (message: unknown) => {
        stored.push(message);
        return Promise.resolve();
      },
      listen: (handler: (message: unknown) => Promise<void> | void) => {
        deliver = handler;
        return Promise.resolve();
      },
    };
    await createSettlingQueue(durable).enqueue({ id: 'left over' });

    const queue = createSettlingQueue(durable);
    await queue.listen(() => undefined);
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
  });
});
