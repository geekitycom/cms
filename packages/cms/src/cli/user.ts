import { credentialProblem, emailProblem } from '../admin/credentials.ts';
import { databaseFile } from '../cache.ts';
import { loadResolvedConfig } from '../config-loader.ts';
import type { ParsedArgs } from './args.ts';
import { readPassword } from './password.ts';

/**
 * `geekity user add <username>`: create an admin without the setup screen.
 *
 * The other door into `data/users.json` is the first-run setup form, and this
 * one has to leave the same thing behind it, so both go through
 * {@link credentialProblem} rather than each carrying its own idea of a legal
 * username. The file is written under the config's `dataDir`, which is the
 * same one the server will read.
 *
 * The database is opened for one reason only: this is the one door that can
 * reach the users file before a server ever has, and a site upgrading from the
 * version that kept its accounts in SQLite would otherwise end up with a file
 * holding nobody but the user added here — which, the file winning, is what
 * the next boot would keep. So the same boot migration runs first.
 */
export async function userCommand({
  args,
  configPath,
  password: flagPassword,
  email: flagEmail,
}: ParsedArgs): Promise<number> {
  const subcommand = args[0];
  if (subcommand === undefined) {
    throw new Error('geekity user add <username> needs a subcommand. The only one is: add.');
  }
  if (subcommand !== 'add') {
    throw new Error(`Unknown user subcommand "${subcommand}". The only one is: add.`);
  }

  const username = args[1];
  if (username === undefined) {
    throw new Error('geekity user add <username> needs the name of the user to create.');
  }

  const password = flagPassword ?? (await readPassword({ prompt: `Password for ${username}: ` }));

  const email = (flagEmail ?? '').trim();
  const problem = credentialProblem(username, password) ?? emailProblem(email);
  if (problem !== undefined) {
    process.stderr.write(`${problem}\n`);
    return 1;
  }

  const config = await loadResolvedConfig(configPath);
  const { adminStoreOwning, openAdminDatabase } = await import('../store/admin-store.ts');
  const { migrateUsersToFile } = await import('../admin/legacy-migrations.ts');
  const { createUser, DuplicateUsernameError } = await import('../site/users.ts');
  const adminDb = openAdminDatabase(config.dataDir, config.now);
  migrateUsersToFile(adminDb, config.dataDir);
  const admin = adminStoreOwning(adminDb, databaseFile(config.dataDir), config.now);

  try {
    const user = await createUser({
      dataDir: config.dataDir,
      username,
      password,
      email,
      now: config.now(),
    });
    process.stdout.write(
      `Created admin user ${user.username}${
        user.email === undefined ? '' : ` (${user.email})`
      }. Sign in at ${LOGIN_URL}.\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof DuplicateUsernameError) {
      process.stderr.write(
        `${error.message} Pick another name, or change that user's password from the admin.\n`,
      );
      return 1;
    }
    throw error;
  } finally {
    admin.close();
  }
}

/** Where the success line points a new admin. Relative, because the host is the site's. */
const LOGIN_URL = '/admin/login';
