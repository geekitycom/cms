import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';
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
    void queue.listen(() => {
      throw new Error('the inbox refused it');
    });
    await queue.enqueue({ id: 'refused' });
    await assert.rejects(Promise.resolve(deliver(carried[0])), /refused/);
    await queue.settled();
    queue.close();
  });

  it('waits for its own messages, not ones a queue it treats as in-memory replays from an earlier worker', async () => {
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

describe('createSettlingQueue over a durable queue', () => {
  async function fileQueue(): Promise<{
    file: string;
    open: () => SqliteMessageQueue;
  }> {
    const directory = await mkdtemp(path.join(tmpdir(), 'geekity-settling-'));
    after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'queue.sqlite');
    return {
      file,
      open: () => new SqliteMessageQueue(new DatabaseSync(file), { tableName: 'messages' }),
    };
  }

  function waiting(file: string): unknown[] {
    const db = new DatabaseSync(file);
    try {
      return db
        .prepare('SELECT message FROM messages ORDER BY created')
        .all()
        .map((row) => JSON.parse(String(row['message'])) as unknown);
    } finally {
      db.close();
    }
  }

  it('stops taking messages when paused, leaves the rest in the queue, and settles once the one in hand is handled', async () => {
    const { file, open } = await fileQueue();
    const inner = open();
    const queue = createSettlingQueue(inner, { durable: true });
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
    assert.equal(waiting(file).length, 1, 'the message nobody took is still in the file');
    queue.close();
    await listening;
    inner[Symbol.dispose]();
  });

  it('takes messages again when resumed', async () => {
    const { open } = await fileQueue();
    const inner = open();
    const queue = createSettlingQueue(inner, { durable: true });
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
    inner[Symbol.dispose]();
  });

  it('hands a message a held check keeps to nobody', async () => {
    const { file, open } = await fileQueue();
    const inner = open();
    const held: unknown[] = [];
    const queue = createSettlingQueue(inner, {
      durable: true,
      hold: (message) => {
        held.push(message);
        return Promise.resolve(true);
      },
    });
    const handled: unknown[] = [];
    const listening = queue.listen((message) => {
      handled.push(message);
    });
    await queue.enqueue({ id: 'held' });
    queue.pause();
    await queue.settled();

    assert.deepEqual(held, [{ id: 'held' }]);
    assert.deepEqual(handled, []);
    assert.deepEqual(waiting(file), [], 'a held message is dropped, not kept for later');
    queue.close();
    await listening;
    inner[Symbol.dispose]();
  });
});
