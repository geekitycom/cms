/**
 * Discussion: what the site takes back from the people reading it.
 *
 * WordPress's own name for the comment settings. Webmentions are here because
 * one arriving is a comment by another road, and the spam checker is here
 * because it is what decides whether either is shown.
 */

import type { Hono } from 'hono';

import {
  readAkismetKey,
  removeAkismetKey,
  verifyAkismetKey,
  writeAkismetKey,
} from '../comments/akismet.ts';
import type { AkismetKeyRecord } from '../comments/akismet.ts';
import type { GeekityEnv } from '../env.ts';
import { flash } from './flash.ts';
import { bodyField, settingsPagePath } from './settings-page.ts';
import type { MountSettingsOptions, SettingsPage } from './settings-page.ts';
import { effectiveBaseUrl, readSiteSettings, SETTINGS_PATH } from './settings.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/**
 * Where the Akismet key's form and its Remove button post.
 *
 * Its own endpoint, for the reason the avatar has one: the key is a credential
 * that lives in `data/akismet.json` rather than a setting that lives in
 * `content/_data/site.json` (TASK-52), so it is not a field of the Discussion
 * form, and a key Akismet will not take must not lose an edit to the closing
 * window beside it.
 */
export const AKISMET_PATH = `${SETTINGS_PATH}/akismet`;

/** The fields those two forms submit. */
export const AKISMET_FIELDS = { key: 'akismet_key', action: 'action' } as const;

/** The {@link AKISMET_FIELDS.action} that forgets the key again. */
export const AKISMET_REMOVE = 'remove';

/** The Discussion settings page. */
export const DISCUSSION_SETTINGS: SettingsPage = {
  child: 'discussion',
  label: 'Discussion',
  path: settingsPagePath('discussion'),
  template: ADMIN_TEMPLATES.settingsDiscussion,
  fields: ['comments', 'commentsCloseAfterDays', 'webmentionsSend', 'webmentionsReceive'],

  panels: (c) => akismetPanel(c.var.config.dataDir),

  endpoints: mountAkismet,
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
    const { config } = c.var;

    if (bodyField(body[AKISMET_FIELDS.action]) === AKISMET_REMOVE) {
      await removeAkismetKey(config.dataDir);
      flash(c, 'notice', 'The Akismet key is gone. Nothing is sent to Akismet any more.');
      return c.redirect(here, 303);
    }

    const key = bodyField(body[AKISMET_FIELDS.key]).trim();
    if (key === '') {
      flash(c, 'error', 'An Akismet key cannot be empty. Use Remove key to turn Akismet off.');
      return c.redirect(here, 303);
    }

    const blog = effectiveBaseUrl(config, readSiteSettings(config.contentDir));
    const status = await verifyAkismetKey({ key, blog });

    await writeAkismetKey(config.dataDir, {
      key,
      status,
      checkedAt: config.now().toISOString(),
    });

    flash(
      c,
      status === 'valid' ? 'notice' : 'error',
      status === 'valid'
        ? 'Akismet is connected. Comments and webmentions are checked from now on.'
        : status === 'invalid'
          ? 'The key is stored, but Akismet does not recognise it, so nothing it says will be believed.'
          : 'The key is stored, but Akismet could not be reached to check it. Save it again to try.',
    );
    return c.redirect(here, 303);
  });
}

/**
 * What the page says about Akismet: connected, refused, unchecked, or off.
 *
 * The key itself never leaves this function. A settings screen that printed it
 * back would put a credential in every browser cache and every screenshot; the
 * last four characters are enough for somebody to recognise which key is in
 * there without being handed it.
 */
export function akismetPanel(dataDir: string): Record<string, unknown> {
  const stored: AkismetKeyRecord | undefined = readAkismetKey(dataDir);

  if (stored === undefined) {
    return {
      akismetUrl: AKISMET_PATH,
      akismetFields: AKISMET_FIELDS,
      akismetRemove: AKISMET_REMOVE,
      akismetPresent: false,
      akismetState: 'none',
      akismetHint: 'Not connected: no key, so no comment is sent to Akismet.',
    };
  }

  return {
    akismetUrl: AKISMET_PATH,
    akismetFields: AKISMET_FIELDS,
    akismetRemove: AKISMET_REMOVE,
    akismetPresent: true,
    akismetState: stored.status,
    akismetKeyHint: `…${stored.key.slice(-4)}`,
    akismetCheckedAt: stored.checkedAt,
    akismetHint:
      stored.status === 'valid'
        ? 'Connected. Every comment and every incoming webmention is checked.'
        : stored.status === 'invalid'
          ? 'Akismet does not recognise this key, so nothing it says is believed and every comment queues as it would without one.'
          : 'Akismet could not be reached the last time this key was checked. Save it again to try.',
  };
}
