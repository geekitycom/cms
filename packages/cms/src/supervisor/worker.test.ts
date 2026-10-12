import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupervisorMessage, WorkerMessage } from './protocol.ts';
import { superviseWorker } from './worker.ts';
import type { SupervisedCms } from './worker.ts';

function drainingWorker(writes: number) {
  const lines: string[] = [];
  const sent: WorkerMessage['type'][] = [];
  let tell: (message: SupervisorMessage) => void = () => undefined;
  let drained: () => void = () => undefined;
  const drainedSent = new Promise<void>((resolve) => {
    drained = resolve;
  });
  const cms: SupervisedCms = {
    drain(waiting) {
      if (writes > 0) waiting?.(writes);
      return Promise.resolve();
    },
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const worker = superviseWorker({
    channel: {
      send(message) {
        sent.push(message.type);
        if (message.type === 'drained') drained();
      },
      onMessage(handler) {
        tell = handler;
      },
      onDisconnect: () => undefined,
    },
    loaded: [],
    exit: () => undefined,
    log: (line) => lines.push(line),
  });
  worker.serving(cms);
  return { lines, sent, drainedSent, tell: (message: SupervisorMessage) => tell(message) };
}

describe('a supervised worker draining for a reload', () => {
  it('says how many writes in flight the drain waits for', async () => {
    const worker = drainingWorker(2);

    worker.tell({ type: 'drain' });
    await worker.drainedSent;

    assert.deepEqual(worker.lines, ['Draining: waiting for 2 writes in flight to finish.']);
    assert.deepEqual(worker.sent, ['ready', 'drained']);
  });

  it('names one write as one', async () => {
    const worker = drainingWorker(1);

    worker.tell({ type: 'drain' });
    await worker.drainedSent;

    assert.deepEqual(worker.lines, ['Draining: waiting for 1 write in flight to finish.']);
  });

  it('says nothing when no write is in flight', async () => {
    const worker = drainingWorker(0);

    worker.tell({ type: 'drain' });
    await worker.drainedSent;

    assert.deepEqual(worker.lines, []);
  });
});
