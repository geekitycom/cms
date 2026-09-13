import type { Context, Hono } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';
import { findUserById, findUserByIdentifier, setUserPassword } from './accounts.ts';
import { passwordProblem } from './credentials.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import type { Session } from './store.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { clientAddress, describeWait, loginKeys } from './throttle.ts';
import type { LoginThrottle } from './throttle.ts';

/**
 * Forgetting a password, and getting back in without a shell.
 *
 * Two unauthenticated screens, built to the OWASP Forgot Password guidance,
 * and four rules that between them are the whole design:
 *
 * - **One answer.** The request form says exactly the same thing to a name
 *   that exists, a name that does not, and a name whose user has no email
 *   address. A recovery form that answered differently would be a list of
 *   which accounts a site has, handed to anybody who asked.
 * - **The link is the secret.** 256 random bits, in the URL, sent to an
 *   address somebody put on their own account. The database keeps only its
 *   SHA-256 (see the `password_resets` migration), so a copy of the cache is
 *   not a stack of working links, and the token is never rendered into the
 *   page of the browser that asked for it — only into the message.
 * - **It is spent when it is used.** Setting a password deletes every reset
 *   that user had outstanding and ends every session they had, because the
 *   ordinary reason to reset a password is that somebody else may have had it.
 * - **It cannot be a lever.** Requests are rate limited exactly as sign-ins
 *   are (TASK-47), on a throttle of their own, so a flood of recovery requests
 *   for one username cannot lock that person out of logging in.
 */

/** Where the request-a-link form lives. */
export const FORGOT_PATH = `${ADMIN_PREFIX}/forgot`;

/** Where the set-a-new-password form lives. The link points here. */
export const RESET_PATH = `${ADMIN_PREFIX}/reset`;

/** The fields the two forms submit. */
export const RECOVERY_FIELDS = {
  /** A username or an email address; the form does not ask which. */
  identifier: 'identifier',
  /** The token, carried from the link's query string into the form. */
  token: 'token',
  password: 'password',
  passwordConfirmation: 'password_confirmation',
} as const;

/**
 * How long a link lasts, in seconds.
 *
 * An hour, which is what the task asks for and what OWASP calls a reasonable
 * upper bound: long enough to walk to another machine and read the mail there,
 * short enough that a link left in an inbox is not a spare key.
 */
export const RESET_TOKEN_LIFETIME_SECONDS = 3600;

/** The message asking somebody whether they meant to do this. */
export const RESET_TEMPLATE = 'password-reset';

/** The message telling them it happened. */
export const PASSWORD_CHANGED_TEMPLATE = 'password-changed';

/**
 * The one thing the request form ever says.
 *
 * Spelled once, and rendered whatever happened, so the two paths through the
 * handler cannot drift into two different answers.
 */
export const RECOVERY_ANSWER =
  'If that matches an account with an email address on it, a link to set a new password is on ' +
  'its way. The link lasts an hour and works once. Check the spam folder if it does not arrive.';

/** What {@link mountRecovery} needs from the admin around it. */
export interface MountRecoveryOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
  /**
   * A session to hang a CSRF token on, made on the spot if the visitor has
   * none. The same one the login and setup forms use: these pages are reached
   * by somebody with no login, and a form with no session has no token.
   */
  anonymousSession: (c: Context<GeekityEnv>) => Session;
  /**
   * The throttle recovery requests are counted against.
   *
   * Its own, not the login one. Sharing would mean a stranger could lock
   * somebody out of signing in by asking for their password to be reset over
   * and over — turning a recovery feature into a denial of service against the
   * person it exists to help.
   */
  throttle: (config: ResolvedConfig) => LoginThrottle;
}

