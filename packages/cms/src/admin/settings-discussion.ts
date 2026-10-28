/**
 * Discussion: what the site takes back from the people reading it.
 *
 * WordPress's own name for the comment settings. Webmentions are here because
 * one arriving is a comment by another road, and the spam checker and the form
 * challenge are here because they are what decide whether either is shown.
 */

import type { Context, Hono } from 'hono';

import { verifyAkismetKey } from '../comments/akismet.ts';
import { verifyHcaptchaPair } from '../comments/hcaptcha.ts';
import { AKISMET } from '../settings/akismet.ts';
import type { AkismetKeyStatus } from '../settings/akismet.ts';
import { HCAPTCHA } from '../settings/hcaptcha.ts';
import type { HcaptchaPairStatus } from '../settings/hcaptcha.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import type { GeekityEnv } from '../web/env.ts';
import { effectiveBaseUrl } from '../site/settings.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { flash } from './flash.ts';
import { forgetStored, setElsewhere } from './setting-overrides.ts';
import { SETTINGS_PATH } from './settings.ts';
import { settingsPagePath } from './settings-page.ts';
import type { MountSettingsOptions, SettingsPage } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/**
 * Where the Akismet key's form and its Remove button post.
 *
 * Its own endpoint, for the reason the avatar has one: the key is a credential,
 * the secret `akismet.key` setting in `data/akismet.json`, rather than a
 * setting that lives in `content/_data/site.json`, so it is not a field of the
 * Discussion form, and a key Akismet will not take must not lose an edit to the
 * closing window beside it.
 */
export const AKISMET_PATH = `${SETTINGS_PATH}/akismet`;

/** The fields those two forms submit. */
export const AKISMET_FIELDS = { key: 'akismet_key', action: 'action' } as const;

/** The {@link AKISMET_FIELDS.action} that forgets the key again. */
export const AKISMET_REMOVE = 'remove';

export const AKISMET_VERIFY = 'verify';

/**
 * Where the hCaptcha form and its Remove and Check buttons post.
 *
 * Its own endpoint for the reason the Akismet key has one: the site key and
 * the secret are the `hcaptcha` namespace in `data/hcaptcha.json`, not fields
 * of `site.json`.
 */
export const HCAPTCHA_PATH = `${SETTINGS_PATH}/hcaptcha`;

/** The fields those forms submit. */
export const HCAPTCHA_FIELDS = {
  siteKey: 'hcaptcha_site_key',
  secret: 'hcaptcha_secret',
  action: 'action',
} as const;

/** The {@link HCAPTCHA_FIELDS.action} that forgets the site key and the secret. */
export const HCAPTCHA_REMOVE = 'remove';

/** The {@link HCAPTCHA_FIELDS.action} that checks the pair in effect again. */
export const HCAPTCHA_VERIFY = 'verify';

/** The Discussion settings page. */
export const DISCUSSION_SETTINGS: SettingsPage = {
  child: 'discussion',
  label: 'Discussion',
  path: settingsPagePath('discussion'),
  template: ADMIN_TEMPLATES.settingsDiscussion,
  fields: [
    'comments',
    'comments_on_posts',
    'comments_on_pages',
    'comments_close_after_days',
    'webmentions_send',
    'webmentions_receive',
    'comment_email_retention_days',
    'address_hash_retention_days',
    'contact_message_retention_days',
  ],

  panels: async (c) => ({
    ...(await akismetPanel(c.var.settings)),
    ...(await hcaptchaPanel(c.var.settings)),
  }),

  endpoints: (app, options) => {
    mountAkismet(app, options);
    mountHcaptcha(app, options);
  },
};

/**
 * The Akismet key: one form saves it, a second forgets it.
 *
 * The key is checked with Akismet's own `verify-key` before it is stored, so a
 * site is told about a typo now rather than by a queue that quietly stops being
 * filtered. What comes back is stored beside the key, because it is what the
 * screen reports and re-asking on every render would be a network call to draw
 * a page.
 *
 * A key Akismet refuses is stored all the same, marked as refused. It does no
 * harm — `comment-check` with a key Akismet does not know answers `invalid`,
 * which this treats as no opinion, so comments queue exactly as they did — and
 * storing it is what lets the screen say "Akismet does not recognise this key"
 * instead of throwing away what somebody pasted.
 */
