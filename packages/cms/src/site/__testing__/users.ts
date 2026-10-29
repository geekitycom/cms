import { mkdirSync, writeFileSync } from 'node:fs';

import { FIRST_ADMIN } from '../../admin/__testing__/harness.ts';
import { usersFile, usersJsonText } from '../users.ts';
import type { UserProfile } from '../users.ts';

/**
 * {@link FIRST_ADMIN}'s password hashed at argon2id's minimum cost.
 *
 * The parameters travel in the hash, so signing in with it checks the password
 * for real in well under a millisecond, where the production cost is tens of
 * milliseconds a test spends on nothing it asserts.
 */
const FIRST_ADMIN_HASH =
  '$argon2id$v=19$m=8,t=1,p=1$Z2Vla2l0eS10ZXN0LXNhbA$NsFbSo8eArho8Bui32EukJ/FbrTl8bMJovDFMH9DCbQ';

export interface SignInUser {
  username: string;
  email?: string;
  profile?: UserProfile;
}

/**
 * Write `users.json` with `users`, ids from 1 in order, every one of whom signs
 * in with {@link FIRST_ADMIN}'s password. Defaults to the first admin alone.
 *
 * Call before the site boots, as for a site that already has its accounts.
 */
export function writeSignInUsers(
  dataDir: string,
  users: readonly SignInUser[] = [{ username: FIRST_ADMIN.username }],
): void {
  mkdirSync(dataDir, { recursive: true });
  const written = users.map((user, index) => ({
    id: index + 1,
    ...user,
    passwordHash: FIRST_ADMIN_HASH,
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
  writeFileSync(usersFile(dataDir), usersJsonText({ users: written, nextId: written.length + 1 }), {
    mode: 0o600,
  });
}
