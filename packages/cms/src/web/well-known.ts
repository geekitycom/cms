import type { Hono } from 'hono';

import { LOGIN_PATH, editUserPath } from '../site/admin-paths.ts';
import { signedInAccount } from './signed-in.ts';
import type { GeekityEnv } from './env.ts';
import { effectiveBaseUrl } from '../site/settings.ts';
import type { SiteSettings } from '../site/settings.ts';

/** RFC 9116's location for a site's vulnerability disclosure contacts. */
export const SECURITY_TXT_PATH = '/.well-known/security.txt';

/** Where a password manager looks for a site's change-password form. */
export const CHANGE_PASSWORD_WELL_KNOWN_PATH = '/.well-known/change-password';

/** The fragment of the change-password form on a user's own page. */
export const CHANGE_PASSWORD_FRAGMENT = 'change-password';

/**
 * How far ahead `Expires` points. RFC 9116 asks for less than a year; the file
 * is rebuilt on every request, so a short horizon costs nothing and makes a
 * copy somebody saved stop vouching for the contacts soon after it was taken.
 */
const SECURITY_TXT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The security.txt a site's settings describe, or `undefined` when they name
 * no contact, which RFC 9116 requires at least one of.
 */
export function securityTxt(input: {
  settings: SiteSettings;
  now: Date;
  canonical: string;
}): string | undefined {
  const { settings } = input;
  if (settings.security_contacts.length === 0) return undefined;

  const lines = [
    ...settings.security_contacts.map((contact) => `Contact: ${contact}`),
    `Expires: ${new Date(input.now.getTime() + SECURITY_TXT_LIFETIME_MS).toISOString()}`,
    ...(settings.security_policy === '' ? [] : [`Policy: ${settings.security_policy}`]),
    ...(settings.security_languages === ''
      ? []
      : [`Preferred-Languages: ${settings.security_languages}`]),
    `Canonical: ${input.canonical}`,
  ];
  return `${lines.join('\n')}\n`;
}

/** Mount `/.well-known/security.txt` and `/.well-known/change-password`. */
export function mountWellKnown(app: Hono<GeekityEnv>): void {
  app.get(SECURITY_TXT_PATH, (c) => {
    const config = c.var.config;
    const settings = c.var.site;
    const body = securityTxt({
      settings,
      now: config.now(),
      canonical: `${effectiveBaseUrl(config, settings)}${SECURITY_TXT_PATH}`,
    });
    if (body === undefined) return c.notFound();
    return c.body(body, 200, { 'content-type': 'text/plain; charset=utf-8' });
  });

  // Where it lands depends on the cookie, so no cache may keep one answer.
  app.get(CHANGE_PASSWORD_WELL_KNOWN_PATH, (c) => {
    const userId = signedInAccount(c)?.user.id;
    c.header('Cache-Control', 'no-store');
    return c.redirect(
      userId === undefined ? LOGIN_PATH : `${editUserPath(userId)}#${CHANGE_PASSWORD_FRAGMENT}`,
      302,
    );
  });
}
