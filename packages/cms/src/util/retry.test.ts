import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { retry } from './retry.ts';

function recordingWait(): { waits: number[]; wait: (ms: number) => Promise<void> } {
  const waits: number[] = [];
  return {
    waits,
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
}

describe('retry', () => {
  it('stops at the first try that does not ask for another', async () => {
    const { waits, wait } = recordingWait();
    const tried: number[] = [];

    const value = await retry({ attempts: 3, backoffMs: (n) => n * 10, wait }, (attempt) => {
      tried.push(attempt);
      return Promise.resolve({ value: `try ${String(attempt)}`, retry: attempt < 2 });
    });

    assert.equal(value, 'try 2');
    assert.deepEqual(tried, [1, 2]);
    assert.deepEqual(waits, [10]);
  });

  it('answers the last try once the attempts run out, with no wait after it', async () => {
    const { waits, wait } = recordingWait();

    const value = await retry({ attempts: 3, backoffMs: (n) => n * 100, wait }, (attempt) =>
      Promise.resolve({ value: attempt, retry: true }),
    );

    assert.equal(value, 3);
    assert.deepEqual(waits, [100, 200]);
  });

  it('tries once when told to try fewer than once', async () => {
    let tries = 0;
    const value = await retry({ attempts: 0, backoffMs: () => 0 }, () => {
      tries += 1;
      return Promise.resolve({ value: 'once', retry: true });
    });

    assert.equal(value, 'once');
    assert.equal(tries, 1);
  });
});
