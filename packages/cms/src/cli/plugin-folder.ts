import { loadResolvedConfig } from '../config-loader.ts';
import type { ResolvedConfig } from '../config.ts';
import { ownManifest } from '../init.ts';
import type { UpgradeReport } from '../plugins/upgrade.ts';
import { askToReload } from '../supervisor/control.ts';
import type { ParsedArgs } from './args.ts';

export async function pluginFolderCommand({
  args,
  configPath,
  flags,
}: ParsedArgs): Promise<number> {
  const [action, ...names] = args;
  const spec = names.length === 1 ? names[0] : undefined;
  if (action !== 'upgrade' && action !== 'add' && action !== 'remove') {
    throw new Error(PLUGIN_USAGE);
  }
  const config = await loadResolvedConfig(configPath);
  const { pluginsDir } = config;
  if (pluginsDir === undefined) {
    throw new Error(
      'geekity plugin needs a plugins folder: set GEEKITY_PLUGINS_DIR, or pluginsDir in the config.',
    );
  }
  const {
    ADD_WITH_COMMAND,
    addPlugin,
    installedFolders,
    parsePackageSpec,
    pluginRegistry,
    removePlugin,
    requirementNotes,
  } = await import('../plugins/install.ts');
  const registry = pluginRegistry(process.env);

  if (action === 'upgrade') {
    const { upgradePlugins } = await import('../plugins/upgrade.ts');
    const report = await upgradePlugins({
      pluginsDir,
      registry,
      coreVersion: ownManifest().version,
      configured: config.plugins.map((plugin) => ({
        name: plugin.name,
        version: plugin.version,
        peerDependencies: plugin.requires ?? {},
      })),
      only: names.length === 0 ? undefined : names,
      check: flags['check'] === true,
      addAdvice: ADD_WITH_COMMAND,
    });
    process.stdout.write(await upgradeReportText(report));
    const reloaded = report.plugins.some((plugin) => plugin.status === 'upgraded')
      ? await reloadRunningSite(config)
      : true;
    return reloaded && report.plugins.every((plugin) => plugin.status !== 'failed') ? 0 : 1;
  }

  if (spec === undefined) throw new Error(PLUGIN_USAGE);
  if (action === 'remove') {
    const directory = await removePlugin(spec, { pluginsDir, contentDir: config.contentDir });
    process.stdout.write(`Removed ${spec} (${directory}).\n`);
    return (await reloadRunningSite(config)) ? 0 : 1;
  }

  const { manifest, directory, replaced } = await addPlugin(parsePackageSpec(spec), {
    pluginsDir,
    registry,
  });
  const installed = new Map<string, string | undefined>([
    ...config.plugins.map((plugin) => [plugin.name, plugin.version] as const),
    ...installedFolders(pluginsDir),
  ]);
  const done =
    replaced === undefined || replaced === manifest.version
      ? `Added ${manifest.name} ${manifest.version} to ${directory}.`
      : `Replaced ${manifest.name} ${replaced} with ${manifest.version} in ${directory}.`;
  process.stdout.write(
    [
      done,
      ...requirementNotes(manifest, installed, ownManifest().version, ADD_WITH_COMMAND),
      '',
    ].join('\n'),
  );
  const reloaded = await reloadRunningSite(config);
  process.stdout.write('Enable it on the Plugins screen.\n');
  return reloaded ? 0 : 1;
}

async function reloadRunningSite(config: ResolvedConfig): Promise<boolean> {
  const outcome = await askToReload(config.dataDir);
  if (outcome === undefined) {
    process.stdout.write(
      config.pluginWatch
        ? 'No running geekity serve answered. A running site loads the change by itself within a few seconds.\n'
        : 'No running geekity serve answered. Press Reload on the Plugins screen to load the change.\n',
    );
    return true;
  }
  if (outcome.ok) {
    process.stdout.write('The running site reloaded with the change.\n');
    return true;
  }
  process.stdout.write(
    `The running site tried to reload, but the new server did not start, so it carried on with the plugins it had: ${outcome.error}\n`,
  );
  return false;
}

const PLUGIN_USAGE =
  'geekity plugin needs add <package>[@version], remove <package> or upgrade [<package>...].';

async function upgradeReportText(report: UpgradeReport): Promise<string> {
  const { describeUpgrade } = await import('../plugins/upgrade.ts');
  const lines = report.plugins.map((plugin) => `${plugin.name}: ${describeUpgrade(plugin)}`);
  for (const { name, notes } of report.unmet) {
    lines.push(...notes.map((note) => `${name}: ${note}`));
  }
  const statuses = new Set(report.plugins.map((plugin) => plugin.status));
  if (statuses.has('available')) {
    lines.push('Run geekity plugin upgrade without --check to install them.');
  }
  return lines.map((line) => `${line}\n`).join('');
}
