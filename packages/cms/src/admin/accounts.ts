import path from 'node:path';

import {
  readFileIfPresentSync,
  updateFileAtomically,
  writeFileAtomicallySync,
} from '../files/atomic.ts';
import {
  deliveryMode,
  notificationEvent,
  withNotification,
  withNotificationMode,
} from '../notifications/preferences.ts';
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
  /**
   * Where the site can reach this person, or `undefined` when nobody has said.
   *
   * Optional on purpose (TASK-54): a login is a username and a password, and a
   * site that never sends email has no use for this. What it buys is a
   * password that can be recovered without a shell, and, once TASK-55 lands,
   * somewhere to send the notices an admin would otherwise have to go looking
   * for. Not unique, and not a second login name: it is only ever matched
   * against by the forgot-password form, which answers the same either way.
   */
  readonly email?: string | undefined;
  /**
   * Which notices this user has turned off, when they have turned any off
   * (TASK-55).
   *
   * Absent for almost everybody, because it holds only what somebody actually
   * changed: an event nothing says anything about is at the default
   * `src/notifications/preferences.ts` gives it, which is what lets a new
   * notice start working without anybody visiting the users screen. Keyed by
   * event name, so adding an event adds no field here.
   */
  readonly notifications?: Readonly<Record<string, boolean>> | undefined;
  /**
   * How often each notice arrives, for the events that offer a choice and the
   * users who have made one (TASK-60).
   *
   * A second map beside {@link User.notifications} rather than a widening of
   * it, because the two answer different questions — whether, and how often —
   * and a user who wants no notice at all is not a user with a delivery mode.
   * Absent for almost everybody, on the same rule: `immediately` is the
   * default and the default is never written down. Keyed by event name, so
   * adding an event adds no field here either.
   */
  readonly notificationModes?: Readonly<Record<string, string>> | undefined;
  /**
   * What the public site says about this person, when somebody has filled any
   * of it in (TASK-67).
   *
   * decision-14 makes a user an actor at their author URL, so the URL has to
   * be a page before it can be an actor, and a page needs something to say.
   * Absent for a user nobody has written a profile for, on the rule the two
   * maps above follow: the file holds what somebody actually filled in, and a
   * user with no profile still has an archive under their username.
   */
  readonly profile?: UserProfile | undefined;
  /**
   * The ActivityStreams id this person was published under somewhere else,
   * when they were (TASK-69).
   *
   * decision-14 calls this identity rather than cache: a follower's server
   * keys the account by it for as long as the follow lasts, and a document
   * served under it with a different `id` reads as a different person, not as
   * a moved one. So a site arriving from the WordPress ActivityPub plugin
   * keeps the `https://example.com/?author=2` its followers already hold, for
   * the life of the user.
   *
   * The CMS never mints one — a user born here is an actor at their author URL
   * and has no second name to keep — and no screen writes one: it arrives with
   * the import (TASK-71) or is typed into the file by hand. The whole URL is
   * stored, query string and all, because that is what has to be matched.
   */
  readonly actorId?: string | undefined;
  /**
   * The number the WordPress ActivityPub plugin gave this person's actor, when
   * they had one (TASK-70).
   *
   * The WordPress user id, which is what the plugin puts in the paths it
   * publishes: `/wp-json/activitypub/1.0/actors/2/inbox` is user 2. Unlike
   * {@link User.actorId} this is cache rather than identity — a follower's
   * server replaces those paths the next time it refetches the actor — so it
   * is only ever read behind the `wordpressActivityPub` site setting, and it
   * is what maps a delivery arriving at one of those paths to a person.
   *
   * The CMS never mints one. It arrives with the import (TASK-71) or is typed
   * into the file by hand, beside the stored actor id the same migration sets.
   */
  readonly wordpressActorId?: number | undefined;
  /** When the user was created, as an ISO 8601 instant. */
  readonly createdAt: string;
}

/**
 * One thing a profile points at: somewhere else this person is.
 *
 * A label and a URL rather than a bare URL, because the label is what a theme
 * prints and what an ActivityPub `attachment` calls the property (TASK-68).
 */
export interface ProfileLink {
  /** What the link says. */
  readonly label: string;
  /** Where it goes. */
  readonly href: string;
}

/**
 * The public face of a user: what their archive is headed with and what their
 * actor will carry.
 *
 * Every field is optional, and one that is empty is not stored at all: a
 * profile is something somebody chose to write, and a user who has written
 * none of it is not a user with four empty strings.
 */
