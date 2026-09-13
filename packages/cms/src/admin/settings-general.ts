/**
 * General: what the site is called, where it lives, and what it looks like.
 *
 * WordPress's own first settings page, and the one the Settings heading lands
 * on. There is no avatar here any more: decision-14 made every user an actor
 * with a picture of their own, so the picture a site shows the fediverse is a
 * user's, edited on the users screen beside the rest of their profile.
 */

import type { ResolvedConfig } from '../config.ts';
import { bodyField, settingsPagePath } from './settings-page.ts';
import type { SettingsPage } from './settings-page.ts';
import { effectiveBaseUrl, SETTINGS_FIELDS } from './settings.ts';
import type { SiteSettings } from './settings.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

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

  panels: (c, settings) => baseUrlPanel(c.var.config, settings),

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
};

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
