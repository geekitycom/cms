import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { Clock } from '../content/store.ts';
import { systemClock } from '../content/store.ts';
import type { GeekityEnv } from '../env.ts';

/**
 * How far the wait is allowed to double.
 *
 * The lockout doubles for every failure past the threshold, so the wait after
 * `n` extra failures is `lockoutSeconds * 2^n`. Left alone that reaches years,
 * which is a denial of service against the site's own owner rather than
 * against an attacker: anybody who can guess a username could lock it shut for
 * good. The multiplier stops here — with the default fifteen minutes, four
 * hours.
 */
export const LOCKOUT_GROWTH_LIMIT = 16;

/** What {@link createLoginThrottle} needs to know. */
export interface LoginThrottleOptions {
  /** Failed attempts a key may make before it is locked. */
  attempts: number;
  /** How long the first lockout lasts, in seconds. */
  lockoutSeconds: number;
  /** Where the time comes from. Defaults to the system clock; a test hands one it can move. */
  now?: Clock;
}

/**
 * A count of recent failures per key, and the lockout it earns.
 *
 * Deliberately in memory: a restart clears it. The thing it defends against is
 * a run of guesses over minutes, which no restart interrupts, and keeping it
 * out of SQLite means a failed login writes nothing an attacker can grow.
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
  const clock = options.now ?? systemClock;
  const attempts = Math.max(1, Math.trunc(options.attempts));
  const window = Math.max(1, options.lockoutSeconds) * 1000;
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

  /** Drop every stale row. Cheap: the map only holds keys that failed recently. */
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
        } else {
          // The wait doubles for each failure past the threshold, and the row
          // outlives the lockout by one window so the next failure is counted
          // as the escalation it is rather than as a fresh start.
          const wait = window * Math.min(2 ** (entry.failures - attempts), LOCKOUT_GROWTH_LIMIT);
          entry.lockedUntil = at + wait;
          entry.expiresAt = entry.lockedUntil + window;
        }

        entries.set(key, entry);
      }
    },

    succeed(keys) {
      for (const key of keys) entries.delete(key);
    },

    size() {
      return entries.size;
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

/**
 * The keys one sign-in attempt is counted against: the username it named and
 * the address it came from.
 *
 * The username is folded to lower case so `Ada` and `ada` are one key, and it
 * is used whether or not any such user exists — a username nobody has locks
 * out exactly as a real one does, so the lockout cannot be used to find out
 * which usernames the site has.
 */
export function loginKeys(username: string, address: string | undefined): string[] {
  const keys = [`user:${username.toLowerCase()}`];
  if (address !== undefined) keys.push(`addr:${address}`);
  return keys;
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
