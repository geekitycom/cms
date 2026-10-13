import { SITE } from '../site/namespace.ts';
import type { SiteSettings } from '../site/settings.ts';
import { settingsOver } from './settings.ts';

export async function siteSettingsIn(contentDir: string): Promise<SiteSettings> {
  return await settingsOver({ contentDir, dataDir: contentDir }).values(SITE);
}
