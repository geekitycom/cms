/**
 * The plugins folder (decision-33): one folder per plugin, `<name>/` or
 * `@scope/<name>/`, each with a bundled `index.js` whose default export is
 * the plugin, and the `plugin.json` manifest the bundle build writes beside
 * it. `geekity serve` imports them at boot. The Plugins screen
 * compares the folder with what the running worker loaded and offers Reload
 * when they differ (TASK-288).
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { HOST_API_VERSION } from '../plugin.ts';
import type { Plugin } from '../plugin.ts';
import type { InstalledPlugin } from './registry.ts';

export const PLUGIN_ENTRY = 'index.js';
export const PLUGIN_MANIFEST = 'plugin.json';

/**
 * `plugin.json`: what the bundle build writes from the package's
 * `package.json`, so a folder install can be checked without npm.
 */
export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly hostApi: number;
  /** The ranges of `@geekity/cms` and of each plugin package it requires. */
  readonly peerDependencies: Readonly<Record<string, string>>;
}

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

/**
 * Import each folder's bundle. A folder that cannot be loaded comes back as
 * an unavailable plugin, named by its folder, so the site still boots.
 */
export async function importPluginFolders(
  folders: readonly PluginFolder[],
): Promise<InstalledPlugin[]> {
  const installed: InstalledPlugin[] = [];
  for (const { name, directory } of folders) {
    const source = `the plugins folder, ${name}`;
    let manifest: PluginManifest | undefined;
    try {
      manifest = readPluginManifest(directory);
    } catch (error) {
      installed.push({ plugin: placeholder(name), source, problem: messageOf(error) });
      continue;
    }
    const loaded = await importBundle(directory);
    installed.push(
      typeof loaded === 'string'
        ? { plugin: placeholder(name, manifest?.version), source, problem: loaded }
        : { plugin: loaded, source, peerDependencies: manifest?.peerDependencies },
    );
  }
  return installed;
}

/**
 * The folder's `plugin.json`, or `undefined` when it has none, as a folder
 * copied by hand may not. Throws when the file is there but unusable.
 */
export function readPluginManifest(directory: string): PluginManifest | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(directory, PLUGIN_MANIFEST), 'utf8');
  } catch {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Its ${PLUGIN_MANIFEST} is not JSON.`);
  }
  const manifest = value as Partial<Record<keyof PluginManifest, unknown>> | null;
  const peers = manifest?.peerDependencies;
  if (
    typeof manifest?.name !== 'string' ||
    typeof manifest.version !== 'string' ||
    !Number.isInteger(manifest.hostApi) ||
    typeof peers !== 'object' ||
    peers === null ||
    !Object.values(peers).every((range) => typeof range === 'string')
  ) {
    throw new Error(
      `Its ${PLUGIN_MANIFEST} needs a name, a version, a hostApi number and peerDependencies.`,
    );
  }
  return manifest as PluginManifest;
}

/** The bundle's plugin, or why it could not be loaded. */
async function importBundle(directory: string): Promise<Plugin | string> {
  const entry = path.join(directory, PLUGIN_ENTRY);
  if (!existsSync(entry)) return `It has no ${PLUGIN_ENTRY}.`;
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
  } catch (error) {
    return `Its ${PLUGIN_ENTRY} failed to load: ${messageOf(error)}`;
  }
  return isPlugin(module.default)
    ? module.default
    : `Its ${PLUGIN_ENTRY} does not export a plugin as its default export.`;
}

/** What the Plugins screen shows of a plugin it could not load. */
function placeholder(name: string, version = ''): Plugin {
  return {
    name,
    version,
    label: name,
    description: '',
    hostApi: HOST_API_VERSION,
    register() {},
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
