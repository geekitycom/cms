import { settingsPagePath } from './settings-page.ts';
import type { SettingsPage } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

export const PRIVACY_SETTINGS: SettingsPage = {
  child: 'privacy',
  label: 'Privacy',
  path: settingsPagePath('privacy'),
  template: ADMIN_TEMPLATES.settingsPrivacy,
  fields: ['locationSharing'],
};
