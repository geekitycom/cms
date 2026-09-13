/**
 * The pages under Settings, and nothing else.
 *
 * This module is the list. What a page is made of is `settings-page.ts`, what
 * each page carries is its own module, and what a setting means is
 * `settings.ts`; the only thing that has to know all six exists is the mount
 * and the menu.
 *
 * The order is the order the menu shows them, General first: the Settings
 * heading lands on its first child, and General is `/admin/settings` itself.
 */

import type { Hono } from 'hono';

import type { GeekityEnv } from '../env.ts';
import { DISCUSSION_SETTINGS } from './settings-discussion.ts';
import { EMAIL_SETTINGS } from './settings-email.ts';
import { FEDERATION_SETTINGS } from './settings-federation.ts';
import { GENERAL_SETTINGS } from './settings-general.ts';
import { mountSettingsPage } from './settings-page.ts';
import type { MountSettingsOptions, SettingsPage } from './settings-page.ts';
import { PERMALINKS_SETTINGS } from './settings-permalinks.ts';
import { READING_SETTINGS } from './settings-reading.ts';

/** Every settings page, in the order the Settings menu lists them. */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  GENERAL_SETTINGS,
  READING_SETTINGS,
  PERMALINKS_SETTINGS,
  DISCUSSION_SETTINGS,
  EMAIL_SETTINGS,
  FEDERATION_SETTINGS,
];

/** Register every settings page. */
export function mountSettings(app: Hono<GeekityEnv>, options: MountSettingsOptions): void {
  for (const page of SETTINGS_PAGES) mountSettingsPage(app, page, options);
}
