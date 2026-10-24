import { databaseFile, discardDatabase } from '../cache.ts';
import { loadResolvedConfig } from '../config-loader.ts';
import type { ResolvedConfig } from '../config.ts';
import type { AdminStore } from '../store/admin-store.ts';
import type { ParsedArgs } from './args.ts';
import { databaseInUse } from './database-in-use.ts';
import { count } from './format.ts';

export async function rebuildCommand({ configPath }: ParsedArgs): Promise<number> {
  const config = await loadResolvedConfig(configPath, (loaded) => ({ ...loaded, watch: false }));
  const file = databaseFile(config.dataDir);

  if (databaseInUse(config.dataDir)) {
    process.stderr.write(
      `${file} is in use: something else has it open, most likely the site itself. Stop the ` +
        'server and run this again — deleting the database under a running one would leave it ' +
        'writing to a file nothing can find.\n',
    );
    return 1;
  }

  return (await rebuildDatabase(config)) > 0 ? 1 : 0;
}

export async function rebuildDatabase(config: ResolvedConfig): Promise<number> {
  discardDatabase(config.dataDir);

  const { createCms } = await import('../index.ts');
  const cms = createCms(config);
  try {
    const result = await cms.sync();
    process.stdout.write(
      `Rebuilt ${databaseFile(config.dataDir)} from the files.\n` +
        `Scanned ${String(result.scanned)}: ${String(result.created)} created, ` +
        `${String(result.updated)} updated, ${String(result.removed)} removed, ` +
        `${String(result.unchanged)} unchanged, ${String(result.failed)} failed\n` +
        `Indexed ${count(cms.admin.countFollowers(), 'follower')}, ` +
        `${count(cms.admin.countInboxActivities(), 'inbox activity', 'inbox activities')} and ` +
        `${count(totalComments(cms.admin), 'comment')}.\n`,
    );

    if (result.failed > 0) {
      process.stderr.write(
        `${String(result.failed)} file${result.failed === 1 ? '' : 's'} could not be parsed and ` +
          `${result.failed === 1 ? 'was' : 'were'} left out of the index; the warnings above name ` +
          `${result.failed === 1 ? 'it' : 'them'}.\n`,
      );
    }
    return result.failed;
  } finally {
    await cms.close();
  }
}

function totalComments(admin: AdminStore): number {
  const counts = admin.countCommentsByStatus();
  return counts.pending + counts.approved + counts.spam;
}
