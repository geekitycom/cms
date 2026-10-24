import { loadResolvedConfig } from '../config-loader.ts';
import type { ParsedArgs } from './args.ts';

export async function syncCommand({ configPath }: ParsedArgs): Promise<number> {
  const { createCms } = await import('../index.ts');
  const cms = createCms(
    await loadResolvedConfig(configPath, (config) => ({ ...config, watch: false })),
  );

  try {
    const result = await cms.sync();
    process.stdout.write(
      `Scanned ${String(result.scanned)}: ${String(result.created)} created, ` +
        `${String(result.updated)} updated, ${String(result.removed)} removed, ` +
        `${String(result.unchanged)} unchanged, ${String(result.failed)} failed\n`,
    );

    if (result.failed > 0) {
      process.stderr.write(
        `${String(result.failed)} file${result.failed === 1 ? '' : 's'} could not be parsed and ` +
          `${result.failed === 1 ? 'was' : 'were'} left out of the index; the warnings above name ` +
          `${result.failed === 1 ? 'it' : 'them'}.\n`,
      );
      return 1;
    }
    return 0;
  } finally {
    await cms.close();
  }
}
