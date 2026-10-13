import path from 'node:path';

import { updateFileAtomically } from '../files/atomic.ts';
import { fileWith, storedValues } from '../settings/registry.ts';
import { isRecord } from '../util/guards.ts';
import { SITE_DATA_FILE } from '../theme/site-data.ts';
import { SITE } from './namespace.ts';
import { DEFAULT_SITE_SETTINGS } from './settings.ts';
import type { SiteSettings } from './settings.ts';

const RETIRED_KEYS = ['navigation', 'soloAuthor'] as const;

export function parseSiteJson(source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return {};
  }
  return isRecord(parsed) ? parsed : {};
}

/** The absolute path of one site's `content/_data/site.json`. */
export function siteDataPath(contentDir: string): string {
  return path.join(contentDir, ...SITE_DATA_FILE.split('/'));
}

export function settingsFromSiteJson(file: Record<string, unknown>): SiteSettings {
  return storedValues(SITE, file);
}

export function siteJsonFor(
  settings: SiteSettings,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const file = fileWith(SITE, settings, existing);
  for (const key of RETIRED_KEYS) delete file[key];
  return file;
}

/** The bytes of one settings object, as the file holds them. */
export function siteJsonText(settings: SiteSettings, existing: Record<string, unknown>): string {
  return `${JSON.stringify(siteJsonFor(settings, existing), null, 2)}\n`;
}

/**
 * Rewrite `content/_data/site.json` as these settings, keeping the keys they
 * do not model.
 *
 * {@link updateSiteSettings} for a caller whose new settings depend on the old
 * ones, which every screen's is: this is for the callers that have the whole
 * object already, a test's set-up among them.
 */
export async function writeSiteJson(options: {
  contentDir: string;
  settings: SiteSettings;
}): Promise<void> {
  await updateSiteSettings({ contentDir: options.contentDir, change: () => options.settings });
}

/**
 * Change the settings: re-read the file, apply the change, write it back, with
 * nothing able to write that file in between ({@link updateFileAtomically}).
 *
 * The re-read is what makes the file win the way it wins for a post
 * (decision-9). Two people with the settings screen open both save what they
 * see, and the second save is applied to what the first one actually wrote
 * rather than to what the second one had on screen — so a change to a field
 * the second person did not touch survives. The write is a temporary file and
 * a rename, so a reader — an Eleventy build, the site data source, another
 * process entirely — never sees a half-written file. Keys the settings do not
 * model, `feedSize` and anything a site added, are kept.
 */
export async function updateSiteSettings(options: {
  contentDir: string;
  change: (current: SiteSettings) => SiteSettings;
}): Promise<SiteSettings> {
  let written = DEFAULT_SITE_SETTINGS;

  await updateFileAtomically(siteDataPath(options.contentDir), (current) => {
    const existing = parseSiteJson(current ?? '');
    written = options.change(settingsFromSiteJson(existing));
    return siteJsonText(written, existing);
  });

  return written;
}
