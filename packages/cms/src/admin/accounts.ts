import path from 'node:path';

import {
  readFileIfPresentSync,
  updateFileAtomically,
  writeFileAtomicallySync,
} from '../files/atomic.ts';
import { hashPassword, verifyPasswordHash } from './passwords.ts';
import type { AdminStore } from './store.ts';

/**
 * Who may sign in: `data/users.json`, and everything that reads or writes it.
 *
 * decision-9 puts every piece of irreducible state in a file, and a login is
 * as irreducible as state gets — an account cannot be derived from anything,
 * and a site that lost its users would fall back into first-run setup with the
 * door open to whoever reached it first. So the file is the truth and the
 * database is a cache: `data/geekity.db` may be deleted at rest, and the next
 * boot still knows exactly who may sign in.
 *
 * It lives in `data/` rather than `content/`, unlike `site.json`, because
 * `content/` is published with the site and in git, and an argon2 hash is not
 * something to hand a reader or a mirror. The file is written 0600 for the
 * same reason; it sits directly in `dataDir`, so there is no private directory
 * around it to lean on.
 *
 * Reads are synchronous and per call, exactly as `readSiteSettings` reads
 * `site.json` per call: the file is a few hundred bytes and nothing anywhere
 * can then be holding a stale copy of who exists. Writes go through
 * {@link updateFileAtomically}, which puts the read inside the same queue as
 * the write, so the uniqueness rule that used to be a `UNIQUE` index is
 * checked and acted on as one step.
 */

/** The file, relative to `dataDir`. */
export const USERS_FILE = 'users.json';

/** The permissions the file is written with: nobody but the site's own user. */
export const USERS_FILE_MODE = 0o600;

/** Where the users file lives for a given data directory. */
export function usersFile(dataDir: string): string {
  return path.join(dataDir, USERS_FILE);
}

/** An admin user. There is one role, so there is nothing else to say about one. */
export interface User {
  /** Its id, stable for the life of the user, and what a session names. */
  readonly id: number;
  /** Login name, unique and compared case sensitively. */
  readonly username: string;
  /** When the user was created, as an ISO 8601 instant. */
  readonly createdAt: string;
}

/** A user with the field no screen may render: its password hash. */
export interface StoredUser extends User {
  /** The PHC-encoded argon2id hash. */
  readonly passwordHash: string;
}

/** What {@link createUser} is given. */
export interface CreateUserInput {
  /** Which site's users file to add to. */
  dataDir: string;
  /** The name they will sign in with. Compared exactly, as it always was. */
  username: string;
  /** The plain password. It is hashed on the way in and never stored. */
  password: string;
}

/** Thrown when a username is already taken. Usernames are the login key. */
export class DuplicateUsernameError extends Error {
  override readonly name = 'DuplicateUsernameError';
  /** The name that was already in use. */
  readonly username: string;

  constructor(username: string) {
    super(`A user named "${username}" already exists.`);
    this.username = username;
  }
}

/**
 * Every user, by name, without password hashes.
 *
 * Sorted by code unit rather than by locale, which is how the `ORDER BY
 * username` over a `BINARY` column this replaces sorted them: a listing that
 * changed order with the server's locale would be a listing nobody could
 * describe.
 */
export function listUsers(dataDir: string): User[] {
  return readUsersFile(dataDir)
    .users.map(withoutHash)
    .sort((one, other) =>
      one.username < other.username ? -1 : one.username > other.username ? 1 : 0,
    );
}

/** How many users exist. Zero is what puts the admin into first-run setup. */
export function countUsers(dataDir: string): number {
  return readUsersFile(dataDir).users.length;
}

/**
 * One user with its password hash, or `undefined`. For auth, not for screens.
 */
export function findUser(dataDir: string, username: string): StoredUser | undefined {
  return readUsersFile(dataDir).users.find((user) => user.username === username);
}

/** The user behind a session's `userId`, or `undefined`. */
export function findUserById(dataDir: string, id: number): User | undefined {
  const found = readUsersFile(dataDir).users.find((user) => user.id === id);
  return found === undefined ? undefined : withoutHash(found);
}

/**
 * Hash the password and add the user to the file.
 *
 * Throws {@link DuplicateUsernameError} when the name is taken. The check is
 * inside the write, not before it, which is what makes it the rule the
 * `UNIQUE` index used to be: two requests adding the same name at the same
 * moment queue behind one another on the file, so the second one reads the
 * first one's work and is refused.
 */
export async function createUser(input: CreateUserInput): Promise<User> {
  const hash = hashPassword(input.password);
  let created: StoredUser | undefined;

  await write(input.dataDir, (contents) => {
    if (contents.users.some((user) => user.username === input.username)) {
      throw new DuplicateUsernameError(input.username);
    }
    created = {
      id: contents.nextId,
      username: input.username,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    };
    return { users: [...contents.users, created], nextId: contents.nextId + 1 };
  });

  // `write` either threw or ran the callback, so this is only unreachable.
  if (created === undefined) throw new Error('The user was not written.');
  return withoutHash(created);
}

/**
 * Hash a new password and put it on a user, replacing the old one. Returns
 * `false` when there is no such user. Sessions are left alone; deciding which
 * of them a password change should end is the caller's business.
 */
export async function setUserPassword(input: {
  /** Which site's users file to write. */
  dataDir: string;
  /** Whose password. */
  userId: number;
  /** The new plain password, hashed on the way in. */
  password: string;
}): Promise<boolean> {
  // Hashed before the write rather than inside it, so a hash that throws
  // leaves the stored one alone.
  const hash = hashPassword(input.password);
  let changed = false;

  await write(input.dataDir, (contents) => {
    changed = contents.users.some((user) => user.id === input.userId);
    return {
      ...contents,
      users: contents.users.map((user) =>
        user.id === input.userId ? { ...user, passwordHash: hash } : user,
      ),
    };
  });

  return changed;
}

