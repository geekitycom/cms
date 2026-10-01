/**
 * General: what the site is called, where it lives, and what it looks like.
 *
 * WordPress's own first settings page, and the one the Settings heading lands
 * on. There is no avatar here any more: decision-14 made every user an actor
 * with a picture of their own, so the picture a site shows the fediverse is a
 * user's, edited on the users screen beside the rest of their profile.
 */

import type { ResolvedConfig } from '../config.ts';
import { userForAuthor } from '../web/authors.ts';
import { listUsers } from './accounts.ts';
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
  fields: ['title', 'tagline', 'author', 'baseUrl', 'timezone', 'language', 'locale'],

  // The base URL field shows the one in effect rather than the one the file
  // happens to hold: a site.json with no `url` at all would otherwise render an
  // empty field that the validator refuses the moment anything is saved.
  //
  // The author is shown as the user it resolves to, so a site.json written
  // before the select, holding a display name, selects that user and the
  // first save writes their username (TASK-192). A name nobody answers to
  // selects Several authors.
  shown: (config, settings) => ({
    ...settings,
    baseUrl: effectiveBaseUrl(config, settings),
    author: siteAuthorUsername(config, settings.author),
  }),

  panels: (c, settings) => ({
    ...baseUrlPanel(c.var.config, settings),
    authorChoices: listUsers(c.var.config.dataDir).map((user) => ({
      username: user.username,
      name: user.profile?.displayName ?? user.username,
    })),
  }),

  // A field the form rendered read-only is not submitted, so an overridden base
  // URL keeps the value it had rather than being cleared by a save.
  //
  // The author is whoever the submitted username is, and nobody when it is
  // not a user, so the file only ever holds a username or no author at all.
  reads: ({ c, body, current }) => ({
    author: siteAuthorUsername(c.var.config, bodyField(body[SETTINGS_FIELDS.author])),
    baseUrl:
      c.var.config.baseUrlSource === 'default'
        ? bodyField(body[SETTINGS_FIELDS.baseUrl])
        : current.baseUrl === ''
          ? c.var.config.baseUrl
          : current.baseUrl,
  }),
};

/** The username a stored or submitted author names, or empty for several authors. */
function siteAuthorUsername(config: Pick<ResolvedConfig, 'dataDir'>, author: string): string {
  return userForAuthor(listUsers(config.dataDir), author)?.username ?? '';
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
