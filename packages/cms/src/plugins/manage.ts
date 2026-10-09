import path from 'node:path';

import type { FlashKind } from '../admin/store.ts';
import { withFileLock } from '../files/atomic.ts';
import { recordPluginChanges } from './changes.ts';
import type { PluginChange } from './changes.ts';
import {
  addPlugin,
  installedFolders,
  parsePackageSpec,
  removePlugin,
  requirementNotes,
} from './install.ts';
import { describeUpgrade, upgradePlugins } from './upgrade.ts';
import type { PluginRelease, PluginUpgrade, UpgradeReport } from './upgrade.ts';

export interface ManageOptions {
  pluginsDir: string;
  registry: string;
  coreVersion: string;
  /** The site config's plugins: never changed here, but their ranges count. */
  configured: readonly PluginRelease[];
  dataDir: string;
  /** The admin making the change, for the record. */
  user: string;
  now: Date;
  /** What to tell the admin to do once the folder has changed. */
  next: string;
}

export interface ManageOutcome {
  kind: FlashKind;
  message: string;
}

const checks = new Map<string, { at: Date; plugins: readonly PluginUpgrade[] }>();

export function lastUpdateCheck(
  pluginsDir: string,
): { at: Date; plugins: readonly PluginUpgrade[] } | undefined {
  return checks.get(path.resolve(pluginsDir));
}

/** Look for newer versions of every folder plugin, and keep the answer for the screen. */
export async function checkForUpdates(
  options: Omit<ManageOptions, 'user' | 'dataDir' | 'next'>,
  only?: readonly string[],
): Promise<UpgradeReport> {
  const report = await upgradePlugins({ ...options, only, check: true });
  if (only === undefined) {
    checks.set(path.resolve(options.pluginsDir), { at: options.now, plugins: report.plugins });
  }
  return report;
}

export async function installPlugin(
  options: ManageOptions,
  spec: string,
): Promise<ManageOutcome[]> {
  const parsed = parsePackageSpec(spec);
  return await serialized(options, async () => {
    const { manifest, replaced } = await addPlugin(parsed, options);
    const { name, version } = manifest;
    const installed = new Map<string, string | undefined>([
      ...options.configured.map((plugin) => [plugin.name, plugin.version] as const),
      ...installedFolders(options.pluginsDir),
    ]);
    const done =
      replaced === undefined || replaced === version
        ? `Added ${name} ${version}.`
        : `Replaced ${name} ${replaced} with ${version}.`;
    return {
      changes: [{ action: 'add', name, to: version, from: replaced }],
      outcomes: [
        notice(done),
        ...requirementNotes(manifest, installed, options.coreVersion).map((note) =>
          warning(`${name}: ${note}`),
        ),
        notice(options.next),
      ],
    };
  });
}

/** Update the named folder plugins, or every one when `only` is `undefined`. */
export async function updatePlugins(
  options: ManageOptions,
  only: readonly string[] | undefined,
): Promise<ManageOutcome[]> {
  return await serialized(options, async () => {
    const report = await upgradePlugins({ ...options, only });
    const changes: PluginChange[] = report.plugins.flatMap((plugin) =>
      plugin.status === 'upgraded'
        ? [{ action: 'update', name: plugin.name, from: plugin.from, to: plugin.to }]
        : [],
    );
    return {
      changes,
      outcomes: [
        ...report.plugins.map((plugin) => ({
          kind: UPGRADE_KINDS[plugin.status],
          message: `${plugin.name}: ${describeUpgrade(plugin)}`,
        })),
        ...report.unmet.flatMap(({ name, notes }) =>
          notes.map((note) => warning(`${name}: ${note}`)),
        ),
        ...(changes.length > 0 ? [notice(options.next)] : []),
      ],
    };
  });
}

export async function deletePlugin(options: ManageOptions, name: string): Promise<ManageOutcome[]> {
  return await serialized(options, async () => {
    const version = installedFolders(options.pluginsDir).get(name);
    await removePlugin(name, options.pluginsDir);
    return {
      changes: [{ action: 'remove', name, from: version }],
      outcomes: [
        notice(version === undefined ? `Removed ${name}.` : `Removed ${name} ${version}.`),
        notice(options.next),
      ],
    };
  });
}

const UPGRADE_KINDS: Readonly<Record<PluginUpgrade['status'], FlashKind>> = {
  upgraded: 'notice',
  available: 'notice',
  newest: 'notice',
  held: 'warning',
  skipped: 'warning',
  failed: 'error',
};

async function serialized(
  options: ManageOptions,
  change: () => Promise<{ changes: readonly PluginChange[]; outcomes: ManageOutcome[] }>,
): Promise<ManageOutcome[]> {
  const folder = path.resolve(options.pluginsDir);
  return await withFileLock(folder, async () => {
    const { changes, outcomes } = await change();
    if (changes.length > 0) checks.delete(folder);
    await recordPluginChanges(options.dataDir, { user: options.user, at: options.now }, changes);
    return outcomes;
  });
}

function notice(message: string): ManageOutcome {
  return { kind: 'notice', message };
}

function warning(message: string): ManageOutcome {
  return { kind: 'warning', message };
}
