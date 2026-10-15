import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { chmod, mkdir, readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import semver from 'semver';

import {
  CONTENT_SCRATCH_FILES,
  CORE_DATA_FILES,
  EXPORTS,
  IMPORT_ASIDE,
  IMPORT_MARKER,
  IMPORT_STAGING,
  LOST_AND_FOUND,
  OTHER_ENTRY_KINDS,
  classifyEntries,
  dataFileFor,
  dataFileMatches,
  dataFolder,
  dataPath,
} from '../files/data-files.ts';
import type { DataFileDeclaration } from '../files/data-files.ts';
import { readTarStream } from '../files/tar.ts';
import type { TarStreamEntry } from '../files/tar.ts';
import { pluginFolderOf, unloadedPluginFolder } from '../plugins/data.ts';
import { readEnabledPlugins, setPluginEnabled } from '../plugins/enabled.ts';
import { addPlugin, CORE_PACKAGE, parsePackageSpec } from '../plugins/install.ts';
import { PACKAGE_NAME } from '../plugins/registry.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { messageOf } from '../util/errors.ts';
import { isNotFound } from '../util/files.ts';
import { isRecord } from '../util/guards.ts';
import { EXPORT_FORMAT, MANIFEST_NAME } from './site-export.ts';
import type {
  ExportManifest,
  ManifestFile,
  ManifestOverride,
  ManifestPlugin,
} from './site-export.ts';

/**
 * Nothing is made, renamed or removed beside a target, and the target itself
 * is never renamed or removed, because on Docker each one is a mount point.
 * Every move stays inside one target, so on one filesystem.
 */

export interface ImportTargets {
  readonly contentDir: string;
  readonly dataDir: string;
}

export interface ArchivedManifest {
  readonly manifest: ExportManifest;
  readonly marker: string;
}

export type TargetState = 'empty' | 'occupied' | 'unfinished';

export interface ImportTarget {
  readonly dir: string;
  readonly state: TargetState;
}

export interface StagedImport {
  readonly archived: ArchivedManifest;
  readonly targets: ImportTargets;
  readonly content: string | undefined;
  readonly data: string;
  readonly states: readonly ImportTarget[];
  readonly skipped: readonly { readonly path: string; readonly why: string }[];
  readonly created: readonly string[];
}

const MANIFEST_LIMIT = 64 * 1024 * 1024;

const SHA256 = /^[0-9a-f]{64}$/;

const PRIVATE_FOLDER_MODE = 0o700;

function stagingDir(dir: string): string {
  return dataFolder(dir, IMPORT_STAGING);
}

function markerFile(dir: string): string {
  return dataPath(dir, IMPORT_MARKER);
}

function leftInPlace(name: string): boolean {
  return (
    name === LOST_AND_FOUND ||
    [IMPORT_MARKER, IMPORT_STAGING, IMPORT_ASIDE].some((declaration) =>
      dataFileMatches(declaration, name),
    )
  );
}

function notAnExport(why: string): Error {
  return new Error(`This is not a site export geekity can import: ${why}`);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw notAnExport(`its manifest has no ${key}.`);
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw notAnExport(`its manifest has no ${key}.`);
  return value;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key] ?? [];
  if (!Array.isArray(value)) throw notAnExport(`its manifest's ${key} is not a list.`);
  return value;
}

function readCount(record: unknown, key: string): number {
  const value = isRecord(record) ? record[key] : undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
}

function parseFile(value: unknown): ManifestFile {
  if (!isRecord(value)) throw notAnExport('its manifest lists a file that is not a record.');
  const filePath = readString(value, 'path');
  const kind = value['class'];
  const size = value['size'];
  const sha256 = readString(value, 'sha256');
  if (kind !== 'kept' && kind !== 'credential') {
    throw notAnExport(`its manifest gives ${filePath} the class ${JSON.stringify(kind)}.`);
  }
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || !SHA256.test(sha256)) {
    throw notAnExport(`its manifest gives ${filePath} no usable size and sha256.`);
  }
  return { path: filePath, class: kind, size, sha256 };
}