export interface UserProfile {
  /** The name to print instead of the username, when they gave one. */
  readonly displayName?: string | undefined;
  /** A few sentences about them. */
  readonly bio?: string | undefined;
  /** A picture, as the path or URL it is served at. */
  readonly avatar?: string | undefined;
  /** Somewhere else they are, in the order they listed them. */
  readonly links?: readonly ProfileLink[] | undefined;
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
  /** Where to reach them. Left off, or empty, is a user with no email. */
  email?: string | undefined;
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

/**
 * The site's first account: the lowest id, which is the one the first run
 * made.
 *
 * decision-14 leaves the site with no actor of its own, and two things still
 * have to be somebody's: a relay subscription, which is an instance-wide
 * agreement rather than one person's, and a post whose `author` names nobody
 * this site knows. Both fall to the first account, because a site's first
 * account is the one that has always existed and the only one that can be
 * chosen without asking. `undefined` before anybody has signed up, which is
 * first-run setup and federates nothing.
 */
export function primaryUser(dataDir: string): User | undefined {
  return readUsersFile(dataDir)
    .users.map(withoutHash)
    .reduce<User | undefined>(
      (lowest, user) => (lowest === undefined || user.id < lowest.id ? user : lowest),
      undefined,
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
 * The user a forgot-password form named, by either of the two things somebody
 * might type: their username or their email address.
 *
 * The username is compared exactly, because that is how logging in compares it
 * and a second, looser rule would let one person's name match another's
 * account. The email is folded to lower case on both sides, because an address
 * is case-insensitive in practice and nobody remembers how they capitalised
 * one. A user is matched by username first, so a site where somebody's address
 * happens to be another person's username still resolves the way logging in
 * would. The empty string matches nobody, however many users have no email.
 */
export function findUserByIdentifier(dataDir: string, identifier: string): User | undefined {
  const wanted = identifier.trim();
  if (wanted === '') return undefined;

  const { users } = readUsersFile(dataDir);
  const folded = wanted.toLowerCase();
  const found =
    users.find((user) => user.username === wanted) ??
    users.find((user) => user.email !== undefined && user.email.toLowerCase() === folded);

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
  const email = (input.email ?? '').trim();
  let created: StoredUser | undefined;

  await write(input.dataDir, (contents) => {
    if (contents.users.some((user) => user.username === input.username)) {
      throw new DuplicateUsernameError(input.username);
    }
    created = {
      id: contents.nextId,
      username: input.username,
      // Absent rather than empty, so a user with no email has no key for one
      // and the file says only what somebody actually filled in.
      ...(email === '' ? {} : { email }),
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
 * Put an email address on a user, or take the one they had off.
 *
 * The empty string is how an address is removed, so one form field can do
 * both: a box somebody cleared means "I do not want to be emailed", and there
 * is nothing else it could mean. Returns `false` when there is no such user.
 * The address is stored as it was typed, capitals and all — it is what a
 * message is addressed to, and only the matching is case-insensitive.
 */
export async function setUserEmail(input: {
  /** Which site's users file to write. */
  dataDir: string;
  /** Whose address. */
  userId: number;
  /** The address, or the empty string to remove it. */
  email: string;
}): Promise<boolean> {
  const email = input.email.trim();
  let changed = false;

  await write(input.dataDir, (contents) => {
    changed = contents.users.some((user) => user.id === input.userId);
    return {
      ...contents,
      users: contents.users.map((user) => {
        if (user.id !== input.userId) return user;
        const { email: _removed, ...rest } = user;
        return email === '' ? rest : { ...rest, email };
      }),
    };
  });

  return changed;
}

/**
 * Write a user's profile, replacing whatever was there.
 *
 * The whole profile at once rather than a field at a time, because that is
 * what the form on the users screen submits: four boxes and a Save, and a
 * field somebody cleared is a field they no longer want. {@link cleanProfile}
 * drops the empties, so a profile with nothing left in it leaves the user with
 * no `profile` key rather than with an empty object. Returns `false` when
 * there is no such user.
 */
export async function setUserProfile(input: {
  /** Which site's users file to write. */
  dataDir: string;
  /** Whose profile. */
  userId: number;
  /** Everything the profile should say from now on. */
  profile: UserProfile;
}): Promise<boolean> {
  const next = cleanProfile(input.profile);
  let changed = false;

  await write(input.dataDir, (contents) => {
    changed = contents.users.some((user) => user.id === input.userId);
    return {
      ...contents,
      users: contents.users.map((user) => {
        if (user.id !== input.userId) return user;
        const { profile: _removed, ...rest } = user;
        return next === undefined ? rest : { ...rest, profile: next };
      }),
    };
  });

  return changed;
}

/**
 * A profile with the empties taken out, or `undefined` when nothing is left.
 *
 * Trimming here rather than at the form is what makes a hand-edited file and a
 * saved one read the same: a bio of three spaces is a bio nobody wrote, and a
 * link with no URL is not somewhere this person is.
 */
export function cleanProfile(profile: UserProfile): UserProfile | undefined {
  const displayName = (profile.displayName ?? '').trim();
  const bio = (profile.bio ?? '').trim();
  const avatar = (profile.avatar ?? '').trim();
  const links = (profile.links ?? [])
    .map((link) => ({ label: link.label.trim(), href: link.href.trim() }))
    // A link needs somewhere to go; a label it does not have is the URL again,
    // because a list of blank links is worse than a list of bare addresses.
    .filter((link) => link.href !== '')
    .map((link) => (link.label === '' ? { label: link.href, href: link.href } : link));

  const cleaned: UserProfile = {
    ...(displayName === '' ? {} : { displayName }),
    ...(bio === '' ? {} : { bio }),
    ...(avatar === '' ? {} : { avatar }),
    ...(links.length === 0 ? {} : { links }),
  };

  return Object.keys(cleaned).length === 0 ? undefined : cleaned;
}

/**
 * Turn one notice on or off for one user.
 *
 * The map holds only what somebody changed, so this writes through
 * {@link withNotification} and drops the key altogether when the answer is the
 * default again. An event this version has never heard of changes nothing:
 * there would be no switch to reach it with and no sender to read it. Returns
 * `false` when there is no such user.
 */
export async function setUserNotification(input: {
  /** Which site's users file to write. */
  dataDir: string;
  /** Whose preference. */
  userId: number;
  /** Which notice, by its name in the registry. */
  event: string;
  /** Whether they want it. */
  on: boolean;
}): Promise<boolean> {
  let changed = false;

  await write(input.dataDir, (contents) => {
    changed = contents.users.some((user) => user.id === input.userId);
    return {
      ...contents,
      users: contents.users.map((user) => {
        if (user.id !== input.userId) return user;
        const { notifications: _removed, ...rest } = user;
        const next = withNotification(user.notifications, input.event, input.on);
        return next === undefined ? rest : { ...rest, notifications: next };
      }),
    };
  });

  return changed;
}

/**
 * Say how often one notice reaches one user.
 *
 * The twin of {@link setUserNotification}, and it writes on the same rule:
 * through {@link withNotificationMode}, which drops the key when the answer is
 * the default again, when the mode is one this version does not know, and when
 * the event does not offer a choice at all. So a form submitting nonsense
 * leaves the file saying nothing rather than saying something unreachable.
 * Returns `false` when there is no such user.
 */
export async function setUserNotificationMode(input: {
  /** Which site's users file to write. */
  dataDir: string;
  /** Whose preference. */
  userId: number;
  /** Which notice, by its name in the registry. */
  event: string;
  /** How often they want it. */
  mode: string;
}): Promise<boolean> {
  let changed = false;

  await write(input.dataDir, (contents) => {
    changed = contents.users.some((user) => user.id === input.userId);
    return {
      ...contents,
      users: contents.users.map((user) => {
        if (user.id !== input.userId) return user;
        const { notificationModes: _removed, ...rest } = user;
        const next = withNotificationMode(user.notificationModes, input.event, input.mode);
        return next === undefined ? rest : { ...rest, notificationModes: next };
      }),
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
  return {
    id: user.id,
    username: user.username,
    ...(user.email === undefined ? {} : { email: user.email }),
    ...(user.notifications === undefined ? {} : { notifications: user.notifications }),
    ...(user.notificationModes === undefined ? {} : { notificationModes: user.notificationModes }),
    ...(user.profile === undefined ? {} : { profile: user.profile }),
    ...(user.actorId === undefined ? {} : { actorId: user.actorId }),
    ...(user.wordpressActorId === undefined ? {} : { wordpressActorId: user.wordpressActorId }),
    createdAt: user.createdAt,
  };
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
  const email = record['email'];
  const preferences = notificationsFrom(record['notifications']);
  const modes = notificationModesFrom(record['notificationModes']);
  const profile = profileFrom(record['profile']);
  const actorId = storedActorIdFrom(record['actorId']);
  const wordpressActorId = wordpressActorIdFrom(record['wordpressActorId']);
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
    // Unlike the three above, a bad email is dropped rather than refused: it
    // is not what anybody signs in with, and a site whose whole admin refused
    // to load over a mistyped address would be a worse failure than the one it
    // is guarding against.
    ...(typeof email === 'string' && email.trim() !== '' ? { email: email.trim() } : {}),
    // Dropped rather than refused for the reason a bad email is: a preference
    // is not what anybody signs in with, and an admin that would not load over
    // a mistyped one would be the worse failure. A key naming an event this
    // version does not know is left out too, so a file written by a newer
    // version is read as far as it makes sense.
    ...(preferences === undefined ? {} : { notifications: preferences }),
    // Dropped on the same rule, and once more for a mode this version does not
    // know: a stored `weekly` from a later version is read as the default
    // rather than as a window nothing here could wait for.
    ...(modes === undefined ? {} : { notificationModes: modes }),
    // Dropped field by field on the same rule, and for the sharper reason that
    // a profile is prose somebody may well have typed straight into the file:
    // a bio that is a number is not a bio, and refusing to load the users file
    // over one would take the whole admin down.
    ...(profile === undefined ? {} : { profile }),
    // Dropped rather than refused on the same rule again, and one more of its
    // own: an id that is not a URL could never be requested, so keeping it
    // would change nothing except to make a person's actor unreadable.
    ...(actorId === undefined ? {} : { actorId }),
    // And once more: a WordPress id that is not a whole positive number could
    // never appear in one of the plugin's paths, so keeping it would only make
    // the compatibility switch answer for a route nobody asks for.
    ...(wordpressActorId === undefined ? {} : { wordpressActorId }),
    passwordHash,
    createdAt: typeof createdAt === 'string' ? createdAt : '',
  };
}

/**
 * A stored profile as this version reads it, or `undefined` when it says
 * nothing usable.
 *
 * Read through the same {@link cleanProfile} a save goes through, so a file
 * written by hand and one written by the users screen are read identically:
 * whitespace is trimmed, an empty field is no field, and a link with no URL is
 * no link.
 */
function profileFrom(value: unknown): UserProfile | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;

  return cleanProfile({
    ...optionalText('displayName', record['displayName']),
    ...optionalText('bio', record['bio']),
    ...optionalText('avatar', record['avatar']),
    links: linksFrom(record['links']),
  });
}

/**
 * A stored actor id as this version reads it, or `undefined` when the file
 * says nothing usable.
 *
 * It has to be an absolute `http`/`https` URL, because that is the only kind
 * of thing a peer can dereference and the only kind the request middleware
 * could ever match: a relative path or a bare word is not an id anybody holds.
 * Anything else is dropped rather than refused, so a mistyped line leaves one
 * person served under their author URL instead of taking the whole admin down.
 */
function storedActorIdFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const wanted = value.trim();
  if (wanted === '') return undefined;

  try {
    const url = new URL(wanted);
    return url.protocol === 'http:' || url.protocol === 'https:' ? wanted : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A stored WordPress actor id as this version reads it, or `undefined`.
 *
 * A whole number above zero, because that is what a WordPress user id is and
 * the only thing that could ever appear in one of the plugin's paths. A string
 * is not accepted even when it reads as a number: the file is written by the
 * import, and a quoted id would be a sign that something else wrote it.
 */
function wordpressActorIdFrom(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

/** `{ [key]: value }` when the value is a string, and nothing when it is not. */
function optionalText(key: string, value: unknown): Record<string, string> {
  return typeof value === 'string' ? { [key]: value } : {};
}

/** A stored list of profile links as this version reads it. */
function linksFrom(value: unknown): ProfileLink[] {
  if (!Array.isArray(value)) return [];

  const links: ProfileLink[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const href = record['href'];
    const label = record['label'];
    if (typeof href !== 'string') continue;
    links.push({ label: typeof label === 'string' ? label : '', href });
  }
  return links;
}

/** A stored preference map as this version reads it, or `undefined`. */
function notificationsFrom(value: unknown): Record<string, boolean> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const found: Record<string, boolean> = {};
  for (const [name, wanted] of Object.entries(value as Record<string, unknown>)) {
    if (typeof wanted === 'boolean' && notificationEvent(name) !== undefined) found[name] = wanted;
  }

  return Object.keys(found).length === 0 ? undefined : found;
}

/** A stored map of delivery modes as this version reads it, or `undefined`. */
function notificationModesFrom(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const found: Record<string, string> = {};
  for (const [name, mode] of Object.entries(value as Record<string, unknown>)) {
    const event = notificationEvent(name);
    const known = deliveryMode(mode);
    if (event?.batched === true && known !== undefined) found[name] = known;
  }

  return Object.keys(found).length === 0 ? undefined : found;
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
