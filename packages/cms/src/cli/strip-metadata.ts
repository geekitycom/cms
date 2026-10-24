import { loadResolvedConfig } from '../config-loader.ts';
import type { ParsedArgs } from './args.ts';
import { count } from './format.ts';
import { runJobHere } from './run-job.ts';

export async function stripMetadataCommand({ configPath }: ParsedArgs): Promise<number> {
  const config = await loadResolvedConfig(configPath, (loaded) => ({ ...loaded, watch: false }));
  const { STRIP_METADATA_JOB } = await import('../content/metadata/strip-job.ts');
  const report = await runJobHere(config, STRIP_METADATA_JOB, null, 'sweep');
  if (report === undefined) return 1;

  for (const file of report.stripped) {
    process.stdout.write(`${file.path}: removed ${file.removed.join(', ')}\n`);
  }
  for (const file of report.unreadable) {
    process.stderr.write(`${file.path}: ${file.problem} Left as it was.\n`);
  }
  process.stdout.write(
    `Checked ${count(report.checked, 'file')}: ${String(report.stripped.length)} stripped, ` +
      `${String(report.clean)} already clean, ${String(report.unreadable.length)} unreadable\n`,
  );
  return report.unreadable.length === 0 ? 0 : 1;
}