/**
 * Take a user out of the file. Returns `false` when there was nothing to take.
 *
 * Their sessions are not ended here: sessions are in the database, and the
 * screen that deletes a user ends them itself. A session that outlives this —
 * one in a database restored from a backup, say — names a user the file no
 * longer holds, and the admin guard turns that into no session at all.
 */
export async function deleteUser(input: { dataDir: string; userId: number }): Promise<boolean> {
  let deleted = false;

  await write(input.dataDir, (contents) => {
    deleted = contents.users.some((user) => user.id === input.userId);
    return { ...contents, users: contents.users.filter((user) => user.id !== input.userId) };
  });

  return deleted;
}

/**
 * The user, when the password is theirs; `undefined` when it is not, or when
 * there is no such user. The two failures are deliberately indistinguishable.
 */
export function verifyUserPassword(
  dataDir: string,
  username: string,
  password: string,
): User | undefined {
  const user = findUser(dataDir, username);
  if (user === undefined) {
    // Hash anyway, so a missing user and a wrong password take the same time
    // and the login form does not become a user enumerator.
    verifyPasswordHash(DUMMY_HASH, password);
    return undefined;
  }
  if (!verifyPasswordHash(user.passwordHash, password)) return undefined;
  return withoutHash(user);
}

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

/** A user as a screen may render it: everything but the hash. */
function withoutHash(user: StoredUser): User {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

/**
 * A hash of a password no user has, so a login attempt for an unknown
 * username costs the same as one for a known name with the wrong password.
 */
const DUMMY_HASH = hashPassword(
  'a password no user has, hashed once so that verification is constant time',
);

/** The file as it is on disk: the users, and the next id to hand out. */
interface UsersFileContents {
  /** Everyone who may sign in, in the order the file lists them. */
  users: StoredUser[];
  /**
   * The id the next user gets.
   *
   * Kept rather than derived from the highest id in use, so that deleting a
   * user and adding another never hands the new one the old one's id: a
   * session, or anything else naming a user by id, can then only ever mean the
   * person it was written for.
   */
  nextId: number;
}

/** The bytes of the file, as it is written. */
function usersJsonText(contents: UsersFileContents): string {
  return `${JSON.stringify(contents, null, 2)}\n`;
}

/**
 * The file's contents, or an empty set of users when it is not there.
 *
 * A file that is there and will not parse throws rather than reading as empty,
 * and that is the whole point of the strictness: no users means first-run
 * setup, where the next person to reach `/admin` becomes the site's admin. A
 * damaged file has to be a loud failure, never an open door.
 */
function readUsersFile(dataDir: string): UsersFileContents {
  const file = usersFile(dataDir);
  return parseUsersFile(readFileIfPresentSync(file), file);
}

/** The same, from bytes already in hand: `undefined` is a file that is not there. */
function parseUsersFile(source: string | undefined, file: string): UsersFileContents {
  if (source === undefined) return { users: [], nextId: 1 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw unusableUsersFile(file, error);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw unusableUsersFile(file, new Error('It is not a JSON object.'));
  }

  const listed: unknown = (parsed as Record<string, unknown>)['users'];
  if (!Array.isArray(listed)) {
    throw unusableUsersFile(file, new Error('It has no "users" array.'));
  }

  const users = listed.map((entry, index) => userFrom(entry, index, file));
  const stated = (parsed as Record<string, unknown>)['nextId'];
  const highest = users.reduce((top, user) => Math.max(top, user.id), 0);

  // The stated `nextId` is the rule, but never one that would collide: a file
  // edited by hand, or one written before this field existed, still hands out
  // an id nobody has.
  return {
    users,
    nextId: Math.max(
      typeof stated === 'number' && stated > 0 ? Math.trunc(stated) : 1,
      highest + 1,
    ),
  };
}

/** One entry of the file as a user, or a refusal naming which entry is wrong. */
function userFrom(entry: unknown, index: number, file: string): StoredUser {
  const where = `Entry ${String(index + 1)} of "users"`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw unusableUsersFile(file, new Error(`${where} is not an object.`));
  }

  const record = entry as Record<string, unknown>;
  const id = record['id'];
  const username = record['username'];
  const passwordHash = record['passwordHash'];
  const createdAt = record['createdAt'];

  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    throw unusableUsersFile(file, new Error(`${where} has no id.`));
  }
  if (typeof username !== 'string' || username === '') {
    throw unusableUsersFile(file, new Error(`${where} has no username.`));
  }
  if (typeof passwordHash !== 'string' || passwordHash === '') {
    throw unusableUsersFile(file, new Error(`${where} has no password hash.`));
  }

  return {
    id,
    username,
    passwordHash,
    createdAt: typeof createdAt === 'string' ? createdAt : '',
  };
}

/** What a damaged users file says, and what to do about it. */
function unusableUsersFile(file: string, cause: unknown): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `The users file ${file} could not be read: ${reason} It has deliberately not been ` +
      'replaced, because a site with no users offers first-run setup to whoever reaches it ' +
      'first. Restore the file from a backup, or delete it on purpose to start again.',
  );
}

/** Read the file, decide what it should say next, and write it, as one step. */
function write(
  dataDir: string,
  produce: (contents: UsersFileContents) => UsersFileContents,
): Promise<void> {
  const file = usersFile(dataDir);
  return updateFileAtomically(
    file,
    (current) => usersJsonText(produce(parseUsersFile(current, file))),
    { mode: USERS_FILE_MODE },
  );
}
