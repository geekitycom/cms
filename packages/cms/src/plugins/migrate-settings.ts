/**
 * The move of plugin settings out of `content/_data/site.json` (decision-53
 * section 8). Every key of `plugins.<name>` except `enabled` goes to
 * `data/plugins/<name>/settings.json`, where the settings registry reads it.
 *
 * The plugin file is written first and wins over what `site.json` still
 * holds, so a run cut short between the two writes, or a second run, ends on
 * the same two files. It runs for every name under `plugins`, installed or
 * not, so a disabled or removed plugin's values are not lost.
 */

import path from 'node:path';

import { readFileIfPresentSync, writeFileAtomicallySync } from '../files/atomic.ts';
import { parseSiteJson, siteJsonPath } from '../site/namespace.ts';
import { isRecord } from '../util/guards.ts';
import { PLUGINS_KEY, pluginsOf } from './enabled.ts';
import { PACKAGE_NAME } from './registry.ts';
import { pluginFolderPath, SETTINGS_FILE } from './settings.ts';

export interface MigratePluginSettingsOptions {
  readonly contentDir: string;
  readonly dataDir: string;
  /** Told one line per plugin whose settings moved. */
  readonly log: (line: string) => void;
}

/** Move the settings and return the names of the plugins whose settings moved. */
export function migratePluginSettings({
  contentDir,
  dataDir,
  log,
}: MigratePluginSettingsOptions): string[] {
  const siteJson = siteJsonPath(contentDir);
  const moved = new Map<string, readonly string[]>();
  for (const [name, entry] of Object.entries(pluginsOf(readSiteJson(siteJson)))) {
    if (!PACKAGE_NAME.test(name) || !isRecord(entry)) continue;
    const { enabled: _enabled, ...rest } = entry;
    if (Object.keys(rest).length === 0) continue;
    const file = path.join(pluginFolderPath(dataDir, name), SETTINGS_FILE);
    const current = parseRecord(readFileIfPresentSync(file));
    writeFileAtomicallySync(file, `${JSON.stringify({ ...rest, ...current }, null, 2)}\n`);
    moved.set(name, Object.keys(rest));
  }
  if (moved.size === 0) return [];

  const file = readSiteJson(siteJson);
  const plugins = { ...pluginsOf(file) };
  for (const [name, keys] of moved) {
    const entry = plugins[name];
    if (!isRecord(entry)) continue;
    plugins[name] = Object.fromEntries(
      Object.entries(entry).filter(([key]) => !keys.includes(key)),
    );
  }
  file[PLUGINS_KEY] = plugins;
  writeFileAtomicallySync(siteJson, `${JSON.stringify(file, null, 2)}\n`);

  for (const name of moved.keys()) {
    log(
      `Moved the settings of ${name} from content/_data/site.json to data/plugins/${name}/${SETTINGS_FILE}.`,
    );
  }
  return [...moved.keys()];
}

function readSiteJson(file: string): Record<string, unknown> {
  return parseSiteJson(readFileIfPresentSync(file) ?? '');
}

function parseRecord(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
