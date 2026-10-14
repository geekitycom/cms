import { updateFileAtomically } from '../files/atomic.ts';
import { fileWith } from '../settings/registry.ts';
import { SITE, siteJsonPath } from '../site/namespace.ts';
import type { SiteSettings } from '../site/settings.ts';
import { isRecord } from '../util/guards.ts';
import { settingsOver } from './settings.ts';

export async function siteSettingsIn(contentDir: string): Promise<SiteSettings> {
  return await settingsOver({ contentDir, dataDir: contentDir }).values(SITE);
}

/**
 * A test's set-up: write these settings as `site.json`, keeping the keys they
 * do not declare. No check runs, so a fixture can name an icon it never
 * uploaded or a theme it never installed.
 */
export async function writeSiteSettings(options: {
  contentDir: string;
  settings: SiteSettings;
}): Promise<void> {
  await updateFileAtomically(siteJsonPath(options.contentDir), (current) => {
    let existing: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(current ?? '');
      if (isRecord(parsed)) existing = parsed;
    } catch {
      existing = {};
    }
    return `${JSON.stringify(fileWith(SITE, options.settings, existing), null, 2)}\n`;
  });
}

/** A test's set-up: change some settings from what the file holds now. */
export async function changeSiteSettings(
  contentDir: string,
  change: Partial<SiteSettings>,
): Promise<void> {
  await writeSiteSettings({
    contentDir,
    settings: { ...(await siteSettingsIn(contentDir)), ...change },
  });
}
