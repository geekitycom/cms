import cluster from 'node:cluster';

import { loadResolvedConfig } from '../config-loader.ts';
import { geminiHost } from '../gemini/site-certificate.ts';
import { seedStarterContent } from '../init.ts';
import { importPluginFolders, scanPluginFolders } from '../plugins/folder.ts';
import { DEV_MODE } from '../settings/dev-mode.ts';
import { SITE } from '../site/namespace.ts';
import { messageOf } from '../util/errors.ts';
import type { ParsedArgs } from './args.ts';

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
    pluginSettle: resolved.pluginSettle,
  });
  return 0;
}

async function serveWorker(configPath: string | undefined): Promise<number> {
  const { processChannel, superviseWorker } = await import('../supervisor/worker.ts');
  const { createCms } = await import('../index.ts');
  const channel = processChannel();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => undefined);

  try {
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
    let announcement = '';
    if (await cms.settings.get(DEV_MODE.on)) {
      announcement +=
        'Dev mode is on: ActivityPub, webmentions, feed pings, IndexNow and email are held ' +
        'and recorded in data/dev-mode.jsonl. `geekity dev-mode off` takes the site live.\n';
    }
    announcement += `Geekity CMS is serving ${cms.config.baseUrl} on port ${String(port)}\n`;
    if (geminiPort !== undefined) {
      const host = geminiHost(cms.config, await cms.settings.values(SITE));
      announcement += `Gemini is on port ${String(geminiPort)} for ${host}\n`;
    }
    worker.serving(cms, announcement);
  } catch (error) {
    const message = messageOf(error);
    channel.send({ type: 'boot-failed', error: message }, () => process.exit(1));
  }
  return 0;
}
