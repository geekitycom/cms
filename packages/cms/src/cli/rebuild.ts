import { databaseFile, discardDatabase } from '../cache.ts';
import { loadResolvedConfig } from '../config-loader.ts';
import type { ResolvedConfig } from '../config.ts';
import type { AdminStore } from '../store/admin-store.ts';
import type { ParsedArgs } from './args.ts';
import { databaseInUse } from './database-in-use.ts';
import { count } from './format.ts';

/**
 * `geekity rebuild`: throw the database away and read it back out of the files.
 *
 * Nothing in `data/geekity.db` is anything but a reading of `content/` and
 * `data/` (decision-9), so this is a command with no undo and no loss: the
 * content index, the followers, the inbox log and the comments come back
 * exactly as they were, and what does not — sessions, the cached delivery
 * outcomes, the relay handshake — is what a site is told it may lose. It is the
 * way past a database this version refuses to open, which is the other reason
 * it exists.
 *
 * The rebuild is the boot: after the file is gone, `createCms` applies the same
 * migrations and runs the same rebuilds boot runs, and `sync()`
 * is the same scan `serve()` does. Nothing here knows how to build an index,
 * which is what keeps a rebuilt database identical to a booted one.
 *
 * Watching is forced off for the reason `sync` forces it off: a one-shot
 * command that sat in a watcher would never exit.
 */
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

/** How many comments the files hold, whatever a moderator has done with them. */
function totalComments(admin: AdminStore): number {
  const counts = admin.countCommentsByStatus();
  return counts.pending + counts.approved + counts.spam;
}
