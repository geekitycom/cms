import type { Context } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import { findUserById, verifyUserPassword } from '../site/users.ts';
import type { GeekityEnv } from '../web/env.ts';
import { clientAddress, describeWait } from '../web/throttle.ts';
import type { SignInThrottle } from '../web/throttle.ts';

export type Confirmation =
  | { readonly kind: 'confirmed'; readonly username: string }
  | { readonly kind: 'wrong' }
  | { readonly kind: 'locked'; readonly wait: number };

export type Refusal = Exclude<Confirmation, { kind: 'confirmed' }>;

export type ConfirmPassword = (c: Context<GeekityEnv>, password: string) => Confirmation;

export function createConfirmPassword(
  throttle: (config: ResolvedConfig) => SignInThrottle,
): ConfirmPassword {
  return (c, password) => {
    const { config } = c.var;
    const userId = c.var.session?.userId;
    const user = userId == null ? undefined : findUserById(config.dataDir, userId);
    if (user === undefined) return { kind: 'wrong' };

    const keys = { username: user.username, address: clientAddress(c, config), signedIn: true };
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

export function answerRefusal(c: Context<GeekityEnv>, refusal: Refusal, wrong: string): string {
  if (refusal.kind === 'locked') return answerLockedOut(c, refusal.wait);
  c.status(400);
  return wrong;
}

export function answerLockedOut(c: Context<GeekityEnv>, wait: number): string {
  c.status(429);
  c.header('Retry-After', String(wait));
  return lockedMessage(wait);
}

export function lockedMessage(wait: number): string {
  return `Too many wrong passwords. Try again in ${describeWait(wait)}.`;
}
