import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createLoginThrottle,
  createSignInThrottle,
  LOCKOUT_GROWTH_LIMIT,
  signInKeys,
  THROTTLE_CAPACITY,
  USERNAME_ATTEMPT_FACTOR,
} from './throttle.ts';

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

  it('stays under a fixed size however many distinct keys fail', () => {
    const clock = fakeClock();
    const throttle = createLoginThrottle({ attempts: 5, lockoutSeconds: 900, now: clock.now });

    for (let i = 0; i < 10_000; i += 1) throttle.fail([`user:user-${i}`]);

    assert.ok(throttle.size() < 10_000, `the map holds ${throttle.size()} keys`);
  });

  it('keeps the keys that failed most recently when it is full', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    for (let i = 0; i < 3; i += 1) throttle.fail(['user:ada']);
    for (let i = 0; i < 10_000; i += 1) {
      throttle.fail([`user:other-${i}`]);
      if (i % 1000 === 0) throttle.fail(['user:ada']);
    }

    assert.notEqual(throttle.retryAfter(['user:ada']), undefined, 'ada is still locked');
  });

  it('forgets unlocked keys before a locked one when it is full', () => {
    const clock = fakeClock();
    const throttle = throttleOn(clock);

    for (let i = 0; i < 3; i += 1) throttle.fail(['addr:198.51.100.1']);
    for (let i = 0; i < THROTTLE_CAPACITY * 2; i += 1) throttle.fail([`pair:name-${i}`]);

    assert.equal(throttle.retryAfter(['addr:198.51.100.1']), 60, 'the address is still locked');
  });
});

describe('the sign-in throttle', () => {
  const owner = { identifier: 'ada', address: '203.0.113.9' };
  const stranger = { identifier: 'ada', address: '198.51.100.1' };

  function signInOn(clock: { now: () => Date }) {
    return createSignInThrottle({ attempts: 3, lockoutSeconds: 60, now: clock.now });
  }

  it('locks a username at one address without locking it at another', () => {
    const clock = fakeClock();
    const throttle = signInOn(clock);

    for (let i = 0; i < 3; i += 1) throttle.fail(stranger);

    assert.equal(throttle.retryAfter(stranger), 60);
    assert.equal(throttle.retryAfter(owner), undefined);
  });

  it('locks an address for every username it tries', () => {
    const clock = fakeClock();
    const throttle = signInOn(clock);

    for (let i = 0; i < 3; i += 1)
      throttle.fail({ identifier: `name-${i}`, address: stranger.address });

    assert.equal(throttle.retryAfter({ identifier: 'ada', address: stranger.address }), 60);
  });

  it('cannot be held for a day by one failure each time the lock lapses', () => {
    const clock = fakeClock();
    const throttle = signInOn(clock);

    let refused = 0;
    let tries = 0;
    for (let step = 1; step <= (24 * 60 * 60) / 30; step += 1) {
      clock.advance(30);
      if (throttle.retryAfter(stranger) === undefined) throttle.fail(stranger);
      if (step % 20 === 0) {
        tries += 1;
        if (throttle.retryAfter(owner) !== undefined) refused += 1;
      }
    }

    assert.equal(refused, 0, `the owner was refused ${refused} of ${tries} tries`);
  });

  it('locks a username guessed from many addresses at a higher limit', () => {
    const clock = fakeClock();
    const throttle = signInOn(clock);
    const limit = 3 * USERNAME_ATTEMPT_FACTOR;

    for (let i = 0; i < limit - 1; i += 1)
      throttle.fail({ identifier: 'ada', address: `10.0.0.${i}` });
    assert.equal(throttle.retryAfter(owner), undefined, 'under the limit');

    throttle.fail({ identifier: 'ada', address: '10.0.1.1' });
    assert.equal(throttle.retryAfter(owner), 60);
  });

  it('starts the username count over once its lockout ends', () => {
    const clock = fakeClock();
    const throttle = signInOn(clock);
    const limit = 3 * USERNAME_ATTEMPT_FACTOR;

    for (let i = 0; i < limit; i += 1) throttle.fail({ identifier: 'ada', address: `10.0.0.${i}` });
    clock.advance(60);
    throttle.fail({ identifier: 'ada', address: '10.0.1.1' });

    assert.equal(throttle.retryAfter(owner), undefined);
  });

  it('locks the signed-in user strictly from any address', () => {
    const clock = fakeClock();
    const throttle = signInOn(clock);

    for (let i = 0; i < 3; i += 1) {
      throttle.fail({ identifier: 'ada', address: `10.0.0.${i}`, confirming: true });
    }

    assert.equal(throttle.retryAfter({ ...owner, confirming: true }), 60);
    assert.equal(throttle.retryAfter(owner), undefined, 'signing in is a separate count');
  });

  it('forgets every count against a name', () => {
    const clock = fakeClock();
    const throttle = signInOn(clock);

    for (let i = 0; i < 3 * USERNAME_ATTEMPT_FACTOR; i += 1) {
      throttle.fail({ identifier: 'Ada', address: i < 3 ? undefined : `10.0.0.${i}` });
    }
    throttle.forget('ada');

    assert.equal(throttle.retryAfter({ identifier: 'ada', address: undefined }), undefined);
    assert.equal(throttle.retryAfter(owner), undefined);
  });
});

describe('the keys a sign-in is counted against', () => {
  it('stay short however long the name and address are', () => {
    const keys = signInKeys({ identifier: 'a'.repeat(100_000), address: 'b'.repeat(100_000) });

    const longest = Math.max(...[...keys.strict, ...keys.wide].map((key) => key.length));
    assert.ok(longest <= 700, `longest key is ${longest} characters`);
  });

  it('fold case so one name is one key', () => {
    assert.deepEqual(
      signInKeys({ identifier: 'Ada', address: '203.0.113.1' }),
      signInKeys({ identifier: 'ada', address: '203.0.113.1' }),
    );
  });
});
