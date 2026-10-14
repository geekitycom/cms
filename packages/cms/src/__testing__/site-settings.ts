import { updateFileAtomically } from '../files/atomic.ts';
import { fileWith } from '../settings/registry.ts';
import { parseSiteJson, SITE, siteJsonPath, withoutRetiredKeys } from '../site/namespace.ts';
import type { SiteSettings } from '../site/settings.ts';
import { settingsOver } from './settings.ts';

export async function siteSettingsIn(contentDir: string): Promise<SiteSettings> {
  return await settingsOver({ contentDir, dataDir: contentDir }).values(SITE);
}

export async function writeSiteSettings(options: {
  contentDir: string;
  settings: SiteSettings;
}): Promise<void> {
  await updateFileAtomically(siteJsonPath(options.contentDir), (current) => {
    const existing = withoutRetiredKeys(parseSiteJson(current ?? ''));
    return `${JSON.stringify(fileWith(SITE, options.settings, existing), null, 2)}\n`;
  });
}

export async function changeSiteSettings(
  contentDir: string,
  change: Partial<SiteSettings>,
): Promise<void> {
  await writeSiteSettings({
    contentDir,
    settings: { ...(await siteSettingsIn(contentDir)), ...change },
  });
}