/** Register the forgot-password and reset screens. */
export function mountRecovery(app: Hono<GeekityEnv>, options: MountRecoveryOptions): void {
  const { render, anonymousSession, throttle } = options;

  app.get(FORGOT_PATH, (c) => {
    anonymousSession(c);
    return render(c, ADMIN_TEMPLATES.forgot, forgotScreen(c));
  });

  app.post(FORGOT_PATH, async (c) => {
    const config = c.var.config;
    const body = await c.req.parseBody();
    const identifier = field(body[RECOVERY_FIELDS.identifier]).trim();

    const address = clientAddress(c, config);
    const keys = loginKeys(identifier, address);
    const throttled = throttle(config);

    const wait = throttled.retryAfter(keys);
    if (wait !== undefined) {
      anonymousSession(c);
      c.status(429);
      c.header('Retry-After', String(wait));
      return render(
        c,
        ADMIN_TEMPLATES.forgot,
        // Says nothing about whether that account exists: an unknown name is
        // counted and locked out exactly as a real one is.
        forgotScreen(c, { error: `Too many requests. Try again in ${describeWait(wait)}.` }),
      );
    }

    // Every request is counted, not only the ones that matched: counting a
    // match differently would make the lockout itself the answer the rest of
    // this handler refuses to give.
    throttled.fail(keys);

    const user = identifier === '' ? undefined : findUserByIdentifier(config.dataDir, identifier);

    if (user?.email !== undefined && c.var.mail.configured()) {
      // A good moment to sweep: resets are rare, and this is the one handler
      // that writes a row to the table.
      c.var.admin.prunePasswordResets();
      const reset = c.var.admin.createPasswordReset({
        userId: user.id,
        lifetimeSeconds: RESET_TOKEN_LIFETIME_SECONDS,
      });

      // Dropped rather than awaited, for two reasons: the answer is the same
      // whatever the provider says, and waiting for a provider on one path and
      // not the other is how the page's timing would start telling people
      // which usernames exist.
      void c.var.mail.send({
        to: user.email,
        template: RESET_TEMPLATE,
        data: {
          username: user.username,
          resetUrl: resetLink(config.baseUrl, reset.token),
          expiresAt: reset.expiresAt,
          expiresInHours: RESET_TOKEN_LIFETIME_SECONDS / 3600,
        },
      });
    }

    anonymousSession(c);
    return render(c, ADMIN_TEMPLATES.forgot, forgotScreen(c, { sent: true }));
  });

  app.get(RESET_PATH, (c) => {
    anonymousSession(c);
    const token = c.req.query(RECOVERY_FIELDS.token) ?? '';
    const reset = token === '' ? undefined : c.var.admin.getPasswordReset(token);

    if (reset === undefined) return refuseToken(c);
    return render(c, ADMIN_TEMPLATES.reset, resetScreen(token));
  });

  app.post(RESET_PATH, async (c) => {
    const dataDir = c.var.config.dataDir;
    const body = await c.req.parseBody();
    const token = field(body[RECOVERY_FIELDS.token]);
    const password = field(body[RECOVERY_FIELDS.password]);
    const confirmation = field(body[RECOVERY_FIELDS.passwordConfirmation]);

    // Checked before the password rules, so a stale link is a stale link
    // whatever was typed into it — and so a refused form never spends one.
    const reset = token === '' ? undefined : c.var.admin.getPasswordReset(token);
    if (reset === undefined) return refuseToken(c);

    const problem = newPasswordProblem(password, confirmation);
    if (problem !== undefined) {
      c.status(400);
      // Nothing typed is echoed back: both fields are passwords.
      return render(c, ADMIN_TEMPLATES.reset, resetScreen(token, { problem }));
    }

    const user = findUserById(dataDir, reset.userId);
    if (user === undefined) {
      // The account went while the link was in flight. The token is worthless
      // now, and saying so beats a 500 from a write against nobody.
      c.var.admin.deletePasswordResetsForUser(reset.userId);
      return refuseToken(c);
    }

    await setUserPassword({ dataDir, userId: user.id, password });

    // Everything that was a way into this account is now closed: the link that
    // was just used, every other link asked for while it was in flight, and
    // every browser that was signed in. Nobody is spared, because the person
    // doing this is not signed in — they are about to be.
    c.var.admin.deletePasswordResetsForUser(user.id);
    const ended = c.var.admin.deleteSessionsForUser(user.id);

    if (user.email !== undefined) {
      // The other half of the OWASP guidance: whoever owns the address hears
      // that the password changed, so a reset they did not ask for is
      // something they find out about rather than something they discover.
      void c.var.mail.send({
        to: user.email,
        template: PASSWORD_CHANGED_TEMPLATE,
        data: { username: user.username, signedOut: ended },
      });
    }

    flash(c, 'notice', 'Your password was changed. Sign in with the new one.');
    return c.redirect(LOGIN_REDIRECT, 303);
  });

  /** What both handlers say to a token that buys nothing. */
  function refuseToken(c: Context<GeekityEnv>): Response {
    anonymousSession(c);
    c.status(400);
    return render(c, ADMIN_TEMPLATES.reset, {
      forgotUrl: FORGOT_PATH,
      resetUrl: RESET_PATH,
      fields: RECOVERY_FIELDS,
      invalid: true,
    });
  }

  /** Everything the forgot-password template renders. */
  function forgotScreen(
    c: Context<GeekityEnv>,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      forgotUrl: FORGOT_PATH,
      loginUrl: LOGIN_REDIRECT,
      fields: RECOVERY_FIELDS,
      // Read per request, exactly as the mail service reads it: a credential
      // pasted into the settings screen turns recovery on for the next visitor
      // without a restart.
      configured: c.var.mail.configured(),
      answer: RECOVERY_ANSWER,
      sent: false,
      ...extra,
    };
  }
}

/** Where a finished reset sends the browser. Spelled here to avoid a cycle. */
const LOGIN_REDIRECT = `${ADMIN_PREFIX}/login`;

/** Everything the reset template renders for a link that is still good. */
function resetScreen(token: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    forgotUrl: FORGOT_PATH,
    resetUrl: RESET_PATH,
    fields: RECOVERY_FIELDS,
    token,
    invalid: false,
    ...extra,
  };
}

/**
 * What is wrong with the password somebody typed into the reset form.
 *
 * The same rules the change-password form and `geekity user add` enforce, so a
 * password set through a reset link is one every other door would have taken.
 */
export function newPasswordProblem(password: string, confirmation: string): string | undefined {
  return (
    passwordProblem(password) ??
    (password === confirmation ? undefined : 'The two passwords do not match.')
  );
}

/** The link that goes in the message, absolute because it is read elsewhere. */
export function resetLink(baseUrl: string, token: string): string {
  const url = new URL(RESET_PATH, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set(RECOVERY_FIELDS.token, token);
  return url.href;
}

/** A form field as a string. A file upload, or a missing field, is the empty one. */
function field(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
