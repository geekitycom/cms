/**
 * Privacy: what the site shares of what it knows about its author.
 *
 * The first choice is a post's location (TASK-223, decision-29): the site
 * keeps whatever a Micropub client or the editor gives it, in a private file
 * under `data/`, and this page decides whether a reader sees none of it, the
 * place's words, or the coordinates too. Nothing is shared until the author
 * says so. Later privacy choices go here too.
 */

import { settingsPagePath } from './settings-page.ts';
import type { SettingsPage } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** The Privacy settings page. */
export const PRIVACY_SETTINGS: SettingsPage = {
  child: 'privacy',
  label: 'Privacy',
  path: settingsPagePath('privacy'),
  template: ADMIN_TEMPLATES.settingsPrivacy,
  fields: ['locationSharing'],
};
