/**
 * `geekity plugin add` and `geekity plugin remove` (decision-33): a plugin
 * package's bundle, fetched from the npm registry and unpacked into the
 * plugins folder, with no npm and no `package.json` on the machine.
 *
 * Every check runs before the folder is touched. The new folder is written
 * beside the live one under a dot-prefixed name, which a scan skips, and
 * renamed into place, so a reload never sees a half-written folder.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import semver from 'semver';

import { HOST_API_VERSION } from '../plugin.ts';
import { PLUGIN_ENTRY, PLUGIN_MANIFEST, readPluginManifest, scanPluginFolders } from './folder.ts';
import type { PluginManifest } from './folder.ts';
import { PACKAGE_NAME } from './registry.ts';

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

/** The folder in a package that is the plugin's folder once installed. */
const BUNDLE_PREFIX = 'dist/bundle/';

export interface PackageSpec {
  name: string;
  /** A version, a dist-tag or a range; `latest` when none was given. */
  wanted: string;
}

/** `@scope/name@1.2.3`, `name@next` or a bare name. */
export function parsePackageSpec(spec: string): PackageSpec {
  const at = spec.indexOf('@', 1);
  const name = at === -1 ? spec : spec.slice(0, at);
  const wanted = at === -1 ? 'latest' : spec.slice(at + 1);
  if (!PACKAGE_NAME.test(name) || wanted === '') {
    throw new Error(
      `${JSON.stringify(spec)} is not a package, such as @geekity/plugin-llm or @geekity/plugin-llm@0.1.0.`,
    );
  }
  return { name, wanted };
}

export interface AddedPlugin {
  manifest: PluginManifest;
  directory: string;
  /** The version it replaced, when the folder held one. */
  replaced: string | undefined;
}

