import { readFileIfPresentSync, writeFileAtomicallySync } from '../files/atomic.ts';
import { USERS_FILE_MODE, usersFile, usersJsonText } from '../site/users.ts';
import type { AdminStore } from './store.ts';

/**
 * Turn an older site's users rows into `data/users.json`, once, and drop the
 * table.
 *
 * TASK-9 put the accounts in SQLite; decision-9 made the database disposable,
 * and a site upgrading across the two has rows nothing would ever read again.
 * So the first boot of this version writes them out — ids and hashes exactly
 * as they stand, because a session names its user by id and a hash is not
 * something to re-encode on the way past.
 *
 * The file wins, as it does everywhere else: a `users.json` that is already
 * there is left alone, so a database restored from a backup taken before the
 * upgrade cannot bring deleted accounts back or undo a password change. The
 * table is dropped either way, because a fresh database gets it from migration
 * 1 — which has shipped, and so is never edited — and a site that has been
 * migrated must not be asked again.
 *
 * Synchronous because `createCms` is: it runs before the server is listening
 * and before anything else has touched the file.
 */
export function migrateUsersToFile(options: { admin: AdminStore; dataDir: string }): void {
  const { admin, dataDir } = options;
  const rows = admin.legacyUsers();
  const file = usersFile(dataDir);

  if (rows !== undefined && rows.length > 0 && readFileIfPresentSync(file) === undefined) {
    const users = rows.map((row) => ({
      id: row.id,
      username: row.username,
      passwordHash: row.passwordHash,
      createdAt: row.createdAt,
    }));
    const highest = users.reduce((top, user) => Math.max(top, user.id), 0);
    writeFileAtomicallySync(file, usersJsonText({ users, nextId: highest + 1 }), {
      mode: USERS_FILE_MODE,
    });
  }

  admin.dropLegacyTable('users');
}
