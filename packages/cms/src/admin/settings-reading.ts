/**
 * Reading: what a visitor is shown, and who is told when it changes.
 *
 * WordPress's Reading page is how many posts a listing holds; this one adds
 * the site menu, which is the other thing that decides what somebody arriving
 * can reach, and the notify server, which is how a subscriber hears that a
 * feed moved on without waiting for their next poll.
 */

import { settingsPagePath } from './settings-page.ts';
import type { SettingsPage } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** The Reading settings page. */
export const READING_SETTINGS: SettingsPage = {
  child: 'reading',
  label: 'Reading',
  path: settingsPagePath('reading'),
  template: ADMIN_TEMPLATES.settingsReading,
  fields: ['postsPerPage', 'navigation', 'notifyServer'],
};
