import { credentialProblem, emailProblem, passwordProblem } from '../admin/credentials.ts';
import { databaseFile } from '../cache.ts';
import { loadResolvedConfig } from '../config-loader.ts';
import { messageOf } from '../util/errors.ts';
import type { ParsedArgs } from './args.ts';
import { readPassword } from './password.ts';

const SUBCOMMANDS = 'add, password';

export async function userCommand(parsed: ParsedArgs): Promise<number> {
  const [subcommand, username] = parsed.args;
  if (subcommand === undefined) {
    throw new Error(`geekity user needs a subcommand. The subcommands are: ${SUBCOMMANDS}.`);
  }
  if (subcommand === 'add') {
    if (username === undefined) {
      throw new Error('geekity user add <username> needs the name of the user to create.');
    }
    return await addUser(username, parsed);
  }
  if (subcommand === 'password') {
    if (username === undefined) {
      throw new Error('geekity user password <username> needs the name of the user.');
    }
    return await changePassword(username, parsed);
  }
  throw new Error(`Unknown user subcommand "${subcommand}". The subcommands are: ${SUBCOMMANDS}.`);
}

async function addUser(
  username: string,
  { configPath, password: flagPassword, email: flagEmail }: ParsedArgs,
): Promise<number> {
  const password = await passwordFor(username, flagPassword);

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
        `${error.message} Pick another name, or set that user's password with ` +
          `geekity user password ${username}.\n`,
      );
      return 1;
    }
    throw error;
  } finally {
    admin.close();
  }
}

async function changePassword(
  username: string,
  { configPath, password: flagPassword }: ParsedArgs,
): Promise<number> {
  const config = await loadResolvedConfig(configPath);
  const { adminStoreOwning, openAdminDatabase } = await import('../store/admin-store.ts');
  const { migrateUsersToFile } = await import('../admin/legacy-migrations.ts');
  const { findUser, setUserPassword } = await import('../site/users.ts');
  const { revokeTokensForUser } = await import('../indieauth/tokens.ts');

  const adminDb = openAdminDatabase(config.dataDir, config.now);
  migrateUsersToFile(adminDb, config.dataDir);
  const admin = adminStoreOwning(adminDb, databaseFile(config.dataDir), config.now);

  try {
    const user = findUser(config.dataDir, username);
    if (user === undefined) {
      process.stderr.write(`There is no user named ${username}.\n`);
      return 1;
    }

    const password = await passwordFor(username, flagPassword);
    const problem = passwordProblem(password);
    if (problem !== undefined) {
      process.stderr.write(`${problem}\n`);
      return 1;
    }

    const now = config.now();
    // The new time on the user ends every session and reset link issued
    // before it, even ones a copy of the database brings back; deleting
    // the rows below only tidies what this connection can reach.
    await setUserPassword({ dataDir: config.dataDir, userId: user.id, password, now });
    const disconnected = await revokeTokensForUser(config.dataDir, user.id, now);
    let ended = 0;
    try {
      ended = admin.deleteSessionsForUser(user.id);
      admin.deletePasswordResetsForUser(user.id);
    } catch (error) {
      process.stderr.write(
        `Could not tidy the database (${messageOf(error)}); ${username}'s old sessions and ` +
          'reset links stop working anyway.\n',
      );
    }

    process.stdout.write(
      `Set a new password for ${user.username}. Ended ${plural(ended, 'session')} and ` +
        `disconnected ${plural(disconnected, 'app')}. Sign in at ${LOGIN_URL}.\n`,
    );
    return 0;
  } finally {
    admin.close();
  }
}

/** The password from the prompt or stdin, or from the flag with a warning. */
async function passwordFor(username: string, flagPassword: string | undefined): Promise<string> {
  if (flagPassword === undefined) {
    return await readPassword({ prompt: `Password for ${username}: ` });
  }
  process.stderr.write(
    'Warning: a password given with --password is visible in the process list and saved in ' +
      'shell history. Leave the flag off to be asked for it, or pipe it in on standard input.\n',
  );
  return flagPassword;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

const LOGIN_URL = '/admin/login';
