import cluster from 'node:cluster';

import { loadResolvedConfig } from '../config-loader.ts';
import { geminiHost } from '../gemini/site-certificate.ts';
import { seedStarterContent } from '../init.ts';
import { importPluginFolders, scanPluginFolders } from '../plugins/folder.ts';
import { DEV_MODE } from '../settings/dev-mode.ts';
import { SITE } from '../site/namespace.ts';
import { messageOf } from '../util/errors.ts';
import type { ParsedArgs } from './args.ts';

/**
 * `geekity serve`: the default. Runs until it is signalled.
 *
 * This process is a supervisor: it owns the port and runs the CMS
 * in a `node:cluster` worker that runs this same command, so Reload on the
 * Plugins screen can boot a new worker beside the old one and a worker that
 * crashes is respawned, both without restarting the container.
 *
 * With `seedContent` on, a missing or empty content directory is given the
 * starter site before any worker opens it, so a new box boots into something
 * to show and the setup screen. It happens here rather than in `createCms` so
 * a site that builds its own server never has content written for it.
 */
export async function serveCommand({ configPath }: ParsedArgs): Promise<number> {
  if (cluster.isWorker) return serveWorker(configPath);

  const resolved = await loadResolvedConfig(configPath);
  if (
    resolved.seedContent &&
    (await seedStarterContent({ contentDir: resolved.contentDir, baseUrl: resolved.baseUrl }))
  ) {
    process.stdout.write(`Seeded ${resolved.contentDir} with the starter site\n`);
  }
  const { superviseCluster } = await import('../supervisor/primary.ts');
  superviseCluster({
    dataDir: resolved.dataDir,
    pluginsDir: resolved.pluginsDir,
    pluginWatch: resolved.pluginWatch,
  });
  return 0;
}

/**
 * One worker under the supervisor: the site's config and its plugins folder,
 * read afresh, so a reload sees what changed. Signals are the supervisor's to
 * act on; it tells this worker when to close.
 */
async function serveWorker(configPath: string | undefined): Promise<number> {
  const { processChannel, superviseWorker } = await import('../supervisor/worker.ts');
  const { createCms } = await import('../index.ts');
  const channel = processChannel();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => undefined);

  try {
    // The access log is on here and off in `createCms`: a server that answers
    // the internet should be able to say what it answered, while a CMS embedded
    // in somebody else's app has no business writing to their stdout uninvited.
    // Named as a config value rather than forced, so `GEEKITY_ACCESS_LOG` still
    // wins and a site that wrote `accessLog: false` still gets silence.
    const config = await loadResolvedConfig(configPath, (site) => ({
      ...site,
      accessLog: site.accessLog ?? true,
    }));
    const loaded = scanPluginFolders(config.pluginsDir);
    const worker = superviseWorker({
      channel,
      loaded,
      exit: (code) => process.exit(code),
      log: (line) => process.stderr.write(`${line}\n`),
    });

    const cms = createCms(config, {
      folderPlugins: await importPluginFolders(loaded),
      supervision: worker.supervision,
    });
    const { port, geminiPort } = await cms.serve();
    if (await cms.settings.get(DEV_MODE.on)) {
      process.stdout.write(
        'Dev mode is on: ActivityPub, webmentions, feed pings, IndexNow and email are held ' +
          'and recorded in data/dev-mode.jsonl. `geekity dev-mode off` takes the site live.\n',
      );
    }
    process.stdout.write(`Geekity CMS is serving ${cms.config.baseUrl} on port ${String(port)}\n`);
    if (geminiPort !== undefined) {
      const host = geminiHost(cms.config, await cms.settings.values(SITE));
      process.stdout.write(`Gemini is on port ${String(geminiPort)} for ${host}\n`);
    }
    worker.serving(cms);
  } catch (error) {
    const message = messageOf(error);
    channel.send({ type: 'boot-failed', error: message }, () => process.exit(1));
  }
  return 0;
}
