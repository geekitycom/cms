import { argon2Sync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { findUser, usersFile } from '../../site/users.ts';
import type { User, UserProfile } from '../../site/users.ts';

/**
 * Write `data/users.json` straight, without hashing a password.
 *
 * decision-14 makes every user an actor, so almost every federation test needs
 * accounts to exist *before* the CMS boots — a site with no users has no
 * actors, no keys to check and nothing to deliver. Going through `createUser`
 * would be one argon2 hash per account per test, which is seconds a suite does
 * not have to spend to prove something about ActivityPub.
 *
 * The hash written is a placeholder nobody can sign in with. A test that also
 * needs to *be* somebody names a `password`, which is hashed by
 * {@link cheapPasswordHash}: the setup form is no use here, because it only
 * answers for a site with no accounts at all and these sites are born with one.
 */
export function writeUsers(
  dataDir: string,
  users: readonly {
    username: string;
    id?: number;
    email?: string;
    password?: string;
    profile?: UserProfile;
    /** The id this person was published under elsewhere (TASK-69). */
    actorId?: string;
    createdAt?: string;
  }[],
): void {
  mkdirSync(dataDir, { recursive: true });

  const written = users.map((user, index) => ({
    id: user.id ?? index + 1,
    username: user.username,
    ...(user.email === undefined ? {} : { email: user.email }),
    ...(user.profile === undefined ? {} : { profile: user.profile }),
    ...(user.actorId === undefined ? {} : { actorId: user.actorId }),
    passwordHash: user.password === undefined ? 'not-a-hash' : cheapPasswordHash(user.password),
    createdAt: user.createdAt ?? '2026-01-01T00:00:00.000Z',
  }));

  writeFileSync(
    usersFile(dataDir),
    `${JSON.stringify(
      {
        users: written,
        nextId: written.reduce((top, user) => Math.max(top, user.id), 0) + 1,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
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
    ? (JSON.parse(readFileSync(file, 'utf8')) as { users: object[]; nextId: number })
    : { users: [], nextId: 1 };
  mkdirSync(input.dataDir, { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        users: [
          ...contents.users,
          {
            id: contents.nextId,
            username: input.username,
            ...(input.email === undefined ? {} : { email: input.email }),
            passwordHash: cheapPasswordHash(input.password),
            createdAt: new Date().toISOString(),
          },
        ],
        nextId: contents.nextId + 1,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
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
export function cheapPasswordHash(password: string): string {
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
