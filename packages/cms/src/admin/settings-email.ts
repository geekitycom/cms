/**
 * Email: how the site sends mail, and where a message written to it goes.
 *
 * The settings are here and the credentials are not: an API key and an SMTP
 * password live in `data/mail.json` at mode 0600, never in the public
 * `site.json`, and they are their own pair of forms so a credential typed wrong
 * cannot lose an edit to the From line beside it.
 */

import type { Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import {
  readMailCredentials,
  removeMailCredentials,
  writeMailCredentials,
} from '../mail/credentials.ts';
import type { MailCredentials } from '../mail/credentials.ts';
import { MAIL_PROVIDERS } from '../mail/provider.ts';
import { flash } from './flash.ts';
import { bodyField, settingsPagePath } from './settings-page.ts';
import type { MountSettingsOptions, SettingsPage } from './settings-page.ts';
import { EMAIL_PATTERN, readSiteSettings, SETTINGS_PATH } from './settings.ts';
import type { SiteSettings } from './settings.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/**
 * Where the mail credential's form and its Remove button post.
 *
 * Its own endpoint for the reason the Akismet key has one: an API key and an
 * SMTP password are credentials, they live in `data/mail.json` rather than in
 * `content/_data/site.json`, and a credential typed wrong must not lose an edit
 * to the From line. Which provider is in use and who mail is from are settings
 * and stay on the Email form.
 */
export const MAIL_PATH = `${SETTINGS_PATH}/mail`;

/** The fields the credential form and its Remove button submit. */
export const MAIL_FIELDS = {
  brevoApiKey: 'brevo_api_key',
  smtpHost: 'smtp_host',
  smtpPort: 'smtp_port',
  smtpSecure: 'smtp_secure',
  smtpUser: 'smtp_user',
  smtpPassword: 'smtp_password',
  action: 'action',
} as const;

/** The {@link MAIL_FIELDS.action} that forgets every mail credential. */
export const MAIL_REMOVE = 'remove';

/** Where the Send test email button posts. */
export const MAIL_TEST_PATH = `${SETTINGS_PATH}/mail/test`;

/** The field that form submits: where to send the test message. */
export const MAIL_TEST_FIELDS = { to: 'to' } as const;

/** The message the Send test email button sends, as the theme names it. */
export const MAIL_TEST_TEMPLATE = 'test';

/** The Email settings page. */
export const EMAIL_SETTINGS: SettingsPage = {
  child: 'email',
  label: 'Email',
  path: settingsPagePath('email'),
  template: ADMIN_TEMPLATES.settingsEmail,
  fields: ['mailProvider', 'mailFromName', 'mailFromAddress', 'mailReplyTo', 'contactEmail'],

  panels: (c, settings) => mailPanel(c.var.config.dataDir, settings),

  endpoints: mountMail,
};

/** The mail credential's endpoints: save it, forget it, and prove it works. */
function mountMail(app: Hono<GeekityEnv>, _options: MountSettingsOptions): void {
  const here = EMAIL_SETTINGS.path;

  /**
   * The mail credential: one form saves it, a second forgets it.
   *
   * It keeps both providers' credentials at once, so a site trying SMTP after
   * Brevo can switch the provider back without pasting the key in again.
   *
   * A blank secret keeps the stored one. The form cannot render a password back
   * into a page, so a blank field has to mean "unchanged" or nobody could ever
   * edit the SMTP port without retyping the password.
   */
  app.post(MAIL_PATH, async (c) => {
    const body = await c.req.parseBody();
    const { config } = c.var;
    const stored = readMailCredentials(config.dataDir);

    if (bodyField(body[MAIL_FIELDS.action]) === MAIL_REMOVE) {
      await removeMailCredentials(config.dataDir);
      flash(c, 'notice', 'The mail credentials are gone. No email is sent any more.');
      return c.redirect(here, 303);
    }

    const apiKey = bodyField(body[MAIL_FIELDS.brevoApiKey]).trim();
    const host = bodyField(body[MAIL_FIELDS.smtpHost]).trim();
    const port = Number(bodyField(body[MAIL_FIELDS.smtpPort]).trim());
    const password = bodyField(body[MAIL_FIELDS.smtpPassword]);

    if (host !== '' && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      flash(c, 'error', 'An SMTP port is a whole number between 1 and 65535. Nothing was saved.');
      return c.redirect(here, 303);
    }

    const credentials: MailCredentials = {
      ...(apiKey === ''
        ? stored.brevo === undefined
          ? {}
          : { brevo: stored.brevo }
        : { brevo: { apiKey } }),
      ...(host === ''
        ? stored.smtp === undefined
          ? {}
          : { smtp: stored.smtp }
        : {
            smtp: {
              host,
              port,
              secure: bodyField(body[MAIL_FIELDS.smtpSecure]) !== '',
              user: bodyField(body[MAIL_FIELDS.smtpUser]).trim(),
              // A blank password keeps the stored one, so the port and the user
              // can be edited without retyping a secret the form was never
              // allowed to show.
              password: password === '' ? (stored.smtp?.password ?? '') : password,
            },
          }),
    };

    await writeMailCredentials(config.dataDir, credentials);

    const settings = readSiteSettings(config.contentDir);
    flash(
      c,
      'notice',
      settings.mailProvider === 'none'
        ? 'Saved. Choose a provider above and save the settings to start sending.'
        : 'Saved. Send a test message to prove it reaches you.',
    );
    return c.redirect(here, 303);
  });

  /**
   * Send test email: the one button that proves the whole chain.
   *
   * It goes through the same mail service every feature will, so what it proves
   * is not "these credentials parse" but "a message from this site arrives" —
   * the template, the From line, the provider and the retry included. Whatever
   * the provider said comes back on the flash, its own words and all, because a
   * refusal names the field to fix and a summary of one never does.
   */
  app.post(MAIL_TEST_PATH, async (c) => {
    const body = await c.req.parseBody();
    const to = bodyField(body[MAIL_TEST_FIELDS.to]).trim();

    if (!EMAIL_PATTERN.test(to)) {
      flash(c, 'error', 'Type the address to send the test message to.');
      return c.redirect(here, 303);
    }

    const result = await c.var.mail.send({ to, template: MAIL_TEST_TEMPLATE });

    flash(
      c,
      result.ok && !result.skipped ? 'notice' : 'error',
      result.skipped
        ? 'No mail is configured, so nothing was sent. Choose a provider and save a credential first.'
        : result.ok
          ? `A test message was sent to ${to} via ${result.provider}${
              result.messageId === undefined ? '' : ` (${result.messageId})`
            }. If it does not arrive, look in the spam folder and at the provider's own log.`
          : `${result.provider} would not send to ${to} after ${String(result.attempts)} ${
              result.attempts === 1 ? 'attempt' : 'attempts'
            }: ${result.error ?? 'no reason given'}`,
    );
    return c.redirect(here, 303);
  });
}

/**
 * What the page says about email: which provider is chosen, whether the
 * credential it needs is there, and enough of it to recognise which one.
 *
 * Nothing here ever prints a key or a password. A settings screen that echoed
 * one would put a credential in every browser cache, every screenshot and every
 * `view-source`; the last four characters of an API key and the host and user
 * of an SMTP connection are enough for somebody to tell what is stored without
 * being handed the means to use it.
 */
export function mailPanel(dataDir: string, settings: SiteSettings): Record<string, unknown> {
  const stored = readMailCredentials(dataDir);
  const present =
    settings.mailProvider === 'brevo' ? stored.brevo !== undefined : stored.smtp !== undefined;

  return {
    mailUrl: MAIL_PATH,
    mailFields: MAIL_FIELDS,
    mailRemove: MAIL_REMOVE,
    mailTestUrl: MAIL_TEST_PATH,
    mailTestFields: MAIL_TEST_FIELDS,
    mailProviders: MAIL_PROVIDERS,
    mailProvider: settings.mailProvider,
    // Whether the chosen provider has what it needs. A key stored for the
    // provider that is not chosen is not "configured": nothing would use it.
    mailConfigured: settings.mailProvider !== 'none' && present,
    mailBrevoPresent: stored.brevo !== undefined,
    mailSmtpPresent: stored.smtp !== undefined,
    ...(stored.brevo === undefined
      ? {}
      : { mailBrevoKeyHint: `…${stored.brevo.apiKey.slice(-4)}` }),
    ...(stored.smtp === undefined
      ? {}
      : {
          mailSmtp: {
            host: stored.smtp.host,
            port: stored.smtp.port,
            secure: stored.smtp.secure,
            user: stored.smtp.user,
            // Not the password. Whether there is one at all is all the screen
            // needs to say.
            hasPassword: stored.smtp.password !== '',
          },
        }),
    mailHint:
      settings.mailProvider === 'none'
        ? 'This site sends no email. Password resets, moderation notices and contact messages are still recorded; they are simply not sent.'
        : present
          ? 'Mail is configured. Send a test message to prove it reaches you.'
          : settings.mailProvider === 'brevo'
            ? 'Brevo is chosen but there is no API key, so nothing is sent.'
            : 'SMTP is chosen but there is no server, so nothing is sent.',
  };
}
