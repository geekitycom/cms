import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLoginThrottle, LOCKOUT_GROWTH_LIMIT } from './throttle.ts';

/** A clock a test can move, in the shape the config's `now` has. */
function fakeClock(start = Date.UTC(2026, 8, 4, 12, 0, 0)): {
  now: () => Date;
  advance: (seconds: number) => void;
} {
  let millis = start;
  return {
    now: () => new Date(millis),
    advance(seconds) {
      millis += seconds * 1000;
    },
  };
}

/** A throttle with a clock the test owns. */
function throttleOn(clock: { now: () => Date }, attempts = 3, lockoutSeconds = 60) {
  return createLoginThrottle({ attempts, lockoutSeconds, now: clock.now });
}

describe('the login throttle', () => {
  it('lets attempts through until the threshold is reached', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    for (let attempt = 1; attempt < 3; attempt += 1) {
      throttle.fail(['user:ada']);
      assert.equal(throttle.retryAfter(['user:ada']), undefined, `after ${attempt} failures`);
    }
  });

  it('locks the key once the threshold is reached', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    throttle.fail(['user:ada']);
    throttle.fail(['user:ada']);
    throttle.fail(['user:ada']);

    assert.equal(throttle.retryAfter(['user:ada']), 60);
  });

  it('counts down while the lockout runs and forgets it afterwards', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    for (let i = 0; i < 3; i += 1) throttle.fail(['user:ada']);

    clock.advance(20);
    assert.equal(throttle.retryAfter(['user:ada']), 40);

    clock.advance(40);
    assert.equal(throttle.retryAfter(['user:ada']), undefined, 'the lockout is over');
  });

  it('locks any key the caller names, not only the first', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    for (let i = 0; i < 3; i += 1) throttle.fail(['user:ada', 'addr:198.51.100.7']);

    assert.equal(throttle.retryAfter(['user:grace', 'addr:198.51.100.7']), 60, 'by address');
    assert.equal(throttle.retryAfter(['user:ada', 'addr:203.0.113.9']), 60, 'and by username');
    assert.equal(throttle.retryAfter(['user:grace', 'addr:203.0.113.9']), undefined);
  });

  it('doubles the wait for each failure past the threshold', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    for (let i = 0; i < 3; i += 1) throttle.fail(['user:ada']);
    assert.equal(throttle.retryAfter(['user:ada']), 60);

    clock.advance(60);
    throttle.fail(['user:ada']);
    assert.equal(throttle.retryAfter(['user:ada']), 120);

    clock.advance(120);
    throttle.fail(['user:ada']);
    assert.equal(throttle.retryAfter(['user:ada']), 240);
  });

  it('stops doubling at the growth limit', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    for (let i = 0; i < 3; i += 1) throttle.fail(['user:ada']);
    // The attacker waits out each lockout and tries once more, twenty times.
    for (let i = 0; i < 20; i += 1) {
      clock.advance(throttle.retryAfter(['user:ada']) ?? 0);
      throttle.fail(['user:ada']);
    }

    assert.equal(throttle.retryAfter(['user:ada']), 60 * LOCKOUT_GROWTH_LIMIT);
  });

  it('forgets a key once a success clears it', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    throttle.fail(['user:ada']);
    throttle.fail(['user:ada']);
    throttle.succeed(['user:ada']);
    throttle.fail(['user:ada']);

    assert.equal(throttle.retryAfter(['user:ada']), undefined, 'the count started over');
  });

  it('forgets failures that are older than the window', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    throttle.fail(['user:ada']);
    throttle.fail(['user:ada']);

    clock.advance(61);
    throttle.fail(['user:ada']);

    assert.equal(throttle.retryAfter(['user:ada']), undefined, 'the two stale failures are gone');
  });

  it('does not grow without bound', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    for (let i = 0; i < 500; i += 1) {
      throttle.fail([`addr:198.51.100.${i}`]);
      clock.advance(1);
    }
    clock.advance(60 * (LOCKOUT_GROWTH_LIMIT + 1));
    throttle.fail(['addr:203.0.113.1']);

    assert.equal(throttle.size(), 1, 'every expired entry was swept');
  });
});
