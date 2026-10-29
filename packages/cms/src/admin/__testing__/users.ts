import { argon2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { USERS_FILE_MODE, findUser, usersFile, usersJsonText } from '../../site/users.ts';
import type { User, UserProfile, UsersFileContents } from '../../site/users.ts';
import { FIRST_ADMIN } from './harness.ts';

/** One account for {@link writeUsers}. */
export interface TestUser {
  username: string;
  id?: number;
  email?: string;
  /** Defaults to {@link FIRST_ADMIN}'s, so every account written can sign in. */
  password?: string;
  profile?: UserProfile;
  /** The id this person was published under elsewhere. */
  actorId?: string;
  createdAt?: string;
}

/**
 * Write `data/users.json` straight, for a site that already has its accounts
 * when it boots. Defaults to the first admin alone.
 *
 * Every user is an actor, so most federation, Micropub and comment tests need
 * accounts before the CMS starts, and the setup form only answers for a site
 * with none. Passwords are hashed with {@link cheapPasswordHash}.
 */
export function writeUsers(
  dataDir: string,
  users: readonly TestUser[] = [{ username: FIRST_ADMIN.username }],
): void {
  mkdirSync(dataDir, { recursive: true });

  const written = users.map((user, index) => ({
    id: user.id ?? index + 1,
    username: user.username,
    ...(user.email === undefined ? {} : { email: user.email }),
    ...(user.profile === undefined ? {} : { profile: user.profile }),
    ...(user.actorId === undefined ? {} : { actorId: user.actorId }),
    passwordHash: cheapPasswordHash(user.password ?? FIRST_ADMIN.password),
    createdAt: user.createdAt ?? '2026-01-01T00:00:00.000Z',
  }));

  writeFileSync(
    usersFile(dataDir),
    usersJsonText({
      users: written,
      nextId: written.reduce((top, user) => Math.max(top, user.id), 0) + 1,
    }),
    { mode: USERS_FILE_MODE },
  );
}

/**
 * Add one user to a site that may already have some, the way `createUser`
 * would, but with {@link cheapPasswordHash}. For a test whose subject is what
 * a second account sees or may do, not how an account is made.
 */
export function addUser(input: {
  dataDir: string;
  username: string;
  password: string;
  email?: string;
}): User {
  const file = usersFile(input.dataDir);
  const contents = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as UsersFileContents)
    : { users: [], nextId: 1 };
  mkdirSync(input.dataDir, { recursive: true });
  const added = {
    id: contents.nextId,
    username: input.username,
    ...(input.email === undefined ? {} : { email: input.email }),
    passwordHash: cheapPasswordHash(input.password),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(
    file,
    usersJsonText({ users: [...contents.users, added], nextId: contents.nextId + 1 }),
    { mode: USERS_FILE_MODE },
  );

  const user = findUser(input.dataDir, input.username);
  if (user === undefined) throw new Error(`${input.username} was not written.`);
  return user;
}

/**
 * A real argon2id hash of `password` at the smallest cost argon2 allows.
 *
 * Sign-in reads the cost out of the stored hash, so this verifies through the
 * same code as a production hash while costing a fraction of a millisecond
 * instead of tens of them.
 */
function cheapPasswordHash(password: string): string {
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
  const unpadded = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=8,t=1,p=1$${unpadded(salt)}$${unpadded(tag)}`;
}
