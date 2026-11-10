import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { Clock } from '../util/clock.ts';
import type { GeekityEnv } from './env.ts';

/**
 * How far the wait is allowed to double.
 *
 * The lockout doubles for every failure past the threshold, so the wait after
 * `n` extra failures is `lockoutSeconds * 2^n`. The multiplier stops here —
 * with the default fifteen minutes, four hours. This bounds each wait, not how
 * long a key can be kept locked, which is why the sign-in throttle never locks
 * a username for everybody on a growing lockout.
 */
export const LOCKOUT_GROWTH_LIMIT = 16;

/**
 * How many keys a throttle remembers. Past this, rows that are not locked are
 * forgotten first, the one that failed longest ago first, so a flood of
 * distinct names costs a fixed amount of memory and does not wash out a lock.
 */
export const THROTTLE_CAPACITY = 4096;

/**
 * How many times the attempt limit a username may fail, summed over every
 * address, before it is locked for everybody.
 */
export const USERNAME_ATTEMPT_FACTOR = 10;

/** The longest name or address a key keeps: the longest an email address can be. */
const KEY_PART_LENGTH = 320;

/** What {@link createLoginThrottle} needs to know. */
export interface LoginThrottleOptions {
  /** Failed attempts a key may make before it is locked. */
  attempts: number;
  /** How long the first lockout lasts, in seconds. */
  lockoutSeconds: number;
  now: Clock;
  /**
   * Whether failures past the threshold lengthen the lockout. Without it a
   * lockout lasts one window and the count starts over when it ends.
   */
  escalate?: boolean;
}

/**
 * A count of recent failures per key, and the lockout it earns.
 *
 * Deliberately in memory: a restart clears it. The thing it defends against is
 * a run of guesses over minutes, which no restart interrupts, and keeping it
 * out of SQLite means a failed login writes nothing to disk. The map holds at
 * most {@link THROTTLE_CAPACITY} keys of bounded length.
 */
export interface LoginThrottle {
  /**
   * Seconds left before any of these keys may try again, or `undefined` when
   * none of them is locked. The largest wait wins, so a key that is locked on
   * both its username and its address is told the longer of the two.
   */
  retryAfter(keys: readonly string[]): number | undefined;
  /** Record one failed attempt against every key. */
  fail(keys: readonly string[]): void;
  /** Forget every failure against these keys, which is what a success does. */
  succeed(keys: readonly string[]): void;
  /** Forget every key that starts with this prefix. */
  forgetPrefix(prefix: string): void;
  /** How many keys are remembered. For the test that pins the sweeping. */
  size(): number;
}

/** One key's recent history. */
interface Attempts {
  /** Failures counted since the window last started. */
  failures: number;
  /** Epoch milliseconds until which the key is locked; 0 when it is not. */
  lockedUntil: number;
  /** Epoch milliseconds after which this row is stale and may be forgotten. */
  expiresAt: number;
}

/**
 * Build a login throttle.
 *
 * There is no artificial pause on a failed attempt. A `sleep` in the handler
 * holds a connection open for as long as it lasts, so a hundred guesses in
 * parallel would cost the server a hundred idle sockets and the attacker
 * nothing — the delay would be the lever rather than the defence. The growing
 * lockout is the delay: it is the server that decides when the next attempt is
 * allowed, and refusing takes no time at all.
 */
export function createLoginThrottle(options: LoginThrottleOptions): LoginThrottle {
  const clock = options.now;
  const attempts = Math.max(1, Math.trunc(options.attempts));
  const window = Math.max(1, options.lockoutSeconds) * 1000;
  const escalate = options.escalate ?? true;
  const entries = new Map<string, Attempts>();

  /** The row for a key, or `undefined` when it has none or its row is stale. */
  function live(key: string, at: number): Attempts | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (at >= entry.expiresAt) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Drop every stale row. Cheap: the map holds a bounded number of keys. */
  function sweep(at: number): void {
    for (const [key, entry] of entries) {
      if (at >= entry.expiresAt) entries.delete(key);
    }
  }

  return {
    retryAfter(keys) {
      const at = clock().getTime();
      let longest = 0;
      for (const key of keys) {
        const entry = live(key, at);
        if (entry === undefined) continue;
        longest = Math.max(longest, entry.lockedUntil - at);
      }
      return longest > 0 ? Math.ceil(longest / 1000) : undefined;
    },

    fail(keys) {
      const at = clock().getTime();
      sweep(at);

      for (const key of keys) {
        const entry = live(key, at) ?? { failures: 0, lockedUntil: 0, expiresAt: 0 };
        entry.failures += 1;

        if (entry.failures < attempts) {
          // Still under the threshold: the row only has to outlive the window,
          // so a slow trickle of typos never adds up to a lockout.
          entry.expiresAt = at + window;
        } else if (escalate) {
          // The wait doubles for each failure past the threshold, and the row
          // outlives the lockout by one window so the next failure is counted
          // as the escalation it is rather than as a fresh start.
          const wait = window * Math.min(2 ** (entry.failures - attempts), LOCKOUT_GROWTH_LIMIT);
          entry.lockedUntil = at + wait;
          entry.expiresAt = entry.lockedUntil + window;
        } else {
          entry.lockedUntil = at + window;
          entry.expiresAt = entry.lockedUntil;
        }

        // Re-inserted so the map's order is the order keys last failed in,
        // which is what the eviction below reads.
        entries.delete(key);
        entries.set(key, entry);
      }

      for (const [key, entry] of entries) {
        if (entries.size <= THROTTLE_CAPACITY) return;
        if (entry.lockedUntil <= at) entries.delete(key);
      }
      for (const key of entries.keys()) {
        if (entries.size <= THROTTLE_CAPACITY) return;
        entries.delete(key);
      }
    },

    succeed(keys) {
      for (const key of keys) entries.delete(key);
    },

    forgetPrefix(prefix) {
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },

    size() {
      return entries.size;
    },
  };
}

