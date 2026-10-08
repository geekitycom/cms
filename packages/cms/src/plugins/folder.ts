/**
 * The plugins folder (decision-33): one folder per plugin, `<name>/` or
 * `@scope/<name>/`, each with a bundled `index.js` whose default export is
 * the plugin. `geekity serve` imports them at boot. The Plugins screen
 * compares the folder with what the running worker loaded and offers Reload
 * when they differ (TASK-288).
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Plugin } from '../plugin.ts';
import type { InstalledPlugin } from './registry.ts';

export const PLUGIN_ENTRY = 'index.js';

/** One plugin's folder as it stood when it was scanned. */
export interface PluginFolder {
  /** Its package name: the folder's path under the plugins folder. */
  readonly name: string;
  readonly directory: string;
  /** A hash of every file in it, so a replaced bundle reads as changed. */
  readonly fingerprint: string;
}

export interface PluginFolderChanges {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly updated: readonly string[];
}

/** Every plugin folder, by name. A missing folder, or none named, holds none. */
export function scanPluginFolders(pluginsDir: string | undefined): PluginFolder[] {
  if (pluginsDir === undefined) return [];
  const folders: PluginFolder[] = [];
  for (const entry of subdirectories(pluginsDir)) {
    if (!entry.startsWith('@')) {
      folders.push(folder(pluginsDir, entry));
      continue;
    }
    for (const scoped of subdirectories(path.join(pluginsDir, entry))) {
      folders.push(folder(pluginsDir, `${entry}/${scoped}`));
    }
  }
  return folders.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** What changed between two scans, or `undefined` when nothing did. */
export function pluginFolderChanges(
  loaded: readonly PluginFolder[],
  current: readonly PluginFolder[],
): PluginFolderChanges | undefined {
  const before = new Map(loaded.map((entry) => [entry.name, entry.fingerprint]));
  const now = new Map(current.map((entry) => [entry.name, entry.fingerprint]));
  const added = current.filter((entry) => !before.has(entry.name)).map((entry) => entry.name);
  const removed = loaded.filter((entry) => !now.has(entry.name)).map((entry) => entry.name);
  const updated = current
    .filter((entry) => before.has(entry.name) && before.get(entry.name) !== entry.fingerprint)
    .map((entry) => entry.name);
  return added.length + removed.length + updated.length === 0
    ? undefined
    : { added, removed, updated };
}

/** Import each folder's bundle. A folder that exports no plugin refuses the boot, naming it. */
export async function importPluginFolders(
  folders: readonly PluginFolder[],
): Promise<InstalledPlugin[]> {
  const installed: InstalledPlugin[] = [];
  for (const { name, directory } of folders) {
    const entry = path.join(directory, PLUGIN_ENTRY);
    const module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
    if (!isPlugin(module.default)) {
      throw new Error(`${entry} does not export a plugin as its default export.`);
    }
    installed.push({ plugin: module.default, source: `the plugins folder, ${name}` });
  }
  return installed;
}

function folder(pluginsDir: string, name: string): PluginFolder {
  const directory = path.join(pluginsDir, ...name.split('/'));
  const hash = createHash('sha256');
  for (const file of filesUnder(directory)) {
    hash.update(path.relative(directory, file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return { name, directory, fingerprint: hash.digest('hex') };
}

/** Visible subdirectories: a folder being written beside the live one starts with a dot. */
function subdirectories(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

function isPlugin(value: unknown): value is Plugin {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { register?: unknown }).register === 'function'
  );
}
