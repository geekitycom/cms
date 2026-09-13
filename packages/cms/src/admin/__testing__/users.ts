import { mkdirSync, writeFileSync } from 'node:fs';

import { usersFile } from '../accounts.ts';
import type { UserProfile } from '../accounts.ts';
import { hashPassword } from '../passwords.ts';

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
 * needs to *be* somebody names a `password`, which is hashed properly and
 * costs one argon2 run: the setup form is no use here, because it only answers
 * for a site with no accounts at all and these sites are born with one.
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
    /** The number the WordPress ActivityPub plugin gave their actor (TASK-70). */
    wordpressActorId?: number;
  }[],
): void {
  mkdirSync(dataDir, { recursive: true });

  const written = users.map((user, index) => ({
    id: user.id ?? index + 1,
    username: user.username,
    ...(user.email === undefined ? {} : { email: user.email }),
    ...(user.profile === undefined ? {} : { profile: user.profile }),
    ...(user.actorId === undefined ? {} : { actorId: user.actorId }),
    ...(user.wordpressActorId === undefined ? {} : { wordpressActorId: user.wordpressActorId }),
    passwordHash: user.password === undefined ? 'not-a-hash' : hashPassword(user.password),
    createdAt: '2026-01-01T00:00:00.000Z',
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
