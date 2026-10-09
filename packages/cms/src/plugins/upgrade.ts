import semver from 'semver';

import { readPluginManifest, scanPluginFolders } from './folder.ts';
import { addPlugin, CORE_PACKAGE, fetchPackument, requirementNotes } from './install.ts';
import type { AddAdvice } from './install.ts';
import type { PackageDocument } from './install.ts';

type Ranges = Readonly<Record<string, string>>;

export interface PluginRelease {
  readonly name: string;
  readonly version: string;
  readonly peerDependencies: Ranges;
}

export type PluginUpgrade =
  | {
      readonly name: string;
      readonly status: 'upgraded' | 'available';
      readonly from: string;
      readonly to: string;
      readonly heldBack: string | undefined;
    }
  | { readonly name: string; readonly status: 'newest'; readonly version: string }
  | {
      readonly name: string;
      readonly status: 'held';
      readonly version: string;
      readonly reason: string;
    }
  | { readonly name: string; readonly status: 'skipped'; readonly reason: string }
  | {
      readonly name: string;
      readonly status: 'failed';
      readonly from: string;
      readonly to: string;
      readonly reason: string;
    };

export interface UpgradeReport {
  readonly plugins: readonly PluginUpgrade[];
  readonly unmet: readonly { readonly name: string; readonly notes: readonly string[] }[];
}

export interface UpgradeOptions {
  pluginsDir: string;
  registry: string;
  coreVersion: string;
  configured?: readonly PluginRelease[];
  only?: readonly string[] | undefined;
  check?: boolean;
  addAdvice: AddAdvice;
}

