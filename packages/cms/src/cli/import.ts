import path from 'node:path';

import { loadConfig, settleConfig } from '../config-loader.ts';
import { resolveConfig } from '../config.ts';
import { ownManifest } from '../init.ts';
import { createSettings } from '../site/namespace.ts';
import { isServing } from '../supervisor/control.ts';
import type { ParsedArgs } from './args.ts';
import { databaseInUse } from './database-in-use.ts';
import { count } from './format.ts';
import { rebuildDatabase } from './rebuild.ts';
import { setOrThrow } from './settings.ts';

export async function importCommand({ args, configPath, flags }: ParsedArgs): Promise<number> {
  const [file, ...extra] = args;
  if (file === undefined) {
    throw new Error('geekity import needs one archive: geekity import <file>.');
  }
  if (extra.length > 0) {
    throw new Error(
      `geekity import takes one archive, and no plugin on this site adds "import ${file}".`,
    );
  }
  const unsettled = resolveConfig({
    ...(await loadConfig(process.cwd(), configPath)),
    watch: false,
  });
  const { contentDir, dataDir } = unsettled;
  if (databaseInUse(dataDir) || (await isServing(dataDir))) {
    process.stderr.write(
      `The site is running: ${dataDir} is in use. Stop it and run geekity import again.\n`,
    );
    return 1;
  }

  const {
    checkImportTargets,
    discardStaging,
    finishSiteImport,
    importNotes,
    installArchivedPlugins,
    placeSiteImport,
    pluginFailureLine,
    readSiteManifest,
    restoreEnabledPlugins,
    stageSiteImport,
  } = await import('../export/site-import.ts');
  const { compactTime } = await import('../export/site-export.ts');
  const { pluginRegistry } = await import('../plugins/install.ts');
  const archive = path.resolve(file);
  const targets = { contentDir, dataDir };
  const settings = createSettings({ config: unsettled });
  const archived = await readSiteManifest(archive);
  const { manifest } = archived;
  const occupied = checkImportTargets(archived, targets, settings).filter(
    (target) => target.state === 'occupied',
  );
  if (occupied.length > 0 && flags['replace'] !== true) {
    process.stderr.write(
      `${occupied.map((target) => target.dir).join(' and ')} already ${occupied.length === 1 ? 'holds' : 'hold'} a site. ` +
        'Import into empty folders, or give --replace to move what they hold into <dir>/.geekity-before-import-<time> first.\n',
    );
    return 1;
  }

  const staged = await stageSiteImport({ archive, archived, targets, settings });
  const inEffect = await settleConfig(
    Object.freeze({ ...unsettled, contentDir: staged.content ?? contentDir }),
  );
  if (inEffect.baseUrl !== manifest.baseUrl && flags['new-base-url'] !== true) {
    await discardStaging(staged);
    process.stderr.write(
      `The base URL in effect is ${inEffect.baseUrl}, and the archive was exported from ${manifest.baseUrl}. ` +
        'Actor ids are built from the base URL, so followers would not follow the site to a new address. ' +
        `Set GEEKITY_BASE_URL, or baseUrl in the config, to ${manifest.baseUrl}, ` +
        `or give --new-base-url to import it at ${inEffect.baseUrl}.\n`,
    );
    return 1;
  }
  for (const skipped of staged.skipped) {
    process.stderr.write(`Left out ${skipped.path}: ${skipped.why}.\n`);
  }

  for (const aside of await placeSiteImport(staged, { stamp: compactTime(unsettled.now()) })) {
    process.stdout.write(`Moved what was there into ${aside}.\n`);
  }
  process.stdout.write(
    `Restored ${count(manifest.files.length - staged.skipped.length, 'file')} from ${archive}.\n`,
  );

  const config = await settleConfig(unsettled);
  if (flags['dev-mode'] === true) {
    await setOrThrow(createSettings({ config }), 'dev_mode', { on: true });
    process.stdout.write(
      'Dev mode is on: nothing the site does is sent until `geekity dev-mode off`.\n',
    );
  }
  const failures = await installArchivedPlugins(manifest, {
    pluginsDir: config.pluginsDir,
    registry: pluginRegistry(process.env),
    coreVersion: ownManifest().version,
  });
  for (const plugin of manifest.plugins) {
    if (plugin.source === 'folder' && !failures.some((failed) => failed.name === plugin.name)) {
      process.stdout.write(`Installed ${plugin.name} ${plugin.version}.\n`);
    }
  }
  await restoreEnabledPlugins(manifest, config.contentDir);
  await rebuildDatabase(config);
  await finishSiteImport(targets);

  process.stdout.write(
    importNotes(manifest)
      .map((note) => `${note}\n`)
      .join(''),
  );
  for (const failed of failures) process.stderr.write(`${pluginFailureLine(failed)}\n`);
  return failures.length > 0 ? 1 : 0;
}
