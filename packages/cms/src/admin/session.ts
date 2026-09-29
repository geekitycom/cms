import { timingSafeEqual } from 'node:crypto';

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';

/** Where the admin lives. Everything under it needs a session. */
export const ADMIN_PREFIX = '/admin';

/**
 * Name of the cookie holding the session id over plain http, and the name it
 * had everywhere before TASK-132. Under https the cookie is
 * {@link SECURE_SESSION_COOKIE}; {@link sessionCookieName} picks.
 */
export const SESSION_COOKIE = 'geekity_session';

/**
 * Name of the session cookie under https.
 *
 * A browser accepts a `__Host-` cookie only when it is `Secure`, has `Path=/`
 * and names no `Domain`, so nothing on a sibling subdomain can set or
 * overwrite it. A plain-http origin cannot set a `Secure` cookie at all, which
 * is why local development on `http://localhost` keeps {@link SESSION_COOKIE}.
 */
export const SECURE_SESSION_COOKIE = `__Host-${SESSION_COOKIE}`;

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

/** The session cookie's name for this site: {@link SECURE_SESSION_COOKIE} under https. */
export function sessionCookieName(config: Pick<ResolvedConfig, 'baseUrl'>): string {
  return usesSecureCookies(config) ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}

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
  setCookie(c, sessionCookieName(options.config), sessionId, {
    path: SESSION_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'Lax',
    secure: usesSecureCookies(options.config),
    expires: new Date(options.expiresAt),
  });
}

/** Drop the session cookie. The attributes have to match the ones it was set with. */
export function clearSessionCookie(c: Context<GeekityEnv>, config: ResolvedConfig): void {
  deleteCookie(c, sessionCookieName(config), {
    path: SESSION_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'Lax',
    secure: usesSecureCookies(config),
  });
}

/** The session id the request carries, or `undefined`. */
export function sessionIdFrom(c: Context<GeekityEnv>): string | undefined {
  return cookieOrUndefined(c, sessionCookieName(c.var.config));
}

/**
 * Retire a session cookie set under the old name before the site moved to
 * `__Host-` (TASK-132), and answer whether it was somebody's login.
 *
 * The old cookie is never taken as a session under https: accepting it would
 * let a sibling subdomain plant a session again, which is the one thing the
 * prefix is for. So its row is deleted and the browser is told to drop it, and
 * the person signs in once more. Over plain http the two names are one and
 * there is nothing to retire.
 */
export function retireOldSessionCookie(c: Context<GeekityEnv>): boolean {
  const config = c.var.config;
  if (!usesSecureCookies(config)) return false;
  const id = cookieOrUndefined(c, SESSION_COOKIE);
  if (id === undefined) return false;

  const session = c.var.admin.getSession(id);
  if (session !== undefined) c.var.admin.deleteSession(session.id);
  deleteCookie(c, SESSION_COOKIE, {
    path: SESSION_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
  });
  return session?.userId != null;
}

function cookieOrUndefined(c: Context<GeekityEnv>, name: string): string | undefined {
  const value = getCookie(c, name);
  return value === undefined || value === '' ? undefined : value;
}

/** Methods that change nothing, and so need neither a token nor Fetch Metadata. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Whether the browser says this state-changing request came from another site.
 *
 * `Sec-Fetch-Site` is set by the browser and cannot be written by a page, so a
 * `cross-site` or `same-site` POST is a form or `fetch` on a page that is not
 * this origin, refused before any handler runs and whatever token it carries.
 * `same-site` is refused too, because a sibling subdomain is exactly the
 * neighbour the `__Host-` cookie keeps out. `same-origin` and `none` (the
 * person typed or bookmarked it) pass, and so does a request with no header
 * at all, from an older browser or a script, which the CSRF token still
 * guards.
 */
export function crossSiteWrite(c: Context<GeekityEnv>): boolean {
  if (SAFE_METHODS.has(c.req.method)) return false;
  const site = c.req.header('sec-fetch-site');
  return site === 'cross-site' || site === 'same-site';
}

/** What a refused cross-site write is told, in the admin and on a comment. */
export const CROSS_SITE_REFUSAL = 'That request came from another site, so it was refused.';

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
