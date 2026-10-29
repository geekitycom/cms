import { argon2Sync, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { FIRST_ADMIN, signIn } from '../../admin/__testing__/harness.ts';
import type { Browser } from '../../admin/__testing__/harness.ts';
import type { Cms } from '../../index.ts';
import { USERS_FILE_MODE, usersFile, usersJsonText } from '../../site/users.ts';
import type { CreateUserInput, User, UsersFileContents } from '../../site/users.ts';

/**
 * `createUser` from `site/users.ts`, for a test, at a fraction of the cost.
 *
 * The real one hashes at the production argon2id costs, tens of milliseconds a
 * user, and the pages these tests read only care that the user exists. The
 * hash written here is a real argon2id PHC string at the smallest costs the
 * algorithm allows, and the verifier reads the costs out of the string, so a
 * test can still sign in with the password it named.
 */
export async function createUser(input: CreateUserInput): Promise<User> {
  const file = usersFile(input.dataDir);
  const contents = await readFile(file, 'utf8').then(
    (text) => JSON.parse(text) as UsersFileContents,
    () => ({ users: [], nextId: 1 }),
  );

  const user: User = {
    id: contents.nextId,
    username: input.username,
    ...(input.email === undefined || input.email === '' ? {} : { email: input.email }),
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  const stored = { ...user, passwordHash: cheapHash(input.password) };

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    usersJsonText({ users: [...contents.users, stored], nextId: contents.nextId + 1 }),
    { mode: USERS_FILE_MODE },
  );
  return user;
}

/**
 * The harness's `signedIn`, without its production-cost hash: the first admin
 * is written with {@link createUser} and signs in through the login form, which
 * is where the setup form leaves them too.
 */
export async function signedIn(cms: Cms): Promise<Browser> {
  await createUser({ dataDir: cms.config.dataDir, ...FIRST_ADMIN, now: cms.config.now() });
  return signIn(cms);
}

function cheapHash(password: string): string {
  const salt = randomBytes(16);
  const tag = Buffer.from(
    argon2Sync('argon2id', {
      message: Buffer.from(password, 'utf8'),
      nonce: salt,
      memory: 8,
      passes: 1,
      parallelism: 1,
      tagLength: 32,
    }),
  );
  const base64 = (value: Buffer): string => value.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=8,t=1,p=1$${base64(salt)}$${base64(tag)}`;
}
