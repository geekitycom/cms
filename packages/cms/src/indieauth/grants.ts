import { randomBytes } from 'node:crypto';

import type { Clock } from '../content/store.ts';
import type { AuthorizationRequest, CodeChallenge, Scope } from './request.ts';

/**
 * What an authorization code stands for: who approved what, for which client,
 * and the PKCE challenge the client must answer to redeem it, or none for an
 * app the owner listed (TASK-159, TASK-160, TASK-225).
 */
export interface AuthorizationCode {
  readonly clientId: string;
  /** What the client called itself, for the connected apps screen. */
  readonly clientName?: string;
  readonly redirectUri: string;
  readonly codeChallenge: CodeChallenge;
  readonly userId: number;
  /** The canonical me URL the client is handed back. */
  readonly me: string;
  /** The scopes the person left ticked. */
  readonly scopes: readonly Scope[];
  /** The RFC 8707 resource the token is to be issued for. */
  readonly resource?: string;
}

/** A request on the consent screen, waiting for the person to decide. */
export interface PendingConsent {
  readonly request: AuthorizationRequest;
  /** Who was shown the screen. Nobody else may answer it. */
  readonly userId: number;
  /** The me URL the screen named. */
  readonly me: string;
  /** What the client called itself on the screen, when it said. */
  readonly clientName?: string;
}

/** Values kept for a while under an unguessable key, each taken at most once. */
export interface ExpiringStore<T> {
  /** Keep `value` and answer the key it is kept under. */
  put(value: T): string;
  /** The value under `key`, removed as it is read, or `undefined` once it has expired. */
  take(key: string): T | undefined;
}

/** How long a code may wait to be redeemed. The IndieAuth spec says at most ten minutes. */
export const CODE_LIFETIME_MS = 5 * 60 * 1000;

/** How long a consent screen may sit before its answer is refused. */
export const CONSENT_LIFETIME_MS = 30 * 60 * 1000;

/**
 * The authorization server's short-lived state: codes and the consent screens
 * they come from.
 *
 * Held in memory rather than in `data/`. Decision-9 asks files for state a
 * restart must not lose, and these live for minutes: a restart costs whoever
 * was mid-sign-in one more try, which is less than writing every sign-in to
 * disk and sweeping it after.
 */
export interface IndieAuthState {
  readonly codes: ExpiringStore<AuthorizationCode>;
  readonly consents: ExpiringStore<PendingConsent>;
}

export function createIndieAuthState(now: Clock): IndieAuthState {
  return {
    codes: expiringStore(CODE_LIFETIME_MS, now),
    consents: expiringStore(CONSENT_LIFETIME_MS, now),
  };
}

function expiringStore<T>(lifetimeMs: number, now: Clock): ExpiringStore<T> {
  const entries = new Map<string, { value: T; expiresAt: number }>();

  return {
    put(value) {
      const at = now().getTime();
      // Swept on every put, so nothing outlives its lifetime by more than the
      // gap to the next sign-in.
      for (const [key, entry] of entries) if (entry.expiresAt <= at) entries.delete(key);
      const key = randomBytes(32).toString('base64url');
      entries.set(key, { value, expiresAt: at + lifetimeMs });
      return key;
    },
    take(key) {
      const entry = entries.get(key);
      entries.delete(key);
      if (entry === undefined || entry.expiresAt <= now().getTime()) return undefined;
      return entry.value;
    },
  };
}
