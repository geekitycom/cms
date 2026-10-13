import { SITE } from '../site/namespace.ts';
import type { SiteSettings } from '../site/settings.ts';
import { settingsOver } from './settings.ts';

/** The site settings a content directory's `site.json` holds, read through the registry. */
export async function siteSettingsIn(contentDir: string): Promise<SiteSettings> {
  return await settingsOver({ contentDir, dataDir: contentDir }).values(SITE);
}