function mountAkismet(app: Hono<GeekityEnv>, _options: MountSettingsOptions): void {
  const here = DISCUSSION_SETTINGS.path;

  app.post(AKISMET_PATH, async (c) => {
    const body = await c.req.parseBody();
    const { settings } = c.var;
    const action = stringOrEmpty(body[AKISMET_FIELDS.action]);

    if (action === AKISMET_REMOVE) {
      await forgetStored(settings, AKISMET, 'admin');
      flash(c, 'notice', 'The Akismet key is gone. Nothing is sent to Akismet any more.');
      return c.redirect(here, 303);
    }

    if (action !== AKISMET_VERIFY) {
      const key = stringOrEmpty(body[AKISMET_FIELDS.key]).trim();
      if (key === '') {
        flash(c, 'error', 'An Akismet key cannot be empty. Use Remove key to turn Akismet off.');
        return c.redirect(here, 303);
      }
      const saved = await settings.set(
        'akismet',
        new Map<string, unknown>([
          ['key', key],
          ['status', 'unchecked'],
          ['checked_at', ''],
        ]),
        'admin',
      );
      if (!saved.ok) {
        flash(c, 'error', `${Object.values(saved.problems).join(' ')} Nothing was saved.`);
        return c.redirect(here, 303);
      }
    }

    const status = await verifyAkismetKey({
      settings,
      blog: blogOf(c),
      at: c.var.config.now(),
      by: 'admin',
    });
    flash(c, status === 'valid' ? 'notice' : 'error', verifiedSentence(status));
    return c.redirect(here, 303);
  });
}

function blogOf(c: Context<GeekityEnv>): string {
  return effectiveBaseUrl(c.var.config, c.var.siteAtRequestStart);
}

function verifiedSentence(status: AkismetKeyStatus | undefined): string {
  switch (status) {
    case 'valid':
      return 'Akismet is connected. Comments and webmentions are checked from now on.';
    case 'invalid':
      return 'The key is stored, but Akismet does not recognise it, so nothing it says will be believed.';
    case 'unchecked':
      return 'The key is stored, but Akismet could not be reached to check it. Save it again to try.';
    case undefined:
      return 'There is no Akismet key to check.';
  }
}

/**
 * What the page says about Akismet: connected, refused, unchecked, or off.
 *
 * The key itself never leaves this function. A settings screen that printed it
 * back would put a credential in every browser cache and every screenshot; the
 * last four characters are enough for somebody to recognise which key is in
 * there without being handed it.
 */
export async function akismetPanel(settings: SettingsRegistry): Promise<Record<string, unknown>> {
  const akismet = await settings.values(AKISMET);
  const setBy = (await setElsewhere(settings, AKISMET))['key'];
  const forms = {
    akismetUrl: AKISMET_PATH,
    akismetFields: AKISMET_FIELDS,
    akismetRemove: AKISMET_REMOVE,
    akismetVerify: AKISMET_VERIFY,
    akismetSetBy: setBy,
  };

  if (akismet.key === '') {
    return {
      ...forms,
      akismetPresent: false,
      akismetState: 'none',
      akismetHint: 'Not connected: no key, so no comment is sent to Akismet.',
    };
  }

  return {
    ...forms,
    akismetPresent: true,
    akismetState: akismet.status,
    akismetKeyHint: setBy === undefined ? `…${akismet.key.slice(-4)}` : `set by ${setBy}`,
    akismetCheckedAt: akismet.checked_at,
    akismetHint:
      akismet.status === 'valid'
        ? 'Connected. Every comment and every incoming webmention is checked.'
        : akismet.status === 'invalid'
          ? 'Akismet does not recognise this key, so nothing it says is believed and every comment queues as it would without one.'
          : 'Akismet could not be reached the last time this key was checked. Check it again to try.',
  };
}

/**
 * The hCaptcha site key and secret: one form saves them, a second forgets
 * them, a third checks them again.
 *
 * A blank secret keeps the stored one, as a blank SMTP password does: the
 * form never prints the secret back, so a blank box has to mean "unchanged"
 * or nobody could correct the site key without pasting the secret again. The
 * site key is printed back, because every page with a challenge prints it.
 *
 * The pair is checked with siteverify after it is stored, and a pair hCaptcha
 * refuses is stored all the same, as an Akismet key is: the screen says so,
 * and nothing that was pasted is thrown away.
 */
function mountHcaptcha(app: Hono<GeekityEnv>, _options: MountSettingsOptions): void {
  const here = DISCUSSION_SETTINGS.path;

  app.post(HCAPTCHA_PATH, async (c) => {
    const body = await c.req.parseBody();
    const { settings } = c.var;
    const action = stringOrEmpty(body[HCAPTCHA_FIELDS.action]);

    if (action === HCAPTCHA_REMOVE) {
      await forgetStored(settings, HCAPTCHA, 'admin');
      const elsewhere = await setElsewhere(settings, HCAPTCHA, ['site_key', 'secret']);
      flash(
        c,
        'notice',
        Object.keys(elsewhere).length === 0
          ? 'The hCaptcha site key and secret are gone. No form is challenged any more.'
          : `The stored hCaptcha values are gone. ${Object.entries(elsewhere)
              .map(([key, source]) => `${source} still sets hcaptcha.${key}.`)
              .join(' ')}`,
      );
      return c.redirect(here, 303);
    }

    if (action !== HCAPTCHA_VERIFY) {
      const changes = await submittedPair(settings, body);
      if (typeof changes === 'string') {
        flash(c, 'error', changes);
        return c.redirect(here, 303);
      }
      const saved = await settings.set('hcaptcha', changes, 'admin');
      if (!saved.ok) {
        flash(c, 'error', `${Object.values(saved.problems).join(' ')} Nothing was saved.`);
        return c.redirect(here, 303);
      }
    }

    const status = await verifyHcaptchaPair({ settings, at: c.var.config.now(), by: 'admin' });
    flash(c, status === 'valid' ? 'notice' : 'error', pairSentence(status));
    return c.redirect(here, 303);
  });
}

