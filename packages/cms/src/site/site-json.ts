import path from 'node:path';

import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { isRecord } from '../util/guards.ts';
import { SITE_DATA_FILE } from '../web/context.ts';
import { ROWS, SETTING_KEYS } from './setting-rows.ts';
import { DEFAULT_SITE_SETTINGS } from './settings.ts';
import type { SiteSettings } from './settings.ts';

const RETIRED_KEYS = ['navigation', 'soloAuthor'] as const;

/**
 * A site's settings, as its `content/_data/site.json` says them right now.
 *
 * Read on every request that needs one rather than cached, which is what a
 * source of truth being a file is worth: a hand edit shows on the public site,
 * on the settings screen and in the actor document without a restart and
 * without anything being told. The file is a few hundred bytes, so the read
 * costs less than the parse of the template that is about to use it.
 *
 * A file that is missing, or one that will not parse, is the defaults rather
 * than an error: a typo in `site.json` should leave a site up and answerable,
 * with the settings screen there to put it right.
 */
export function readSiteSettings(contentDir: string): SiteSettings {
  return settingsFromSiteJson(readSiteJson(contentDir));
}

export function readSiteJson(contentDir: string): Record<string, unknown> {
  return parseSiteJson(readFileIfPresentSync(siteDataPath(contentDir)) ?? '');
}

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

function readSetting<K extends keyof SiteSettings>(
  settings: SiteSettings,
  key: K,
  file: Readonly<Record<string, unknown>>,
): void {
  const value = ROWS[key].read(file);
  if (value !== undefined) settings[key] = value;
}

/**
 * `content/_data/site.json` as the settings it names, defaults filled in.
 *
 * Read tolerantly, key by key: a key of the wrong type, or one a site has
 * never written, falls back to the default rather than taking the site down.
 */
export function settingsFromSiteJson(file: Record<string, unknown>): SiteSettings {
  const settings = { ...DEFAULT_SITE_SETTINGS };
  for (const key of SETTING_KEYS) readSetting(settings, key, file);
  return settings;
}

/**
 * `content/_data/site.json` as it should read for these settings.
 *
 * Every key the settings model is written whether or not it has a value, so
 * the file's shape is stable and an Eleventy template may reference
 * `site.tagline` without guarding it, bar the few whose row writes nothing for
 * a site that has made no choice. Every other key the file already had is
 * kept: a site may put anything in there and reach it from its templates, and
 * the settings form is not going to be the thing that throws it away.
 */
export function siteJsonFor(
  settings: SiteSettings,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const file: Record<string, unknown> = { ...existing };
  for (const key of SETTING_KEYS) ROWS[key].write(file, settings);
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
