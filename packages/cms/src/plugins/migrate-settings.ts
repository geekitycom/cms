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
  const site = readJsonRecord(siteJson);
  const plugins = { ...pluginsOf(site) };
  const moved: string[] = [];
  for (const [name, entry] of Object.entries(plugins)) {
    if (!PACKAGE_NAME.test(name) || !isRecord(entry)) continue;
    const { enabled, ...fromSiteJson } = entry;
    if (Object.keys(fromSiteJson).length === 0) continue;
    const file = path.join(pluginFolderPath(dataDir, name), SETTINGS_FILE);
    writeJson(file, pluginFileWins(fromSiteJson, readJsonRecord(file)));
    plugins[name] = enabled === undefined ? {} : { enabled };
    moved.push(name);
  }
  if (moved.length === 0) return [];
  writeJson(siteJson, { ...site, [PLUGINS_KEY]: plugins });

  for (const name of moved) {
    log(
      `Moved the settings of ${name} from content/_data/site.json to data/plugins/${name}/${SETTINGS_FILE}.`,
    );
  }
  return moved;
}

function pluginFileWins(
  fromSiteJson: Readonly<Record<string, unknown>>,
  fromPluginFile: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return { ...fromSiteJson, ...fromPluginFile };
}

function readJsonRecord(file: string): Record<string, unknown> {
  return parseSiteJson(readFileIfPresentSync(file) ?? '');
}

function writeJson(file: string, value: Readonly<Record<string, unknown>>): void {
  writeFileAtomicallySync(file, `${JSON.stringify(value, null, 2)}\n`);
}
