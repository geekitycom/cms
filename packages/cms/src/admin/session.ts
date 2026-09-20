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
 * Where the session cookie is scoped.
 *
 * It was `/admin`, which kept it off every public request. TASK-103 needs the
 * public site to know who is reading it — the comment form under a post is
 * drawn for the person signed in rather than for a stranger — and a cookie
 * scoped to `/admin` is one a browser never sends to a permalink, so the
 * feature could only ever have worked in a test. `SameSite=Lax` still keeps it
 * off cross-site POSTs, and both forms that act on a session now carry a CSRF
 * token, so what the narrow path was buying is bought twice over. What it
 * costs is that a public response may now be drawn for one named reader, which
 * is why such a response says `Cache-Control: private` and carries no
 * validator.
 */
export const SESSION_COOKIE_PATH = '/';

/**
 * Put the session id in the response's cookie.
 *
 * `HttpOnly` keeps it away from scripts and `SameSite=Lax` keeps it off
 * cross-site POSTs, belt to the CSRF token's braces.
 */
export function setSessionCookie(
  c: Context<GeekityEnv>,
  sessionId: string,
  options: { config: ResolvedConfig; expiresAt: string },
): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    path: SESSION_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'Lax',
    secure: usesSecureCookies(options.config),
    expires: new Date(options.expiresAt),
  });
}

/** Drop the session cookie. The attributes have to match the ones it was set with. */
export function clearSessionCookie(c: Context<GeekityEnv>, config: ResolvedConfig): void {
  deleteCookie(c, SESSION_COOKIE, {
    path: SESSION_COOKIE_PATH,
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
