/**
 * The enabled set: the `plugins` key of `content/_data/site.json`, an object
 * keyed by package name (decision-33), each value an object holding
 * `enabled`. A plugin's settings are kept in its data folder (decision-53).
 */

import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { parseSiteJson, siteJsonPath } from '../site/namespace.ts';
import { isRecord } from '../util/guards.ts';

export const PLUGINS_KEY = 'plugins';

function siteJsonBypassingRegistry(contentDir: string): Record<string, unknown> {
  return parseSiteJson(readFileIfPresentSync(siteJsonPath(contentDir)) ?? '');
}

/** The names the site has enabled, read from the file now. */
export function readEnabledPlugins(contentDir: string): ReadonlySet<string> {
  const enabled = new Set<string>();
  for (const [name, entry] of Object.entries(pluginsOf(siteJsonBypassingRegistry(contentDir)))) {
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
  await updatePluginEntry(contentDir, name, enabled);
}

/** Write one plugin's `enabled` under `plugins`, keeping every other key in the file. */
async function updatePluginEntry(
  contentDir: string,
  name: string,
  enabled: boolean,
): Promise<void> {
  await updateFileAtomically(siteJsonPath(contentDir), (current) => {
    const file = parseSiteJson(current ?? '');
    const plugins = pluginsOf(file);
    const entry = plugins[name];
    file[PLUGINS_KEY] = { ...plugins, [name]: { ...(isRecord(entry) ? entry : {}), enabled } };
    return `${JSON.stringify(file, null, 2)}\n`;
  });
}

export function pluginsOf(file: Record<string, unknown>): Record<string, unknown> {
  const plugins = file[PLUGINS_KEY];
  return isRecord(plugins) ? plugins : {};
}
