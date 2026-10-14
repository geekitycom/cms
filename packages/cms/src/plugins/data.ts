import { readdirSync } from 'node:fs';
import path from 'node:path';

import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { CORE_DATA_FILES, dataPath, declareDataFile } from '../files/data-files.ts';
import type { DataClass, DataFileDeclaration } from '../files/data-files.ts';
import type { Plugin, PluginDataClass, PluginDataFolder } from '../plugin.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import type { PluginRegistry } from './registry.ts';
import { pluginsFolderPath, SECRETS_FILE, SETTINGS_FILE } from './settings.ts';

const DATA_FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

const PLUGIN_CLASSES: Readonly<Record<PluginDataClass, { dataClass: DataClass; lost: string }>> = {
  kept: {
    dataClass: { kind: 'kept' },
    lost: 'What the plugin keeps in it, which nothing else holds.',
  },
  rebuildable: {
    dataClass: { kind: 'rebuildable' },
    lost: 'Nothing the plugin cannot make or fetch again.',
  },
  credential: {
    dataClass: { kind: 'credential' },
    lost: 'A credential, typed in again from the service it came from.',
  },
};

const PLUGIN_CLASS_NAMES = 'kept, rebuildable or credential';

type DeclaringPlugin = Pick<Plugin, 'name' | 'data'>;

function declarePluginFile(plugin: DeclaringPlugin, file: string, kind: unknown) {
  const quoted = JSON.stringify(file);
  if (!DATA_FILE_NAME.test(file)) {
    throw new Error(
      `Its data declares ${quoted}, which is not a file name a plugin can use in its folder.`,
    );
  }
  if (file === SETTINGS_FILE || file === SECRETS_FILE) {
    throw new Error(`Its data declares ${quoted}, which holds its settings.`);
  }
  if (typeof kind !== 'string' || !Object.hasOwn(PLUGIN_CLASSES, kind)) {
    throw new Error(
      `Its data declares ${quoted} as ${JSON.stringify(kind)}, and a plugin's file is ${PLUGIN_CLASS_NAMES}.`,
    );
  }
  const { dataClass, lost } = PLUGIN_CLASSES[kind as PluginDataClass];
  return declareDataFile({
    pattern: path.posix.join('plugins', plugin.name, file),
    dataClass,
    lost: `${plugin.name}: ${lost}`,
  });
}

export function pluginDataFiles(plugin: DeclaringPlugin): DataFileDeclaration[] {
  return Object.entries(plugin.data ?? {}).map(([file, kind]) =>
    declarePluginFile(plugin, file, kind),
  );
}

/** `data/plugins/<package name>/`, holding only the files the plugin's `data` declares. */
export function pluginDataFolder(dataDir: string, plugin: DeclaringPlugin): PluginDataFolder {
  const declared = new Map(
    Object.entries(plugin.data ?? {}).map(([file, kind]) => [
      file,
      declarePluginFile(plugin, file, kind),
    ]),
  );

  function declarationOf(file: string): DataFileDeclaration {
    const declaration = declared.get(file);
    if (declaration === undefined) {
      throw new Error(
        `${plugin.name} uses ${JSON.stringify(file)} in its folder, which its definition does not declare. Add the file to the plugin's \`data\` field with its class: ${PLUGIN_CLASS_NAMES}.`,
      );
    }
    return declaration;
  }

  return {
    read: (file) => readFileIfPresentSync(dataPath(dataDir, declarationOf(file))),
    async update(file, change) {
      const declaration = declarationOf(file);
      await updateFileAtomically(
        dataPath(dataDir, declaration),
        change,
        declaration.dataClass.kind === 'credential' ? { mode: 0o600 } : {},
      );
    },
  };
}

function pluginFolders(dataDir: string): string[] {
  const directoriesIn = (folder: string): string[] => {
    try {
      return readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  };
  const root = pluginsFolderPath(dataDir);
  return directoriesIn(root).flatMap((name) =>
    name.startsWith('@')
      ? directoriesIn(path.join(root, name)).map((inner) => `${name}/${inner}`)
      : [name],
  );
}

export function pluginFolderOf(relative: string): string | undefined {
  const [first, second, third, fourth] = relative.split('/');
  if (first !== 'plugins' || second === undefined || third === undefined) return undefined;
  if (!second.startsWith('@')) return second;
  return fourth === undefined ? undefined : `${second}/${third}`;
}

export function unloadedPluginFolder(name: string): DataFileDeclaration[] {
  return [
    declareDataFile({
      pattern: path.posix.join('plugins', name, SECRETS_FILE),
      dataClass: { kind: 'credential' },
      lost: `${name}: the API keys of a plugin that is not loaded.`,
    }),
    declareDataFile({
      pattern: path.posix.join('plugins', name, '**'),
      dataClass: { kind: 'kept' },
      lost: `${name}: the files of a plugin that is not loaded, kept so it can be added again.`,
    }),
  ];
}

export interface SiteDataFilesOptions {
  readonly dataDir: string;
  readonly settings: SettingsRegistry;
  readonly plugins: PluginRegistry;
}

export function siteDataFiles({
  dataDir,
  settings,
  plugins,
}: SiteDataFilesOptions): DataFileDeclaration[] {
  const loaded = plugins.plugins.filter((entry) => entry.loaded);
  const loadedNames = new Set(loaded.map((entry) => entry.plugin.name));
  return [
    ...CORE_DATA_FILES,
    ...settings.dataFiles(),
    ...loaded.flatMap((entry) => entry.dataFiles),
    ...pluginFolders(dataDir)
      .filter((name) => !loadedNames.has(name))
      .flatMap(unloadedPluginFolder),
  ];
}
