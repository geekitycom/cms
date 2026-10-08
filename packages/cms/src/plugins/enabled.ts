/**
 * The enabled set: the `plugins` key of `content/_data/site.json`, an object
 * keyed by package name (decision-33). Each value is an object of its own, so
 * a plugin's public settings can sit beside `enabled` and survive a disable.
 */

import { parseSiteJson, readSiteJson, siteDataPath } from '../admin/settings.ts';
import { updateFileAtomically } from '../files/atomic.ts';

export const PLUGINS_KEY = 'plugins';

/** The names the site has enabled, read from the file now. */
export function readEnabledPlugins(contentDir: string): ReadonlySet<string> {
  const enabled = new Set<string>();
  for (const [name, entry] of Object.entries(pluginsOf(readSiteJson(contentDir)))) {
    if (isRecord(entry) && entry['enabled'] === true) enabled.add(name);
  }
  return enabled;
}

/** Write one plugin's `enabled`, keeping every other key in the file. */
export async function setPluginEnabled(options: {
  contentDir: string;
  name: string;
  enabled: boolean;
}): Promise<void> {
  const { contentDir, name, enabled } = options;
  await updatePluginEntry(contentDir, name, (entry) => ({ ...entry, enabled }));
}

/** One plugin's object under `plugins`, empty when it has none. */
export function readPluginEntry(contentDir: string, name: string): Record<string, unknown> {
  const entry = pluginsOf(readSiteJson(contentDir))[name];
  return isRecord(entry) ? entry : {};
}

/**
 * Rewrite one plugin's object under `plugins`, keeping every other key in the
 * file. The only writer of the `plugins` key: enabling and settings both go
 * through it.
 */
export async function updatePluginEntry(
  contentDir: string,
  name: string,
  change: (entry: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  await updateFileAtomically(siteDataPath(contentDir), (current) => {
    const file = parseSiteJson(current ?? '');
    const plugins = pluginsOf(file);
    const entry = plugins[name];
    file[PLUGINS_KEY] = { ...plugins, [name]: change(isRecord(entry) ? entry : {}) };
    return `${JSON.stringify(file, null, 2)}\n`;
  });
}

function pluginsOf(file: Record<string, unknown>): Record<string, unknown> {
  const plugins = file[PLUGINS_KEY];
  return isRecord(plugins) ? plugins : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
