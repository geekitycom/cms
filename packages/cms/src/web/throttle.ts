import { isIPv4, isIPv6 } from 'node:net';

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
 * with the default fifteen minutes, four hours.
 */
export const LOCKOUT_GROWTH_LIMIT = 16;

export const THROTTLE_CAPACITY = 4096;

export const USERNAME_ATTEMPT_FACTOR = 10;

const KEY_PART_LENGTH = 320;

/** What {@link createLoginThrottle} needs to know. */
export interface LoginThrottleOptions {
  /** Failed attempts a key may make before it is locked. */
  attempts: number;
  /** How long the first lockout lasts, in seconds. */
  lockoutSeconds: number;
  now: Clock;
  lockout?: 'escalating' | 'fixed';
}

/**
 * A count of recent failures per key, and the lockout it earns.
 *
 * Deliberately in memory: a restart clears it. The thing it defends against is
 * a run of guesses over minutes, which no restart interrupts, and keeping it
 * out of SQLite means a failed login writes nothing to disk.
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
  const escalating = (options.lockout ?? 'escalating') === 'escalating';
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
        } else if (escalating) {
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

      evictBeyondCapacity(entries, at);
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

function evictBeyondCapacity(entries: Map<string, Attempts>, at: number): void {
  for (const [key, entry] of entries) {
    if (entries.size <= THROTTLE_CAPACITY) return;
    if (entry.lockedUntil <= at) entries.delete(key);
  }
  for (const key of entries.keys()) {
    if (entries.size <= THROTTLE_CAPACITY) return;
    entries.delete(key);
  }
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
 * never be locked out by address at all. The rightmost entry is the one the
 * proxy in front of the site added itself; anything to its left came with the
 * request and may be made up. Otherwise it is the socket's own address, which is
 * unavailable when the app is being driven in process rather than served — a
 * test, or an embedding — and `undefined` is the honest answer there.
 */
export function clientAddress(
  c: Context<GeekityEnv>,
  config: Pick<ResolvedConfig, 'trustProxy'>,
): string | undefined {
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    const nearest = forwarded?.split(',').at(-1)?.trim();
    if (nearest !== undefined && nearest !== '') return nearest;
  }

  try {
    const address = getConnInfo(c).remote.address;
    return address === undefined || address === '' ? undefined : address;
  } catch {
    return undefined;
  }
}

export interface SignInAttempt {
  readonly identifier: string;
  readonly address: string | undefined;
  readonly confirming?: boolean;
}

export interface SignInThrottle {
  retryAfter(attempt: SignInAttempt): number | undefined;
  fail(attempt: SignInAttempt): void;
  succeed(attempt: SignInAttempt): void;
  forget(identifier: string): void;
}

export function createSignInThrottle(options: LoginThrottleOptions): SignInThrottle {
  const strict = createLoginThrottle(options);
  const wide = createLoginThrottle({
    ...options,
    attempts: Math.max(1, Math.trunc(options.attempts)) * USERNAME_ATTEMPT_FACTOR,
    lockout: 'fixed',
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
    forget(identifier) {
      const name = keyPart(identifier);
      strict.forgetPrefix(pairKey(name, ''));
      strict.succeed([confirmingKey(name)]);
      wide.succeed([identifierKey(name)]);
    },
  };
}

export function signInKeys(attempt: SignInAttempt): { strict: string[]; wide: string[] } {
  const name = keyPart(attempt.identifier);
  const address = attempt.address === undefined ? undefined : addressKey(attempt.address);
  const strict = [pairKey(name, address ?? '')];
  if (address !== undefined) strict.push(`addr:${address}`);
  if (attempt.confirming === true) strict.push(confirmingKey(name));
  return { strict, wide: [identifierKey(name)] };
}

/**
 * The address as a throttle counts it. An IPv6 client is usually handed a
 * whole /64, so counting each address in it separately would give one client
 * more addresses than it could ever be locked out of.
 */
function addressKey(address: string): string {
  if (isIPv4(address)) return address;
  const groups = ipv6Groups(address);
  if (groups === undefined) return address.slice(0, KEY_PART_LENGTH);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}

function ipv6Groups(address: string): number[] | undefined {
  let text = address.split('%')[0] ?? '';
  if (!isIPv6(text)) return undefined;
  const embedded = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (embedded !== null) {
    const [a, b, c, d] = embedded.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, embedded.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const hex = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16));
  const [head = '', tail] = text.split('::');
  if (tail === undefined) return hex(head);
  const before = hex(head);
  const after = hex(tail);
  return [...before, ...Array<number>(8 - before.length - after.length).fill(0), ...after];
}

function keyPart(identifier: string): string {
  return identifier.slice(0, KEY_PART_LENGTH).toLowerCase();
}

function pairKey(name: string, address: string): string {
  return `pair:${name}\u0000${address}`;
}

function confirmingKey(name: string): string {
  return `session:${name}`;
}

function identifierKey(name: string): string {
  return `user:${name}`;
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
