import { timingSafeEqual } from 'node:crypto';

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';

/** Where the admin lives. Everything under it needs a session. */
export const ADMIN_PREFIX = '/admin';

/** Name of the cookie holding the session id. */
export const SESSION_COOKIE = 'geekity_session';

/** Name of the hidden field every mutating admin form carries. */
export const CSRF_FIELD = 'csrf_token';

/**
 * Whether the session cookie gets `Secure`, which is decided by the site's
 * base URL rather than being hard-coded.
 *
 * doc-5 says the cookie is always `Secure`. It is not, quite: a `Secure`
 * cookie is dropped on a plain-HTTP origin, so a site being developed on
 * `http://localhost:3000` could never hold a login. `Secure` therefore goes on
 * whenever the site says it is served over https, which covers every
 * deployment, and comes off for local http, which is the only case it would
 * have broken.
 */
export function usesSecureCookies(config: Pick<ResolvedConfig, 'baseUrl'>): boolean {
  try {
    return new URL(config.baseUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Put the session id in the response's cookie.
 *
 * `HttpOnly` keeps it away from scripts, `SameSite=Lax` keeps it off
 * cross-site POSTs (belt to the CSRF token's braces), and `Path=/admin` keeps
 * it off every public request, so a cached public page can never carry it.
 */
export function setSessionCookie(
  c: Context<GeekityEnv>,
  sessionId: string,
  options: { config: ResolvedConfig; expiresAt: string },
): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    path: ADMIN_PREFIX,
    httpOnly: true,
    sameSite: 'Lax',
    secure: usesSecureCookies(options.config),
    expires: new Date(options.expiresAt),
  });
}

/** Drop the session cookie. The attributes have to match the ones it was set with. */
export function clearSessionCookie(c: Context<GeekityEnv>, config: ResolvedConfig): void {
  deleteCookie(c, SESSION_COOKIE, {
    path: ADMIN_PREFIX,
    httpOnly: true,
    sameSite: 'Lax',
    secure: usesSecureCookies(config),
  });
}

/** The session id the request carries, or `undefined`. */
export function sessionIdFrom(c: Context<GeekityEnv>): string | undefined {
  const value = getCookie(c, SESSION_COOKIE);
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Whether a submitted token is this session's, compared in constant time.
 *
 * Both are hex of a fixed length, so a length mismatch is already a mismatch
 * and short-circuiting on it leaks nothing.
 */
export function csrfTokenMatches(expected: string, submitted: unknown): boolean {
  if (typeof submitted !== 'string' || submitted.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(submitted, 'utf8'), Buffer.from(expected, 'utf8'));
}