export async function upgradePlugins(options: UpgradeOptions): Promise<UpgradeReport> {
  const { pluginsDir, registry, coreVersion } = options;
  const installed = new Map<string, PluginRelease | string>();
  for (const folder of scanPluginFolders(pluginsDir)) {
    installed.set(folder.name, installedRelease(folder.directory));
  }
  const targets = [...new Set(options.only ?? installed.keys())];

  const results = new Map<string, PluginUpgrade>();
  const releases = new Map<string, PluginRelease[]>();
  const newest = new Map<string, PluginRelease>();
  for (const plugin of options.configured ?? []) releases.set(plugin.name, [plugin]);
  for (const [name, release] of installed) {
    if (typeof release !== 'string') releases.set(name, [release]);
  }

  await Promise.all(
    targets.map(async (name) => {
      const current = installed.get(name);
      if (current === undefined) {
        results.set(name, skipped(name, `it is not in the plugins folder, ${pluginsDir}.`));
        return;
      }
      if (typeof current === 'string') {
        results.set(name, skipped(name, current));
        return;
      }
      let document: PackageDocument;
      try {
        document = await fetchPackument(name, registry);
      } catch (error) {
        results.set(name, skipped(name, error instanceof Error ? error.message : String(error)));
        return;
      }
      const newer = newerReleases(name, current.version, document);
      const runnable = newer.filter((release) => coreAccepts(release, coreVersion));
      releases.set(name, [...runnable, current]);
      if (newer[0] !== undefined) newest.set(name, newer[0]);
    }),
  );

  const chosen = newestThatFit(releases);
  const why = (release: PluginRelease) => heldBackReason(release, chosen, coreVersion);

  const upgrades: PluginRelease[] = [];
  for (const name of targets) {
    if (results.has(name)) continue;
    const from = (releases.get(name)?.at(-1) as PluginRelease).version;
    const to = chosen.get(name) as PluginRelease;
    const best = newest.get(name);
    if (to.version !== from) {
      upgrades.push(to);
      const heldBack = best !== undefined && best.version !== to.version ? why(best) : undefined;
      results.set(name, { name, status: 'available', from, to: to.version, heldBack });
    } else if (best === undefined) {
      results.set(name, { name, status: 'newest', version: from });
    } else {
      results.set(name, { name, status: 'held', version: from, reason: why(best) });
    }
  }

  const final = new Map([...releases].map(([name, list]) => [name, list.at(-1) as PluginRelease]));
  if (options.check === true) {
    for (const release of upgrades) final.set(release.name, release);
  } else {
    for (const release of dependencyOrder(upgrades)) {
      const result = results.get(release.name) as PluginUpgrade & { status: 'available' };
      const missing = pluginRanges(release).find(([dependency, range]) => {
        const provider = final.get(dependency);
        return provider !== undefined && !semver.satisfies(provider.version, range);
      });
      if (missing !== undefined) {
        const [dependency, range] = missing;
        results.set(release.name, {
          name: release.name,
          status: 'held',
          version: result.from,
          reason: `${release.version} requires ${dependency} ${range}, and upgrading ${dependency} failed.`,
        });
        continue;
      }
      try {
        await addPlugin({ name: release.name, wanted: release.version }, { pluginsDir, registry });
        final.set(release.name, release);
        results.set(release.name, { ...result, status: 'upgraded' });
      } catch (error) {
        results.set(release.name, {
          name: release.name,
          status: 'failed',
          from: result.from,
          to: release.version,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const versions = new Map([...final].map(([name, release]) => [name, release.version]));
  const unmet = [...installed.keys()].flatMap((name) => {
    const release = final.get(name);
    if (release === undefined) return [];
    const notes = requirementNotes(release, versions, coreVersion, options.addAdvice);
    return notes.length === 0 ? [] : [{ name, notes }];
  });

  return { plugins: targets.map((name) => results.get(name) as PluginUpgrade), unmet };
}

/** What became of one plugin, as a clause after its name. */
export function describeUpgrade(plugin: PluginUpgrade): string {
  switch (plugin.status) {
    case 'upgraded':
    case 'available': {
      const done =
        plugin.status === 'upgraded'
          ? `upgraded from ${plugin.from} to ${plugin.to}.`
          : `${plugin.from} can be upgraded to ${plugin.to}.`;
      return plugin.heldBack === undefined ? done : `${done} ${plugin.heldBack}`;
    }
    case 'newest':
      return `${plugin.version} is the newest.`;
    case 'held':
      return `held back at ${plugin.version}: ${plugin.reason}`;
    case 'skipped':
      return `skipped: ${plugin.reason}`;
    case 'failed':
      return `upgrading from ${plugin.from} to ${plugin.to} failed: ${plugin.reason}`;
  }
}

function skipped(name: string, reason: string): PluginUpgrade {
  return { name, status: 'skipped', reason };
}

function installedRelease(directory: string): PluginRelease | string {
  try {
    const manifest = readPluginManifest(directory);
    if (manifest === undefined) return 'it has no plugin.json.';
    if (semver.valid(manifest.version) === null) {
      return `its plugin.json names version ${JSON.stringify(manifest.version)}, which is not a semver version.`;
    }
    return manifest;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function newerReleases(
  name: string,
  installed: string,
  document: PackageDocument,
): PluginRelease[] {
  const latest = document['dist-tags']?.['latest'];
  return Object.entries(document.versions ?? {})
    .filter(
      ([version]) =>
        semver.valid(version) !== null &&
        semver.prerelease(version) === null &&
        semver.gt(version, installed) &&
        (latest === undefined || semver.valid(latest) === null || semver.lte(version, latest)),
    )
    .map(([version, entry]) => ({ name, version, peerDependencies: entry?.peerDependencies ?? {} }))
    .sort((a, b) => semver.rcompare(a.version, b.version));
}

function coreAccepts(release: PluginRelease, coreVersion: string): boolean {
  const range = release.peerDependencies[CORE_PACKAGE];
  return range === undefined || semver.satisfies(coreVersion, range);
}

function pluginRanges(release: PluginRelease): [string, string][] {
  return Object.entries(release.peerDependencies).filter(([name]) => name !== CORE_PACKAGE);
}

function newestThatFit(
  newestFirstToInstalled: ReadonlyMap<string, readonly PluginRelease[]>,
): Map<string, PluginRelease> {
  const index = new Map([...newestFirstToInstalled.keys()].map((name) => [name, 0]));
  const at = (name: string) => newestFirstToInstalled.get(name)?.[index.get(name) ?? 0];
  const stepDown = (name: string) => {
    const position = index.get(name) ?? 0;
    if (position >= (newestFirstToInstalled.get(name)?.length ?? 0) - 1) return false;
    index.set(name, position + 1);
    return true;
  };
  const stepDownOneConflict = () => {
    for (const name of newestFirstToInstalled.keys()) {
      for (const [dependency, range] of pluginRanges(at(name) as PluginRelease)) {
        const provider = at(dependency);
        if (provider === undefined) {
          if (stepDown(name)) return true;
        } else if (!semver.satisfies(provider.version, range)) {
          const providerTooNew = semver.gtr(provider.version, range);
          const [likelyFix, otherFix] = providerTooNew ? [dependency, name] : [name, dependency];
          if (stepDown(likelyFix) || stepDown(otherFix)) return true;
        }
      }
    }
    return false;
  };
  while (stepDownOneConflict());
  return new Map(
    [...newestFirstToInstalled.keys()].map((name) => [name, at(name) as PluginRelease]),
  );
}

function heldBackReason(
  release: PluginRelease,
  chosen: ReadonlyMap<string, PluginRelease>,
  coreVersion: string,
): string {
  const { name, version } = release;
  const core = release.peerDependencies[CORE_PACKAGE];
  if (core !== undefined && !semver.satisfies(coreVersion, core)) {
    return `${version} needs ${CORE_PACKAGE} ${core}, and this core is ${coreVersion}.`;
  }
  for (const [dependency, range] of pluginRanges(release)) {
    const provider = chosen.get(dependency);
    if (provider === undefined) {
      return `${version} requires ${dependency} ${range}, which is not installed.`;
    }
    if (!semver.satisfies(provider.version, range)) {
      return `${version} requires ${dependency} ${range}, and ${dependency} is at ${provider.version}.`;
    }
  }
  for (const consumer of chosen.values()) {
    const range = consumer.peerDependencies[name];
    if (range !== undefined && !semver.satisfies(version, range)) {
      return `${consumer.name} ${consumer.version} requires ${name} ${range}.`;
    }
  }
  return `${version} cannot be installed beside the other plugins.`;
}

function dependencyOrder(releases: readonly PluginRelease[]): PluginRelease[] {
  const byName = new Map(releases.map((release) => [release.name, release]));
  const ordered: PluginRelease[] = [];
  const visit = (release: PluginRelease, seen: Set<string>) => {
    if (ordered.includes(release) || seen.has(release.name)) return;
    seen.add(release.name);
    for (const [dependency] of pluginRanges(release)) {
      const required = byName.get(dependency);
      if (required !== undefined) visit(required, seen);
    }
    ordered.push(release);
  };
  for (const release of releases) visit(release, new Set());
  return ordered;
}