/**
 * What the hCaptcha form asks to store, or the sentence that says why not.
 *
 * A value the environment sets is left out unless something was typed for it,
 * so the registry can refuse that in its own words; the form shows no box for
 * one, so only a hand-made request gets that far.
 */
async function submittedPair(
  settings: SettingsRegistry,
  body: Record<string, unknown>,
): Promise<Map<string, unknown> | string> {
  const elsewhere = await setElsewhere(settings, HCAPTCHA);
  const siteKey = stringOrEmpty(body[HCAPTCHA_FIELDS.siteKey]).trim();
  const secret = stringOrEmpty(body[HCAPTCHA_FIELDS.secret]).trim();
  const changes = new Map<string, unknown>([
    ['status', 'unchecked'],
    ['checked_at', ''],
  ]);

  if (siteKey !== '') changes.set('site_key', siteKey);
  else if (elsewhere['site_key'] === undefined) {
    return 'An hCaptcha site key cannot be empty. Use Remove to turn hCaptcha off.';
  }

  if (secret !== '') changes.set('secret', secret);
  else if ((await settings.get(HCAPTCHA.secret)) === '') {
    return 'An hCaptcha secret cannot be empty. Paste the secret from the hCaptcha dashboard.';
  }

  return changes;
}

function pairSentence(status: HcaptchaPairStatus | undefined): string {
  switch (status) {
    case 'valid':
      return 'Saved. hCaptcha took the site key; the first form a visitor sends proves the secret.';
    case 'invalid':
      return 'Saved, but hCaptcha refused the site key or the secret, so no form is challenged until they are put right.';
    case 'unchecked':
      return 'Saved, but hCaptcha could not be reached to check the pair. Check it again to try.';
    case undefined:
      return 'There is no hCaptcha site key and secret to check.';
  }
}

/**
 * What the page says about hCaptcha: connected, refused, unchecked, half set,
 * or off.
 *
 * The site key is shown whole, because every page with a challenge prints it.
 * The secret is never shown, not even its last characters: the screen says
 * only whether one is there, and which variable sets it when one does.
 */
export async function hcaptchaPanel(settings: SettingsRegistry): Promise<Record<string, unknown>> {
  const hcaptcha = await settings.values(HCAPTCHA);
  const setBy = await setElsewhere(settings, HCAPTCHA, ['site_key', 'secret']);
  const siteKeyPresent = hcaptcha.site_key !== '';
  const secretPresent = hcaptcha.secret !== '';
  const stored = await storedPair(settings, setBy);
  const forms = {
    hcaptchaUrl: HCAPTCHA_PATH,
    hcaptchaFields: HCAPTCHA_FIELDS,
    hcaptchaRemove: HCAPTCHA_REMOVE,
    hcaptchaVerify: HCAPTCHA_VERIFY,
    hcaptchaSiteKey: hcaptcha.site_key,
    hcaptchaSiteKeySetBy: setBy['site_key'],
    hcaptchaSecretSetBy: setBy['secret'],
    hcaptchaSecretPresent: secretPresent,
    hcaptchaStored: stored,
  };

  if (!siteKeyPresent || !secretPresent) {
    return {
      ...forms,
      hcaptchaPresent: false,
      hcaptchaState: siteKeyPresent || secretPresent ? 'incomplete' : 'none',
      hcaptchaHint:
        siteKeyPresent || secretPresent
          ? 'Not on yet: a challenge needs both a site key and a secret.'
          : 'Not connected: no site key and secret, so no form is challenged.',
    };
  }

  return {
    ...forms,
    hcaptchaPresent: true,
    hcaptchaState: hcaptcha.status,
    hcaptchaCheckedAt: hcaptcha.checked_at,
    hcaptchaHint:
      hcaptcha.status === 'valid'
        ? 'hCaptcha took the site key when it was last checked. It checks the secret only against a solved challenge, so the first form a visitor sends is what proves it.'
        : hcaptcha.status === 'invalid'
          ? 'hCaptcha refused the site key or the secret the last time they were checked, so no form is challenged until they are put right.'
          : 'hCaptcha could not be reached the last time the pair was checked. Check it again to try.',
  };
}

/** Whether `data/hcaptcha.json` holds a value Remove would forget. */
async function storedPair(
  settings: SettingsRegistry,
  setBy: Readonly<Record<string, string>>,
): Promise<boolean> {
  for (const ref of [HCAPTCHA.site_key, HCAPTCHA.secret]) {
    if (setBy[ref.key] !== undefined) continue;
    const { stored } = await settings.resolve(ref);
    if (stored !== undefined && stored !== '') return true;
  }
  return false;
}
