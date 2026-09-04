import { randomBytes } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';
import { usesSecureCookies } from './session.ts';

/**
 * How long a browser is told to insist on https, in seconds. One year, which
 * is what every preload list asks for.
 */
export const HSTS_MAX_AGE = 31_536_000;

/** The value of `Strict-Transport-Security`, sent only under an https base URL. */
export const HSTS_VALUE = `max-age=${HSTS_MAX_AGE}; includeSubDomains`;

/** Bytes behind one CSP nonce. Sixteen is what the CSP specification asks for. */
export const NONCE_BYTES = 16;

/**
 * The headers every response gets, admin or not.
 *
 * Deliberately two of them. `nosniff` says the `Content-Type` the CMS sends is
 * the one to believe, which constrains nothing a theme might want to do, and
 * HSTS is about the host rather than the page — the admin and the public site
 * are the same origin, so sending it on one and not the other would be a
 * distinction the browser does not make. Everything else that would tell a
 * browser what a page may load stays off the public site: a theme is somebody
 * else's HTML and the CMS has no business deciding what it may reference.
 */
export const baselineSecurityHeaders: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  await next();
  applyBaseline(c.res.headers, c.var.config);
};

/**
 * The headers an admin response gets, on top of the baseline.
 *
 * A nonce is minted before the handler runs, because the templates put it on
 * the editor's script tag, and the policy naming it is written afterwards, so
 * a handler that replaced the response cannot lose the headers.
 */
export const adminSecurityHeaders: MiddlewareHandler<GeekityEnv> = async (c, next) => {
  const nonce = createNonce();
  c.set('cspNonce', nonce);

  await next();

  const headers = c.res.headers;
  applyBaseline(headers, c.var.config);
  headers.set('Content-Security-Policy', adminContentSecurityPolicy(nonce));
  headers.set('Referrer-Policy', 'same-origin');
  // Not DENY: the editor puts its preview in a sandboxed iframe of its own, and
  // `frame-ancestors 'self'` below is the modern half of the same statement.
  headers.set('X-Frame-Options', 'SAMEORIGIN');
};

/**
 * One nonce: 128 random bits, fresh for every response.
 *
 * base64url rather than plain base64. CSP's `base64-value` accepts both, and
 * the url alphabet has no `+` or `/`, which are the two characters that would
 * otherwise need escaping every time the value is put in a pattern or a URL.
 */
export function createNonce(): string {
  return randomBytes(NONCE_BYTES).toString('base64url');
}

/**
 * The admin's Content-Security-Policy.
 *
 * Everything the admin loads is its own: the stylesheet and the editor bundle
 * come from `/admin/_static/`, the editor's preview and upload calls are
 * same-origin `fetch`, and the preview frame renders the site's own theme and
 * uploads. So `'self'` is the whole allowlist, with three exceptions worth
 * naming:
 *
 * - `style-src` also carries a per-response nonce. CodeMirror 6 injects its
 *   themes as `<style>` elements at runtime through `style-mod`, which is an
 *   inline style however it is written; the nonce is threaded to it through
 *   `EditorView.cspNonce` so the admin never has to say `'unsafe-inline'`.
 * - `img-src` also allows `data:`, because a preview of a post somebody is
 *   writing may hold a data URI image and refusing it would make the preview
 *   lie about what publishing would show.
 * - `frame-ancestors` is `'self'` rather than `'none'`: the editor's preview
 *   is a `srcdoc` iframe, which inherits this policy, and its ancestor is the
 *   admin page itself.
 *
 * There is no inline script at all — the slug and permalink enhancement moved
 * into `admin/static/slug.js` — so `script-src` needs neither a nonce nor
 * `'unsafe-inline'`.
 */
export function adminContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "script-src 'self'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self' data:",
    "media-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
  ].join('; ');
}

/** The two headers every response carries. */
function applyBaseline(headers: Headers, config: ResolvedConfig): void {
  headers.set('X-Content-Type-Options', 'nosniff');
  // The same test the session cookie's `Secure` uses, so the two can never
  // disagree about whether the site is served over https.
  if (usesSecureCookies(config)) headers.set('Strict-Transport-Security', HSTS_VALUE);
}