/** Fetch, check and install one plugin package. Throws, leaving the folder alone, when it cannot. */
export async function addPlugin(
  spec: PackageSpec,
  options: { pluginsDir: string; registry: string },
): Promise<AddedPlugin> {
  const { name } = spec;
  const release = await resolveRelease(spec, options.registry);
  const label = `${name} ${release.version}`;

  const response = await fetch(release.tarball);
  if (!response.ok) {
    throw new Error(
      `Downloading ${label} failed: the registry answered ${String(response.status)}.`,
    );
  }
  const tarball = Buffer.from(await response.arrayBuffer());
  const integrityProblem = checkIntegrity(tarball, release);
  if (integrityProblem !== undefined) throw new Error(`${label} was refused: ${integrityProblem}`);

  const files = bundleFiles(unpackTarball(tarball));
  if (!files.has(PLUGIN_ENTRY) || !files.has(PLUGIN_MANIFEST)) {
    throw new Error(
      `${label} has no plugin bundle (${BUNDLE_PREFIX}${PLUGIN_ENTRY} and ${BUNDLE_PREFIX}${PLUGIN_MANIFEST}). A plugin that is not bundled can only be installed with npm, by a site with its own server.`,
    );
  }

  const directory = path.join(options.pluginsDir, ...name.split('/'));
  const parent = path.dirname(directory);
  await mkdir(parent, { recursive: true });
  const staging = path.join(parent, hidden('adding', directory));
  try {
    for (const [file, bytes] of files) {
      const target = path.join(staging, ...file.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    const manifest = stagedManifest(staging, label, name);
    const replaced = existsSync(directory) ? installedVersion(directory) : undefined;
    await swapInto(staging, directory);
    return { manifest, directory, replaced };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Delete a plugin's folder. Throws when there is none. */
export async function removePlugin(name: string, pluginsDir: string): Promise<string> {
  const directory = path.join(pluginsDir, ...name.split('/'));
  if (!PACKAGE_NAME.test(name) || !existsSync(directory)) {
    throw new Error(`${name} is not in the plugins folder, ${pluginsDir}.`);
  }
  const doomed = path.join(path.dirname(directory), hidden('removing', directory));
  await rename(directory, doomed);
  await rm(doomed, { recursive: true, force: true });
  return directory;
}

/**
 * A line for each plugin the manifest requires that is not installed or not
 * in range, and for a core out of range. `installed` maps each installed
 * plugin to its version, or to `undefined` when that is not known.
 */
export function requirementNotes(
  manifest: PluginManifest,
  installed: ReadonlyMap<string, string | undefined>,
  coreVersion: string,
): string[] {
  const notes: string[] = [];
  for (const [dependency, range] of Object.entries(manifest.peerDependencies)) {
    if (dependency === CORE_PACKAGE) {
      if (!semver.satisfies(coreVersion, range)) {
        notes.push(
          `It needs ${CORE_PACKAGE} ${range}, and this core is ${coreVersion}, so it will be unavailable.`,
        );
      }
      continue;
    }
    if (!installed.has(dependency)) {
      notes.push(
        `It requires ${dependency} ${range}, which is not installed. Add it with: geekity plugin add ${dependency}`,
      );
      continue;
    }
    const version = installed.get(dependency);
    if (version !== undefined && !semver.satisfies(version, range)) {
      notes.push(`It requires ${dependency} ${range}, and ${version} is installed.`);
    }
  }
  return notes;
}

const CORE_PACKAGE = '@geekity/cms';

interface Release {
  version: string;
  tarball: string;
  integrity: string | undefined;
  shasum: string | undefined;
}

interface PackageDocument {
  'dist-tags'?: Record<string, string>;
  versions?: Record<
    string,
    { dist?: { tarball?: string; integrity?: string; shasum?: string } } | undefined
  >;
}

async function resolveRelease(spec: PackageSpec, registry: string): Promise<Release> {
  const url = new URL(
    spec.name.replace('/', '%2f'),
    registry.endsWith('/') ? registry : `${registry}/`,
  );
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' },
  });
  if (response.status === 404) {
    throw new Error(`${spec.name} is not on the registry at ${registry}.`);
  }
  if (!response.ok) {
    throw new Error(
      `The registry at ${registry} answered ${String(response.status)} for ${spec.name}.`,
    );
  }
  const document = (await response.json()) as PackageDocument;
  const versions = Object.keys(document.versions ?? {});
  const version =
    document['dist-tags']?.[spec.wanted] ??
    (semver.valid(spec.wanted) !== null && versions.includes(spec.wanted)
      ? spec.wanted
      : semver.validRange(spec.wanted) !== null
        ? semver.maxSatisfying(versions, spec.wanted)
        : null);
  const dist = version === null ? undefined : document.versions?.[version]?.dist;
  if (version === null || dist?.tarball === undefined) {
    throw new Error(`${spec.name} has no version matching ${spec.wanted}.`);
  }
  return { version, tarball: dist.tarball, integrity: dist.integrity, shasum: dist.shasum };
}

const HASHES = ['sha512', 'sha384', 'sha256', 'sha1'] as const;

/** Why the tarball does not match what the registry published, or `undefined`. */
function checkIntegrity(tarball: Buffer, release: Release): string | undefined {
  const claims = (release.integrity ?? '').split(/\s+/).filter((claim) => claim !== '');
  for (const algorithm of HASHES) {
    const expected = claims
      .filter((claim) => claim.startsWith(`${algorithm}-`))
      .map((claim) => claim.slice(algorithm.length + 1).replace(/\?.*$/, ''));
    if (expected.length === 0) continue;
    const actual = createHash(algorithm).update(tarball).digest('base64');
    return expected.includes(actual)
      ? undefined
      : `its ${algorithm} integrity hash does not match the one the registry published.`;
  }
  if (release.shasum !== undefined) {
    return createHash('sha1').update(tarball).digest('hex') === release.shasum.toLowerCase()
      ? undefined
      : 'its sha1 hash does not match the one the registry published.';
  }
  return 'the registry published no integrity hash to check it against.';
}

/**
 * The regular files in a gzipped tar, by path with the archive's top folder
 * (`package/` in an npm tarball) removed. Links and devices are skipped.
 */
export function unpackTarball(gzipped: Buffer): Map<string, Buffer> {
  const archive = gunzipSync(gzipped);
  const files = new Map<string, Buffer>();
  let longName: string | undefined;
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const body = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      longName = paxPath(body.toString('utf8')) ?? longName;
      continue;
    }
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    const prefix = field(header, 345, 155);
    const name = longName ?? (prefix === '' ? '' : `${prefix}/`) + field(header, 0, 100);
    longName = undefined;
    if (type !== '0' && type !== '\0') continue;
    const relative = name.split('/').slice(1).join('/');
    if (relative !== '') files.set(relative, Buffer.from(body));
  }
  return files;
}