function parsePlugin(value: unknown): ManifestPlugin {
  if (!isRecord(value)) throw notAnExport('its manifest lists a plugin that is not a record.');
  const name = readString(value, 'name');
  const version = readString(value, 'version');
  const source = value['source'];
  if (!PACKAGE_NAME.test(name) || semver.valid(version) === null) {
    throw notAnExport(`its manifest lists the plugin ${JSON.stringify(`${name}@${version}`)}.`);
  }
  if (source !== 'folder' && source !== 'config') {
    throw notAnExport(`its manifest gives ${name} the source ${JSON.stringify(source)}.`);
  }
  return { name, version, source, enabled: readBoolean(value, 'enabled') };
}

function parseOverride(value: unknown): ManifestOverride {
  if (!isRecord(value)) throw notAnExport('its manifest lists an override that is not a record.');
  return { setting: readString(value, 'setting'), source: readString(value, 'source') };
}

export function parseManifest(text: string): ExportManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw notAnExport('its manifest.json is not JSON.');
  }
  if (!isRecord(parsed)) throw notAnExport('its manifest.json is not a record.');
  const format = parsed['format'];
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
    throw notAnExport('its manifest has no format.');
  }
  if (format > EXPORT_FORMAT) {
    throw new Error(
      `This archive is format ${String(format)}, and this version of geekity reads format ${String(EXPORT_FORMAT)}. Upgrade @geekity/cms and import it again.`,
    );
  }
  const baseUrl = readString(parsed, 'baseUrl');
  try {
    new URL(baseUrl);
  } catch {
    throw notAnExport('its manifest has no base URL.');
  }
  const pending = parsed['pending'];
  const jobs = isRecord(pending) ? pending['jobs'] : undefined;
  return {
    format: EXPORT_FORMAT,
    cms: readString(parsed, 'cms'),
    exportedAt: readString(parsed, 'exportedAt'),
    baseUrl,
    content: readBoolean(parsed, 'content'),
    credentials: readBoolean(parsed, 'credentials'),
    devMode: readBoolean(parsed, 'devMode'),
    files: readArray(parsed, 'files').map(parseFile),
    undeclared: readArray(parsed, 'undeclared').filter((each) => typeof each === 'string'),
    notCarried: readArray(parsed, 'notCarried').flatMap((each) => {
      if (!isRecord(each) || typeof each['path'] !== 'string') return [];
      const why = OTHER_ENTRY_KINDS.find((kind) => kind === each['why']);
      return why === undefined ? [] : [{ path: each['path'], why }];
    }),
    credentialsLeftOut: readArray(parsed, 'credentialsLeftOut').filter(
      (each) => typeof each === 'string',
    ),
    plugins: readArray(parsed, 'plugins').map(parsePlugin),
    overrides: readArray(parsed, 'overrides').map(parseOverride),
    pending: {
      deliveries: readCount(pending, 'deliveries'),
      jobs: { queued: readCount(jobs, 'queued'), running: readCount(jobs, 'running') },
    },
  };
}

async function readBody(entry: TarStreamEntry, limit: number): Promise<Buffer> {
  if (entry.size > limit) throw notAnExport(`${entry.name} is too large.`);
  const pieces: Buffer[] = [];
  for await (const piece of entry.body) pieces.push(Buffer.from(piece));
  return Buffer.concat(pieces);
}

