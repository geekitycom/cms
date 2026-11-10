import type { Context } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import { findUserById, verifyUserPassword } from '../site/users.ts';
import type { GeekityEnv } from '../web/env.ts';
import { clientAddress, describeWait, loginKeys } from '../web/throttle.ts';
import type { LoginThrottle } from '../web/throttle.ts';

export type Confirmation =
  | { readonly kind: 'confirmed'; readonly username: string }
  | { readonly kind: 'wrong' }
  | { readonly kind: 'locked'; readonly wait: number };

export type Refusal = Exclude<Confirmation, { kind: 'confirmed' }>;

/** Checks the signed-in user's own password, as a form that asks for it again does. */
export type ConfirmPassword = (c: Context<GeekityEnv>, password: string) => Confirmation;

/**
 * Counted on the sign-in throttle's keys, so a session alone gives no more
 * guesses at the password than the sign-in form does, and a lockout refuses
 * the right password too.
 */
export function createConfirmPassword(
  throttle: (config: ResolvedConfig) => LoginThrottle,
): ConfirmPassword {
  return (c, password) => {
    const { config } = c.var;
    const userId = c.var.session?.userId;
    const user = userId == null ? undefined : findUserById(config.dataDir, userId);
    if (user === undefined) return { kind: 'wrong' };

    const keys = loginKeys(user.username, clientAddress(c, config));
    const throttled = throttle(config);
    const wait = throttled.retryAfter(keys);
    if (wait !== undefined) return { kind: 'locked', wait };
    if (password === '') return { kind: 'wrong' };

    if (verifyUserPassword(config.dataDir, user.username, password) === undefined) {
      throttled.fail(keys);
      return { kind: 'wrong' };
    }
    throttled.succeed(keys);
    return { kind: 'confirmed', username: user.username };
  };
}

/**
 * Sets the status a refusal answers with, and returns what to tell the person:
 * `wrong` when the password was wrong, the wait when they are locked out.
 */
export function refuseConfirmation(
  c: Context<GeekityEnv>,
  refusal: Refusal,
  wrong: string,
): string {
  if (refusal.kind === 'locked') return lockedOut(c, refusal.wait);
  c.status(400);
  return wrong;
}

/** Sets the 429 a lockout answers with, and returns what to tell the person. */
export function lockedOut(c: Context<GeekityEnv>, wait: number): string {
  c.status(429);
  c.header('Retry-After', String(wait));
  return lockedMessage(wait);
}

export function lockedMessage(wait: number): string {
  return `Too many wrong passwords. Try again in ${describeWait(wait)}.`;
}