function field(header: Buffer, start: number, length: number): string {
  return header
    .subarray(start, start + length)
    .toString('utf8')
    .replace(/\0.*$/s, '');
}

function paxPath(records: string): string | undefined {
  for (const record of records.split('\n')) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match !== null) return match[1];
  }
  return undefined;
}

/** The files under the package's `dist/bundle/`, by path inside it. Anything that would climb out is refused. */
function bundleFiles(files: Map<string, Buffer>): Map<string, Buffer> {
  const bundle = new Map<string, Buffer>();
  for (const [file, bytes] of files) {
    if (!file.startsWith(BUNDLE_PREFIX)) continue;
    const inside = file.slice(BUNDLE_PREFIX.length);
    const segments = inside.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error(`The package holds a file the plugins folder cannot take: ${file}.`);
    }
    bundle.set(inside, bytes);
  }
  return bundle;
}

function stagedManifest(staging: string, label: string, name: string): PluginManifest {
  let manifest: PluginManifest | undefined;
  try {
    manifest = readPluginManifest(staging);
  } catch (error) {
    throw new Error(
      `${label} was refused: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (manifest === undefined) throw new Error(`${label} has no ${PLUGIN_MANIFEST}.`);
  if (manifest.name !== name) {
    throw new Error(`${label} was refused: its ${PLUGIN_MANIFEST} names ${manifest.name}.`);
  }
  if (manifest.hostApi > HOST_API_VERSION) {
    throw new Error(
      `${label} targets host API version ${String(manifest.hostApi)}, and this core provides version ${String(HOST_API_VERSION)}. Upgrade @geekity/cms, or add an older version of the plugin.`,
    );
  }
  return manifest;
}

/** Each plugin folder by name, with the version its `plugin.json` names, when it has a usable one. */
export function installedFolders(pluginsDir: string): Map<string, string | undefined> {
  return new Map(
    scanPluginFolders(pluginsDir).map((folder) => [
      folder.name,
      installedVersion(folder.directory),
    ]),
  );
}

function installedVersion(directory: string): string | undefined {
  try {
    return readPluginManifest(directory)?.version;
  } catch {
    return undefined;
  }
}

/**
 * Put the staged folder where the live one is. A directory cannot be renamed
 * over a full one, so the old one is moved aside first, and back if the second
 * rename fails.
 */
async function swapInto(staging: string, directory: string): Promise<void> {
  if (!existsSync(directory)) {
    await rename(staging, directory);
    return;
  }
  const old = path.join(path.dirname(directory), hidden('replaced', directory));
  await rename(directory, old);
  try {
    await rename(staging, directory);
  } catch (error) {
    await rename(old, directory);
    throw error;
  }
  await rm(old, { recursive: true, force: true });
}

/** A dot-prefixed sibling name, which a scan of the plugins folder skips. */
function hidden(purpose: string, directory: string): string {
  return `.${purpose}-${path.basename(directory)}-${randomBytes(4).toString('hex')}`;
}