async function manifestOf(entry: TarStreamEntry | undefined): Promise<ArchivedManifest> {
  if (entry?.type !== 'file' || entry.name !== MANIFEST_NAME) {
    throw notAnExport(`its first entry is not ${MANIFEST_NAME}.`);
  }
  const bytes = await readBody(entry, MANIFEST_LIMIT);
  return {
    manifest: parseManifest(bytes.toString('utf8')),
    marker: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function readSiteManifest(archive: string): Promise<ArchivedManifest> {
  for await (const entry of readTarStream(createReadStream(archive))) {
    return await manifestOf(entry);
  }
  return await manifestOf(undefined);
}

/**
 * A plugin's own declarations exist only once it is installed, which is after
 * its data is in place; the export classed those files with the same plugin
 * version's declarations.
 */
export function importDeclarations(
  archived: ArchivedManifest,
  settings: SettingsRegistry,
): DataFileDeclaration[] {
  const folders = new Set<string>();
  for (const file of archived.manifest.files) {
    const relative = dataRelative(file.path);
    const folder = relative === undefined ? undefined : pluginFolderOf(relative);
    if (folder !== undefined) folders.add(folder);
  }
  return [
    ...CORE_DATA_FILES,
    ...settings.dataFiles(),
    ...[...folders].sort().flatMap(unloadedPluginFolder),
  ];
}

function dataRelative(archived: string): string | undefined {
  return archived.startsWith('data/') ? archived.slice('data/'.length) : undefined;
}

function scratchFolder(declarations: readonly DataFileDeclaration[], name: string): boolean {
  return declarations.some(
    (declaration) =>
      declaration.dataClass.kind === 'scratch' &&
      declaration.pattern.endsWith('/**') &&
      dataFileMatches(declaration, name),
  );
}

function targetState(
  dir: string,
  declarations: readonly DataFileDeclaration[],
  marker: string,
): TargetState {
  try {
    if (readFileSync(markerFile(dir), 'utf8') === marker) return 'unfinished';
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const { files, others } = classifyEntries(dir, declarations);
  const strayFolder = topFolders(dir).some(
    (name) => name !== LOST_AND_FOUND && !scratchFolder(declarations, name),
  );
  return strayFolder ||
    [...files, ...others].some((entry) => entry.declaration?.dataClass.kind !== 'scratch')
    ? 'occupied'
    : 'empty';
}

function topFolders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

export function checkImportTargets(
  archived: ArchivedManifest,
  targets: ImportTargets,
  settings: SettingsRegistry,
): ImportTarget[] {
  const found: ImportTarget[] = [];
  if (archived.manifest.content) {
    found.push({
      dir: targets.contentDir,
      state: targetState(targets.contentDir, CONTENT_SCRATCH_FILES, archived.marker),
    });
  }
  found.push({
    dir: targets.dataDir,
    state: targetState(targets.dataDir, importDeclarations(archived, settings), archived.marker),
  });
  return found;
}

function placeOf(name: string): { readonly root: 'content' | 'data'; readonly relative: string } {
  const segments = name.split('/');
  const [root, ...rest] = segments;
  const refuse = (): never => {
    throw notAnExport(
      `it holds ${JSON.stringify(name)}, and an export holds only files under content/ and data/.`,
    );
  };
  if (name.includes('\\') || name.includes('\0')) refuse();
  if (root !== 'content' && root !== 'data') return refuse();
  if (rest.length === 0) refuse();
  if (rest.some((segment) => segment === '' || segment === '.' || segment === '..')) refuse();
  if (leftInPlace(rest[0] ?? '')) refuse();
  return { root, relative: rest.join('/') };
}

async function writeEntry(
  entry: TarStreamEntry,
  target: { readonly file: string; readonly dirMode: number | undefined } | undefined,
): Promise<{ readonly sha256: string }> {
  const hash = createHash('sha256');
  const hashed = async function* () {
    for await (const piece of entry.body) {
      hash.update(piece);
      yield piece;
    }
  };
  if (target === undefined) {
    for await (const piece of hashed()) void piece;
  } else {
    const mode = entry.mode & 0o777;
    await mkdir(path.dirname(target.file), { recursive: true, mode: target.dirMode });
    await pipeline(hashed(), createWriteStream(target.file, { mode, flags: 'wx' }));
    await chmod(target.file, mode);
    await utimes(target.file, entry.mtime, entry.mtime);
  }
  return { sha256: hash.digest('hex') };
}

function skipReason(
  declarations: readonly DataFileDeclaration[],
  relative: string,
): string | undefined {
  const kind = dataFileFor(declarations, relative)?.dataClass.kind;
  switch (kind) {
    case 'kept':
    case 'credential':
      return undefined;
    case undefined:
      return 'nothing on this site declares it';
    case 'rebuildable':
    case 'pending':
    case 'scratch':
      return `this site holds it as ${kind}, and does not import it`;
    default:
      return kind satisfies never;
  }
}

async function unpack(
  archive: string,
  archived: ArchivedManifest,
  roots: { readonly content: string | undefined; readonly data: string },
  declarations: readonly DataFileDeclaration[],
): Promise<StagedImport['skipped']> {
  const expected = new Map<string, ManifestFile>();
  for (const file of archived.manifest.files) {
    if (expected.has(file.path)) throw notAnExport(`its manifest lists ${file.path} twice.`);
    expected.set(file.path, file);
  }
  const skipped: { path: string; why: string }[] = [];
  const seen = new Set<string>();
  let first = true;
  for await (const entry of readTarStream(createReadStream(archive))) {
    if (first) {
      first = false;
      if ((await manifestOf(entry)).marker !== archived.marker) {
        throw new Error(`${archive} changed while it was imported. Import it again.`);
      }
      continue;
    }
    if (entry.type !== 'file') {
      throw notAnExport(
        `${JSON.stringify(entry.name)} is a ${entry.type === 'other' ? 'device or other special entry' : entry.type}, and an export holds only files.`,
      );
    }
    const { root, relative } = placeOf(entry.name);
    const listed = expected.get(entry.name);
    if (listed === undefined || seen.has(entry.name)) {
      throw notAnExport(`it holds ${entry.name}, which its manifest does not list once.`);
    }
    seen.add(entry.name);
    const why = root === 'data' ? skipReason(declarations, relative) : undefined;
    if (why !== undefined) skipped.push({ path: entry.name, why });
    if (entry.size !== listed.size) {
      throw new Error(
        `${entry.name} is ${String(entry.size)} bytes, and the manifest gives ${String(listed.size)}. The archive is damaged or was changed; nothing was imported.`,
      );
    }
    const base = root === 'content' ? roots.content : roots.data;
    if (base === undefined)
      throw notAnExport(`it holds ${entry.name}, and says it has no content.`);
    const written = await writeEntry(
      entry,
      why === undefined
        ? {
            file: path.join(base, ...relative.split('/')),
            dirMode: root === 'data' ? PRIVATE_FOLDER_MODE : undefined,
          }
        : undefined,
    );
    if (written.sha256 !== listed.sha256) {
      throw new Error(
        `${entry.name} does not match the sha256 its manifest gives. The archive is damaged or was changed; nothing was imported.`,
      );
    }
  }
  const missing = [...expected.keys()].filter((name) => !seen.has(name));
  if (missing.length > 0) {
    throw notAnExport(`it is missing ${missing.join(', ')}, which its manifest lists.`);
  }
  return skipped;
}

export async function discardStaging({
  targets,
  created,
}: Pick<StagedImport, 'targets' | 'created'>): Promise<void> {
  await rm(stagingDir(targets.contentDir), { recursive: true, force: true });
  await rm(stagingDir(targets.dataDir), { recursive: true, force: true });
  for (const dir of created) await rm(dir, { recursive: true, force: true });
}

export async function stageSiteImport(options: {
  readonly archive: string;
  readonly archived: ArchivedManifest;
  readonly targets: ImportTargets;
  readonly settings: SettingsRegistry;
}): Promise<StagedImport> {
  const { archive, archived, targets, settings } = options;
  await discardStaging({ targets, created: [] });
  const content = archived.manifest.content ? stagingDir(targets.contentDir) : undefined;
  const data = stagingDir(targets.dataDir);
  const created: string[] = [];
  try {
    for (const dir of [content, data]) {
      if (dir === undefined) continue;
      const made = await mkdir(dir, { recursive: true });
      if (made !== undefined && made !== dir) created.push(made);
    }
    const skipped = await unpack(
      archive,
      archived,
      { content, data },
      importDeclarations(archived, settings),
    );
    const states = checkImportTargets(archived, targets, settings);
    return { archived, targets, content, data, states, skipped, created };
  } catch (error) {
    await discardStaging({ targets, created });
    throw error;
  }
}

async function startAside(dir: string, stamp: string, marker: string): Promise<string> {
  let aside = dataFolder(dir, IMPORT_ASIDE, `.geekity-before-import-${stamp}`);
  for (let n = 2; existsSync(aside); n += 1) {
    aside = dataFolder(dir, IMPORT_ASIDE, `.geekity-before-import-${stamp}-${String(n)}`);
  }
  await mkdir(aside, { mode: PRIVATE_FOLDER_MODE });
  await writeFile(markerFile(aside), marker, { mode: 0o600 });
  return aside;
}

async function asideInProgress(dir: string, marker: string): Promise<string | undefined> {
  for (const name of await readdir(dir)) {
    if (!dataFileMatches(IMPORT_ASIDE, name)) continue;
    const aside = dataFolder(dir, IMPORT_ASIDE, name);
    const held = await readFile(markerFile(aside), 'utf8').catch((error: unknown) => {
      if (isNotFound(error)) return undefined;
      throw error;
    });
    if (held === marker) return aside;
  }
  return undefined;
}

export async function placeSiteImport(
  staged: StagedImport,
  options: {
    readonly stamp: string;
    readonly rename?: (from: string, to: string) => Promise<void>;
  },
): Promise<string[]> {
  const move = options.rename ?? rename;
  const { marker } = staged.archived;
  const moved: string[] = [];
  for (const { dir, state } of staged.states) {
    const from = dir === staged.targets.contentDir ? staged.content : staged.data;
    if (from === undefined) continue;
    const aside =
      (await asideInProgress(dir, marker)) ??
      (state === 'occupied' ? await startAside(dir, options.stamp, marker) : undefined);
    if (aside !== undefined) {
      const kept = dir === staged.targets.dataDir ? [EXPORTS] : [];
      for (const name of await readdir(dir)) {
        if (leftInPlace(name) || kept.some((declaration) => dataFileMatches(declaration, name))) {
          continue;
        }
        await move(path.join(dir, name), path.join(aside, name));
      }
      await rm(markerFile(aside));
      moved.push(aside);
    }
    await writeFile(markerFile(dir), marker, { mode: 0o600 });
    for (const name of await readdir(from)) {
      await rm(path.join(dir, name), { recursive: true, force: true });
      await move(path.join(from, name), path.join(dir, name));
    }
    await rm(from, { recursive: true, force: true });
  }
  return moved;
}

export async function finishSiteImport(targets: ImportTargets): Promise<void> {
  await rm(markerFile(targets.contentDir), { force: true });
  await rm(markerFile(targets.dataDir), { force: true });
}

export type PluginFailure =
  | {
      readonly kind: 'not-installed';
      readonly name: string;
      readonly version: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'needs-newer-core';
      readonly name: string;
      readonly version: string;
      readonly needs: string;
      readonly core: string;
    };

export function pluginFailureLine(failure: PluginFailure): string {
  const { name, version } = failure;
  switch (failure.kind) {
    case 'not-installed':
      return `${name} ${version} was not installed: ${failure.reason} Its enabled state is kept. Retry with: geekity plugin add ${name}@${version}`;
    case 'needs-newer-core':
      return `${name} ${version} is installed but will not run until ${CORE_PACKAGE} is upgraded: it needs ${CORE_PACKAGE} ${failure.needs}, and this core is ${failure.core}. Its enabled state is kept.`;
  }
}

export async function installArchivedPlugins(
  manifest: ExportManifest,
  options: {
    readonly pluginsDir: string | undefined;
    readonly registry: string;
    readonly coreVersion: string;
  },
): Promise<PluginFailure[]> {
  const failures: PluginFailure[] = [];
  for (const { name, version, source } of manifest.plugins) {
    if (source !== 'folder') continue;
    const notInstalled = (reason: string) =>
      failures.push({ kind: 'not-installed', name, version, reason });
    if (options.pluginsDir === undefined) {
      notInstalled(
        'No plugins folder is set: set GEEKITY_PLUGINS_DIR, or pluginsDir in the config.',
      );
      continue;
    }
    try {
      const { manifest: installed } = await addPlugin(parsePackageSpec(`${name}@${version}`), {
        pluginsDir: options.pluginsDir,
        registry: options.registry,
      });
      const needs = installed.peerDependencies[CORE_PACKAGE];
      if (needs !== undefined && !semver.satisfies(options.coreVersion, needs)) {
        failures.push({
          kind: 'needs-newer-core',
          name,
          version,
          needs,
          core: options.coreVersion,
        });
      }
    } catch (error) {
      notInstalled(messageOf(error));
    }
  }
  return failures;
}

export async function restoreEnabledPlugins(
  manifest: ExportManifest,
  contentDir: string,
): Promise<void> {
  const enabled = readEnabledPlugins(contentDir);
  for (const plugin of manifest.plugins) {
    if (enabled.has(plugin.name) === plugin.enabled) continue;
    await setPluginEnabled({ contentDir, name: plugin.name, enabled: plugin.enabled });
  }
}

export function importNotes(manifest: ExportManifest): string[] {
  const notes: string[] = [];
  for (const override of manifest.overrides) {
    notes.push(
      `Set ${override.setting} again on this host. The old site set it with ${override.source}.`,
    );
  }
  if (manifest.credentialsLeftOut.length > 0) {
    notes.push(
      `Type these credentials in again, which the export left out: ${manifest.credentialsLeftOut.join(', ')}.`,
    );
  }
  for (const plugin of manifest.plugins) {
    if (plugin.source !== 'config') continue;
    notes.push(
      `Check that this host's config has ${plugin.name} ${plugin.version}. It came from the old site's config and was not installed.`,
    );
  }
  notes.push('Everyone signs in again: sessions are not exported.');
  return notes;
}
