import path from 'node:path';

import { loadResolvedConfig } from '../config-loader.ts';
import { CONTENT_SCRATCH_FILES } from '../files/data-files.ts';
import { createSettings } from '../site/namespace.ts';
import { text } from './args.ts';
import type { ParsedArgs } from './args.ts';
import { count, table } from './format.ts';
import { loadSitePlugins } from './site-plugins.ts';

export async function exportCommand({ configPath, flags }: ParsedArgs): Promise<number> {
  const config = await loadResolvedConfig(configPath, (loaded) => ({ ...loaded, watch: false }));
  const settings = createSettings({ config });
  const plugins = await loadSitePlugins(config, settings);
  const { exportFileName, planSiteExport, writeSiteExport } =
    await import('../export/site-export.ts');
  const { siteDataFiles } = await import('../plugins/data.ts');

  if (flags['list'] === true) {
    const declarations = siteDataFiles({ dataDir: config.dataDir, settings, plugins });
    process.stdout.write(
      table([
        ...declarations.map((each) => [`data/${each.pattern}`, each.dataClass.kind, each.lost]),
        ['content/**', 'kept', 'The site: its documents, uploads and _data.'],
        ...CONTENT_SCRATCH_FILES.map((each) => [
          `content/${each.pattern}`,
          each.dataClass.kind,
          each.lost,
        ]),
      ]),
    );
    return 0;
  }

  const plan = await planSiteExport(
    { config, settings, plugins },
    {
      withCredentials: flags['with-credentials'] === true,
      withContent: flags['without-content'] !== true,
    },
  );
  const { deliveries } = plan.site.pending;
  process.stdout.write(
    `${count(deliveries, 'delivery is', 'deliveries are')} waiting in data/queue.sqlite. ` +
      'They are not exported: before a move, wait until none are.\n' +
      'The archive holds actor keys, password hashes and personal data. ' +
      'Store it as carefully as data/.\n',
  );

  const now = config.now();
  const out = path.resolve(text(flags, 'out') ?? exportFileName(config.baseUrl, now));
  const manifest = await writeSiteExport(plan, { out, now });

  for (const file of manifest.undeclared) {
    process.stderr.write(`Left out ${file}: no declaration says what it is.\n`);
  }
  for (const entry of manifest.notCarried) {
    process.stderr.write(
      `Left out ${entry.path}: it is ${entry.why}, and an export holds only regular files.\n`,
    );
  }
  if (manifest.credentialsLeftOut.length > 0) {
    process.stdout.write(
      `Credentials left out: ${manifest.credentialsLeftOut.join(', ')}. ` +
        '--with-credentials includes them.\n',
    );
  }
  const bytes = manifest.files.reduce((total, file) => total + file.size, 0);
  process.stdout.write(
    `Wrote ${out}: ${count(manifest.files.length, 'file')}, ${count(bytes, 'byte')}.\n`,
  );
  return 0;
}
