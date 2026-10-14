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
  readonly log: (line: string) => void;
}

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
