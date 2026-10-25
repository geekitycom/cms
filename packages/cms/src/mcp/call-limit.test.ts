import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCallLimit } from './call-limit.ts';

function clockAt(start: number): { now: () => Date; advance: (ms: number) => void } {
  let at = start;
  return {
    now: () => new Date(at),
    advance: (ms) => {
      at += ms;
    },
  };
}

describe('the call limit', () => {
  it('allows the calls the window holds, then refuses with the seconds left, the first refusal marked', () => {
    const clock = clockAt(Date.parse('2026-10-25T12:00:00Z'));
    const limit = createCallLimit({ calls: 2, windowSeconds: 60, now: clock.now });
    assert.deepEqual(limit.take('a'), { kind: 'allowed' });
    clock.advance(10_000);
    assert.deepEqual(limit.take('a'), { kind: 'allowed' });
    assert.deepEqual(limit.take('a'), { kind: 'refused', retryAfter: 50, first: true });
    clock.advance(20_500);
    assert.deepEqual(limit.take('a'), { kind: 'refused', retryAfter: 30, first: false });
  });

  it('keeps each key to its own window', () => {
    const clock = clockAt(0);
    const limit = createCallLimit({ calls: 1, windowSeconds: 60, now: clock.now });
    assert.equal(limit.take('a').kind, 'allowed');
    assert.equal(limit.take('b').kind, 'allowed');
    assert.equal(limit.take('a').kind, 'refused');
  });

  it('starts a fresh window once the last one ends', () => {
    const clock = clockAt(0);
    const limit = createCallLimit({ calls: 1, windowSeconds: 60, now: clock.now });
    limit.take('a');
    assert.equal(limit.take('a').kind, 'refused');
    clock.advance(60_000);
    assert.deepEqual(limit.take('a'), { kind: 'allowed' });
  });
});
