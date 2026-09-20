/**
 * Every settings page there is, and which of them Settings lists.
 *
 * This module is the list. What a page is made of is `settings-page.ts`, what
 * each page carries is its own module, and what a setting means is
 * `settings.ts`; the only thing that has to know all six exists is the mount
 * and the menu.
 *
 * The order is the order the menu shows them, General first: the Settings
 * heading lands on its first child, and General is `/admin/settings` itself.
 *
 * Five of the six are Settings' own children. Federation's is a settings page
 * in every other respect — the same fields, the same save, the same refusals —
 * but the menu files it under the Federation section, beside the followers it
 * is about (TASK-109), so it is in {@link ALL_SETTINGS_PAGES} and not in
 * {@link SETTINGS_PAGES}. Both lists matter: {@link ALL_SETTINGS_PAGES} is
 * what the mount registers and what "every setting is on exactly one page" is
 * checked against, and {@link SETTINGS_PAGES} is what the Settings menu has to
 * agree with.
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

/** The settings pages the Settings menu lists, in the order it lists them. */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  GENERAL_SETTINGS,
  READING_SETTINGS,
  PERMALINKS_SETTINGS,
  DISCUSSION_SETTINGS,
  EMAIL_SETTINGS,
];

/** Every settings page, wherever the menu files it. */
export const ALL_SETTINGS_PAGES: readonly SettingsPage[] = [...SETTINGS_PAGES, FEDERATION_SETTINGS];

/** Register every settings page, including the one filed under Federation. */
export function mountSettings(app: Hono<GeekityEnv>, options: MountSettingsOptions): void {
  for (const page of ALL_SETTINGS_PAGES) mountSettingsPage(app, page, options);
}
