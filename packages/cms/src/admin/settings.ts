import { ADMIN_PREFIX } from './session.ts';

/**
 * Where the settings live: the General page, and the root every other settings
 * page hangs off ({@link settingsPagePath}).
 */
export const SETTINGS_PATH = `${ADMIN_PREFIX}/settings`;
