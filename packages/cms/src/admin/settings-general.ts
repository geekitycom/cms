/**
 * General: what the site is called, where it lives, and what it looks like.
 *
 * WordPress's own first settings page, and the one the Settings heading lands
 * on. There is no avatar here any more: every user is an actor
 * with a picture of their own, so the picture a site shows the fediverse is a
 * user's, edited on the users screen beside the rest of their profile.
 */

import type { Hono } from 'hono';

import type { ResolvedConfig } from '../config.ts';
import { userForAuthor } from '../content/authors.ts';
import { iconSetting, siteIcons } from '../images/icons.ts';
import { effectiveBaseUrl } from '../site/settings.ts';
import type { SiteSettings } from '../site/settings.ts';
import { listUsers } from '../site/users.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { CREATIVE_COMMONS_LICENSES } from '../content/license.ts';
import { TMDB } from '../settings/tmdb.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import type { GeekityEnv } from '../web/env.ts';
import { flash } from './flash.ts';
import { forgetStored, setElsewhere } from './setting-overrides.ts';
import { SETTINGS_FIELDS } from './settings-fields.ts';
import { SETTINGS_PATH } from './settings.ts';
import { settingsPagePath } from './settings-page.ts';
import type { SettingsPage } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** The General settings page. */
export const GENERAL_SETTINGS: SettingsPage = {
  child: 'general',
  label: 'General',
  path: settingsPagePath('general'),
  template: ADMIN_TEMPLATES.settingsGeneral,
  fields: [
    'title',
    'tagline',
    'author',
    'base_url',
    'timezone',
    'language',
    'locale',
    'icon',
    'header_icon',
    'license',
    'license_url',
    'license_name',
  ],

  // The base URL field shows the one in effect rather than the one the file
  // happens to hold: a site.json with no `url` at all would otherwise render an
  // empty field that the validator refuses the moment anything is saved.
  //
  // The author is shown as the user it resolves to, so a site.json written
  // before the select, holding a display name, selects that user and the
  // first save writes their username. A name nobody answers to
  // selects Several authors.
  shown: (config, settings) => ({
    ...settings,
    base_url: effectiveBaseUrl(config, settings),
    author: siteAuthorUsername(config, settings.author),
    icon: iconInEffect(settings) ?? '',
  }),

  panels: async (c, settings) => ({
    ...(await tmdbPanel(c.var.settings)),
    ...baseUrlPanel(c.var.config, settings),
    ...iconPanel(c.var.config, settings),
    licenseChoices: Object.entries(CREATIVE_COMMONS_LICENSES).map(([key, license]) => ({
      key,
      name: `${license.name}, ${license.title}`,
    })),
    authorChoices: listUsers(c.var.config.dataDir).map((user) => ({
      username: user.username,
      name: user.profile?.displayName ?? user.username,
    })),
  }),

  // The author is whoever the submitted username is, and nobody when it is
  // not a user, so the file only ever holds a username or no author at all.
  reads: ({ c, body }) => ({
    author: siteAuthorUsername(c.var.config, stringOrEmpty(body[SETTINGS_FIELDS.author])),
  }),

  endpoints: mountTmdb,
};

export const TMDB_PATH = `${SETTINGS_PATH}/tmdb`;

export const TMDB_FIELDS = { key: 'tmdb_key', action: 'action' } as const;

export const TMDB_REMOVE = 'remove';

function mountTmdb(app: Hono<GeekityEnv>): void {
  const here = GENERAL_SETTINGS.path;

  app.post(TMDB_PATH, async (c) => {
    const body = await c.req.parseBody();
    const { settings } = c.var;

    if (stringOrEmpty(body[TMDB_FIELDS.action]) === TMDB_REMOVE) {
      await forgetStored(settings, TMDB, 'admin');
      flash(c, 'notice', 'The TMDb key is gone. Look up no longer asks TMDb.');
      return c.redirect(here, 303);
    }

    const key = stringOrEmpty(body[TMDB_FIELDS.key]).trim();
    if (key === '') {
      flash(c, 'error', 'A TMDb key cannot be empty. Use Remove key to stop asking TMDb.');
      return c.redirect(here, 303);
    }
    const saved = await settings.set('tmdb', new Map<string, unknown>([['key', key]]), 'admin');
    if (!saved.ok) {
      flash(c, 'error', `${Object.values(saved.problems).join(' ')} Nothing was saved.`);
      return c.redirect(here, 303);
    }
    flash(c, 'notice', 'The TMDb key is saved. Look up reads TMDb and IMDb links through it.');
    return c.redirect(here, 303);
  });
}

async function tmdbPanel(settings: SettingsRegistry): Promise<Record<string, unknown>> {
  const { key } = await settings.values(TMDB);
  const setBy = (await setElsewhere(settings, TMDB))['key'];
  return {
    tmdbUrl: TMDB_PATH,
    tmdbFields: TMDB_FIELDS,
    tmdbRemove: TMDB_REMOVE,
    tmdbSetBy: setBy,
    tmdbPresent: key !== '',
    tmdbKeyHint: key === '' ? '' : setBy === undefined ? `…${key.slice(-4)}` : `set by ${setBy}`,
  };
}

/** The username a stored or submitted author names, or empty for several authors. */
function siteAuthorUsername(config: Pick<ResolvedConfig, 'dataDir'>, author: string): string {
  return userForAuthor(listUsers(config.dataDir), author)?.username ?? '';
}

function iconInEffect(settings: SiteSettings): string | undefined {
  return iconSetting({ icon: settings.icon, avatar: settings.avatar });
}

function iconPanel(config: ResolvedConfig, settings: SiteSettings): Record<string, unknown> {
  const inEffect = iconInEffect(settings);
  const preview = siteIcons(config, inEffect).find((icon) => icon.rel === 'apple-touch-icon');

  return {
    iconInEffect: inEffect ?? '',
    iconPreview: preview?.href ?? '',
    iconFromAvatar: settings.icon === '' && inEffect !== undefined,
    iconUnderived: inEffect !== undefined && preview === undefined,
    imageOptimization: config.imageOptimization,
  };
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