export interface RequestLimitOptions {
  requests: number;
  windowSeconds: number;
  now: Clock;
}

export interface RequestLimit {
  take(key: string): number | undefined;
}

export function createRequestLimit(options: RequestLimitOptions): RequestLimit {
  const window = options.windowSeconds * 1000;
  const entries = new Map<string, { count: number; endsAt: number }>();

  return {
    take(key) {
      const at = options.now().getTime();
      for (const [each, entry] of entries) {
        if (at >= entry.endsAt) entries.delete(each);
      }
      const entry = entries.get(key) ?? { count: 0, endsAt: at + window };
      entry.count += 1;
      entries.set(key, entry);
      return entry.count > options.requests ? Math.ceil((entry.endsAt - at) / 1000) : undefined;
    },
  };
}

/**
 * Where a request came from, as far as the site can tell, or `undefined`.
 *
 * `X-Forwarded-For` is only believed when the site says it is behind a proxy,
 * because anybody may send it: on a site reached directly, trusting it would
 * let one attacker put every guess on a different make-believe address and
 * never be locked out by address at all. The leftmost entry is the client the
 * first proxy saw. Otherwise it is the socket's own address, which is
 * unavailable when the app is being driven in process rather than served — a
 * test, or an embedding — and `undefined` is the honest answer there.
 */
export function clientAddress(
  c: Context<GeekityEnv>,
  config: Pick<ResolvedConfig, 'trustProxy'>,
): string | undefined {
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    const first = forwarded?.split(',')[0]?.trim();
    if (first !== undefined && first !== '') return first;
  }

  try {
    const address = getConnInfo(c).remote.address;
    return address === undefined || address === '' ? undefined : address;
  } catch {
    return undefined;
  }
}

/** One attempt to prove who somebody is with a password. */
export interface SignInAttempt {
  /** The username or email address the attempt named. */
  readonly username: string;
  readonly address: string | undefined;
  /** True when a signed-in user is asked for their password again. */
  readonly signedIn?: boolean;
}

/**
 * Counts failed password attempts so that guessing is slow while the name
 * alone is not enough to keep its owner out.
 *
 * The name and address together, and the address alone, are locked hard at
 * `attempts` with a growing lockout: one address gets a handful of guesses at
 * any name. The name alone is counted over every address at
 * {@link USERNAME_ATTEMPT_FACTOR} times the limit, locked for one window and
 * then started over, so holding it shut takes a steady stream of failures from
 * many addresses rather than one failure whenever the lock lapses. A signed-in
 * user confirming their password is also locked hard by name, since only a
 * session holder can reach those forms.
 */
export interface SignInThrottle {
  retryAfter(attempt: SignInAttempt): number | undefined;
  fail(attempt: SignInAttempt): void;
  succeed(attempt: SignInAttempt): void;
  /** Forget every count against a name, for when its owner has proved who they are. */
  forget(username: string): void;
}

export function createSignInThrottle(options: LoginThrottleOptions): SignInThrottle {
  const strict = createLoginThrottle(options);
  const wide = createLoginThrottle({
    ...options,
    attempts: Math.max(1, Math.trunc(options.attempts)) * USERNAME_ATTEMPT_FACTOR,
    escalate: false,
  });

  function wait(attempt: SignInAttempt): number | undefined {
    const keys = signInKeys(attempt);
    const waits = [strict.retryAfter(keys.strict), wide.retryAfter(keys.wide)];
    const longest = Math.max(0, ...waits.map((each) => each ?? 0));
    return longest > 0 ? longest : undefined;
  }

  return {
    retryAfter: wait,
    fail(attempt) {
      const keys = signInKeys(attempt);
      strict.fail(keys.strict);
      wide.fail(keys.wide);
    },
    succeed(attempt) {
      const keys = signInKeys(attempt);
      strict.succeed(keys.strict);
      wide.succeed(keys.wide);
    },
    forget(username) {
      const name = keyPart(username);
      strict.forgetPrefix(`pair:${name}\u0000`);
      strict.succeed([`session:${name}`]);
      wide.succeed([`user:${name}`]);
    },
  };
}

/**
 * The keys one attempt is counted against.
 *
 * The name is folded to lower case so `Ada` and `ada` are one key, and it is
 * used whether or not any such user exists — a name nobody has locks out
 * exactly as a real one does, so the lockout cannot be used to find out which
 * usernames the site has. Both parts are cut to a length no real username,
 * email address or network address exceeds, so a key costs the same whatever
 * was posted. With no address the pair is the name alone.
 */
export function signInKeys(attempt: SignInAttempt): { strict: string[]; wide: string[] } {
  const name = keyPart(attempt.username);
  const address =
    attempt.address === undefined ? undefined : attempt.address.slice(0, KEY_PART_LENGTH);
  const strict = [`pair:${name}\u0000${address ?? ''}`];
  if (address !== undefined) strict.push(`addr:${address}`);
  if (attempt.signedIn === true) strict.push(`session:${name}`);
  return { strict, wide: [`user:${name}`] };
}

function keyPart(username: string): string {
  return username.slice(0, KEY_PART_LENGTH).toLowerCase();
}

/**
 * A wait in words, for the message the locked-out visitor reads. Rounded up,
 * so it never says a shorter time than the one actually left.
 */
export function describeWait(seconds: number): string {
  if (seconds < 60) return plural(Math.max(1, Math.ceil(seconds)), 'second');
  return plural(Math.ceil(seconds / 60), 'minute');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
