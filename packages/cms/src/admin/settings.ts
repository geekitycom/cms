import { ADMIN_PREFIX } from './session.ts';

/**
 * Where the settings live: the General page, and the root every other settings
 * page hangs off ({@link settingsPagePath}).
 */
export const SETTINGS_PATH = `${ADMIN_PREFIX}/settings`;

// The settings themselves live in `src/site/` (TASK-354). These re-exports keep
// the admin's importers working until TASK-364 points them there.
export { migrateSettingsToFile } from './settings-migration.ts';
export {
  EMAIL_PATTERN,
  LANGUAGE_TAG_PATTERN,
  normalizeRelayInbox,
  relayList,
} from '../site/setting-values.ts';
export {
  DEFAULT_SITE_SETTINGS,
  effectiveBaseUrl,
  retentionPolicyOf,
  robotsPolicyOf,
  taxonomyBasesFromSettings,
} from '../site/settings.ts';
export type { ContentSignalChoice, LicenseChoice, SiteSettings } from '../site/settings.ts';
export {
  formFromSettings,
  SETTINGS_FIELD_NAMES,
  SETTINGS_FIELDS,
  settingsFromForm,
  settingsProblems,
} from '../site/settings-form.ts';
export type {
  CarriedSettings,
  SettingsContext,
  SettingsField,
  SettingsForm,
  SettingsProblems,
} from '../site/settings-form.ts';
export {
  parseSiteJson,
  readSiteJson,
  readSiteSettings,
  settingsFromSiteJson,
  siteDataPath,
  siteJsonFor,
  updateSiteSettings,
  writeSiteJson,
} from '../site/site-json.ts';
