/**
 * General: what the site is called, where it lives, and what it looks like.
 *
 * WordPress's own first settings page, and the one the Settings heading lands
 * on. The avatar is here rather than on Federation because it is the site's
 * picture everywhere — the fediverse profile is one of the places it shows —
 * and because it sits beside the title and the tagline it is shown with.
 */

import type { Context, Hono } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import type { GeekityEnv } from '../env.ts';
import { flash } from './flash.ts';
import { bodyField, settingsPagePath, toldFollowers } from './settings-page.ts';
import type { MountSettingsOptions, SettingsPage } from './settings-page.ts';
import {
  effectiveBaseUrl,
  profileChanged,
  readSiteSettings,
  SETTINGS_FIELDS,
  SETTINGS_PATH,
  updateSiteSettings,
} from './settings.ts';
import type { SiteSettings } from './settings.ts';
import { ADMIN_TEMPLATES } from './templates.ts';
import { refusedUpload, storeUpload } from './uploads.ts';

/** Where the avatar's upload form and its Remove button post. */
export const AVATAR_PATH = `${SETTINGS_PATH}/avatar`;

/** The fields those two forms submit. */
export const AVATAR_FIELDS = { file: 'avatar', action: 'action' } as const;

/** The {@link AVATAR_FIELDS.action} that takes the avatar down again. */
export const AVATAR_REMOVE = 'remove';

/** The General settings page. */
export const GENERAL_SETTINGS: SettingsPage = {
  child: 'general',
  label: 'General',
  path: settingsPagePath('general'),
  template: ADMIN_TEMPLATES.settingsGeneral,
  fields: ['title', 'tagline', 'author', 'baseUrl', 'timezone', 'language'],

  // The base URL field shows the one in effect rather than the one the file
  // happens to hold: a site.json with no `url` at all would otherwise render an
  // empty field that the validator refuses the moment anything is saved.
  shown: (config, settings) => ({ ...settings, baseUrl: effectiveBaseUrl(config, settings) }),

  panels: (c, settings) => ({
    ...baseUrlPanel(c.var.config, settings),
    avatar: settings.avatar,
    avatarUrl: AVATAR_PATH,
    avatarFields: AVATAR_FIELDS,
    avatarRemove: AVATAR_REMOVE,
  }),

  // A field the form rendered read-only is not submitted, so an overridden base
  // URL keeps the value it had rather than being cleared by a save.
  reads: ({ c, body, current }) => ({
    baseUrl:
      c.var.config.baseUrlSource === 'default'
        ? bodyField(body[SETTINGS_FIELDS.baseUrl])
        : current.baseUrl === ''
          ? c.var.config.baseUrl
          : current.baseUrl,
  }),

  // The name and the summary are the actor's profile as much as the avatar is,
  // and a follower's copy of it is only as fresh as the last thing it was told.
  saved: async (c, before, after) =>
    profileChanged(before, after) ? toldFollowers(await c.var.delivery.updateActor()) : '',

  endpoints: mountAvatar,
};

/**
 * The avatar's own endpoint: one multipart form uploads an image, and a
 * second, plain one takes it down again.
 *
 * It is separate from the General form because a file cannot travel in a
 * urlencoded body, and because the two should not share a fate: a rejected
 * image must not lose an edit to the title, and a rejected title must not lose
 * the avatar. A refusal is a flash and a redirect, so what is stored is exactly
 * what it was and the screen says why.
 */
function mountAvatar(app: Hono<GeekityEnv>, _options: MountSettingsOptions): void {
  app.post(AVATAR_PATH, async (c) => {
    const body = await c.req.parseBody();
    const stored = readSiteSettings(c.var.config.contentDir);

    if (bodyField(body[AVATAR_FIELDS.action]) === AVATAR_REMOVE) {
      if (stored.avatar === '') {
        flash(c, 'notice', 'The site has no avatar.');
        return c.redirect(GENERAL_SETTINGS.path, 303);
      }

      await saveAvatar(c, '');
      const removal = await c.var.delivery.updateActor();
      flash(c, 'notice', `Avatar removed.${toldFollowers(removal)}`);
      return c.redirect(GENERAL_SETTINGS.path, 303);
    }

    const outcome = await storeUpload(body[AVATAR_FIELDS.file], c.var.config, {
      imagesOnly: true,
    });
    if (refusedUpload(outcome)) {
      flash(c, 'error', `${outcome.error} The avatar is unchanged.`);
      return c.redirect(GENERAL_SETTINGS.path, 303);
    }

    await saveAvatar(c, outcome.url);
    const report = await c.var.delivery.updateActor();
    flash(c, 'notice', `Avatar saved.${toldFollowers(report)}`);
    return c.redirect(GENERAL_SETTINGS.path, 303);
  });
}

/** Change the avatar and nothing else, re-reading the file inside the write. */
function saveAvatar(c: Context<GeekityEnv>, avatar: string): Promise<SiteSettings> {
  return updateSiteSettings({
    contentDir: c.var.config.contentDir,
    change: (current) => ({ ...current, avatar }),
  });
}

/** What the page says about the base URL: the one in effect, and why it is. */
function baseUrlPanel(
  config: Pick<ResolvedConfig, 'baseUrl' | 'baseUrlSource'>,
  settings: SiteSettings,
): Record<string, unknown> {
  const overridden = config.baseUrlSource !== 'default';

  return {
    baseUrlInEffect: effectiveBaseUrl(config, settings),
    baseUrlOverridden: overridden,
    baseUrlSource: config.baseUrlSource,
    baseUrlNote: overridden
      ? config.baseUrlSource === 'environment'
        ? 'GEEKITY_BASE_URL is set, so it is the base URL in effect and this field is not editable here.'
        : 'The config file sets baseUrl, so it is the base URL in effect and this field is not editable here.'
      : 'Absolute URLs, the feeds and the session cookie pick this up when the site next starts.',
  };
}
