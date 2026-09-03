import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DATABASE_FILE } from '../content/store.ts';
import { hashPassword, verifyPasswordHash } from './passwords.ts';

/** Where {@link openAdminStore} puts, and finds, its tables. */
export interface OpenAdminStoreOptions {
  /** Directory the database lives in. Created if it is missing. */
  dataDir: string;
}

/** An admin user. There is one role, so there is no role column. */
export interface User {
  /** Row id, stable for the life of the user. */
  readonly id: number;
  /** Login name, unique and compared case sensitively. */
  readonly username: string;
  /** When the user was created, as an ISO 8601 instant. */
  readonly createdAt: string;
}

/** A user with the column no screen may render: its password hash. */
export interface StoredUser extends User {
  /** The PHC-encoded argon2id hash. */
  readonly passwordHash: string;
}

/** What {@link AdminStore.createUser} is given. */
export interface CreateUserInput {
  username: string;
  /** The plain password. It is hashed on the way in and never stored. */
  password: string;
}

/**
 * A login, or the anonymous session that carries a CSRF token to a visitor who
 * has not logged in yet.
 */
export interface Session {
  /** 256 random bits, hex encoded. This is the value in the cookie. */
  readonly id: string;
  /** The user, or `null` while the session is anonymous. */
  readonly userId: number | null;
  /**
   * The token every mutating form on this session has to send back. It is a
   * second secret rather than the session id, so a token that leaks through a
   * form, a log or a referrer is not a login.
   */
  readonly csrfToken: string;
  /** When the session was created, as an ISO 8601 instant. */
  readonly createdAt: string;
  /** When it stops being valid, as an ISO 8601 instant. */
  readonly expiresAt: string;
}

/** How loudly a flash message reads. */
export type FlashKind = 'notice' | 'error';

/**
 * One message queued for the next page a session asks for.
 *
 * Flashes live on the session row rather than in a cookie so they cannot be
 * replayed, forged or grown past a cookie's size, and so they disappear with
 * the session.
 */
export interface FlashMessage {
  /** Which style the message renders in. */
  kind: FlashKind;
  /** The message itself, in plain text. Templates escape it. */
  message: string;
}

/** What {@link AdminStore.createSession} is given. */
export interface CreateSessionInput {
  /** The user logging in, or `null` for the pre-login CSRF session. */
  userId: number | null;
  /** How long the session lasts, in seconds. */
  lifetimeSeconds: number;
  /** The clock, injectable so expiry is testable. Defaults to now. */
  now?: Date | undefined;
}

/** How long a session id is, in bytes. 32 is the 256 bits doc-5 asks for. */
export const SESSION_ID_BYTES = 32;

/**
 * The auth half of the SQLite database: the data doc-1 says lives only there.
 *
 * It is deliberately not part of the {@link ContentStore}. That store is the
 * derived index over the Markdown files and can be deleted and rebuilt at any
 * time; users and sessions are the one thing in the database that cannot. They
 * share the file (one database per site, one set of migrations on boot) and
 * nothing else.
 */
export interface AdminStore {
  /** Absolute path of the SQLite file, the same one the content index uses. */
  readonly file: string;
  /** How many users exist. Zero is what puts the admin into first-run setup. */
  countUsers(): number;
  /** Every user, by name, without password hashes. */
  listUsers(): User[];
  /** One user with its password hash, or `undefined`. For auth, not for screens. */
  getUser(username: string): StoredUser | undefined;
  /** The user behind a session's `userId`, or `undefined`. */
  getUserById(id: number): User | undefined;
  /**
   * Hash the password and insert the user.
   *
   * Throws {@link DuplicateUsernameError} when the name is taken.
   */
  createUser(input: CreateUserInput): User;
  /**
   * The user, when the password is theirs; `undefined` when it is not, or when
   * there is no such user. The two failures are deliberately indistinguishable.
   */
  verifyPassword(username: string, password: string): User | undefined;
  /**
   * Hash a new password and put it on a user, replacing the old one. Returns
   * `false` when there is no such user. Sessions are left alone; deciding
   * which of them a password change should end is the caller's business.
   */
  setPassword(userId: number, password: string): boolean;
  /**
   * Delete a user. Their sessions go with them, because the foreign key
   * cascades. Returns `false` when there was nothing to delete.
   */
  deleteUser(userId: number): boolean;
  /** Start a session and hand back its id and CSRF token. */
  createSession(input: CreateSessionInput): Session;
  /**
   * The session behind an id, or `undefined` when there is none or it has
   * expired. An expired row is deleted on the way past, so an expired session
   * is gone rather than merely ignored.
   */
  getSession(id: string, now?: Date): Session | undefined;
  /** Delete a session. Returns `false` when there was nothing to delete. */
  deleteSession(id: string): boolean;
  /**
   * End every session a user has, optionally sparing one. Returns how many
   * went.
   *
   * `except` is what makes a password change sign out every other browser
   * holding that login without signing out the one doing the changing.
   */
  deleteSessionsForUser(userId: number, options?: { except?: string }): number;
  /**
   * How many settings are stored. Zero on a site that has never saved the
   * settings form, which is what decides whether to seed from
   * `content/_data/site.json`.
   */
  countSettings(): number;
  /**
   * Every stored setting, by key. The store keeps no opinion about what the
   * keys mean or what they are worth; `readSiteSettings` in `settings.ts` is
   * what turns them into a typed shape with defaults.
   */
  allSettings(): Record<string, string>;
  /**
   * Write settings, in one transaction, leaving keys not named alone. An
   * existing key is replaced.
   */
  setSettings(values: Record<string, string>): void;
  /** Delete every expired session. Returns how many went. */
  pruneSessions(now?: Date): number;
  /**
   * Queue a message for the next page this session asks for. Does nothing when
   * there is no such session, which is what a logout followed by a flash is.
   */
  pushFlash(sessionId: string, entry: FlashMessage): void;
  /**
   * Every queued message for a session, in order, removed as it is read, so a
   * flash survives exactly one page and no more.
   */
  takeFlash(sessionId: string): FlashMessage[];
  /** Close the database. Safe to call twice. */
  close(): void;
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
 * Open (and if needed create) the admin tables in `dataDir`, applying every
 * migration the package ships. Applying them is idempotent.
 *
 * The connection is its own; SQLite in WAL mode is happy with the content
 * index holding a second one on the same file.
 */
export function openAdminStore(options: OpenAdminStoreOptions): AdminStore {
  const file = path.join(options.dataDir, DATABASE_FILE);
  mkdirSync(options.dataDir, { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);

  const statements = {
    countUsers: db.prepare('SELECT COUNT(*) AS count FROM users'),
    listUsers: db.prepare('SELECT id, username, created_at FROM users ORDER BY username'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?'),
    insertUser: db.prepare(
      'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
    ),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    deleteSessionsForUser: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?'),
    insertSession: db.prepare(`
      INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    sessionById: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    pruneSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    readFlash: db.prepare('SELECT flash FROM sessions WHERE id = ?'),
    writeFlash: db.prepare('UPDATE sessions SET flash = ? WHERE id = ?'),
    countSettings: db.prepare('SELECT COUNT(*) AS count FROM settings'),
    allSettings: db.prepare('SELECT key, value FROM settings'),
    putSetting: db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
  };

  let open = true;

  /**
   * The messages queued on a session. A column that will not parse is treated
   * as empty: a flash is a convenience, and losing one is better than a 500 on
   * every admin page until the row is cleaned up by hand.
   */
  function readFlash(sessionId: string): FlashMessage[] {
    const row = statements.readFlash.get(sessionId) as Record<string, unknown> | undefined;
    const raw = row?.['flash'];
    if (typeof raw !== 'string' || raw === '') return [];

    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isFlashMessage) : [];
    } catch {
      return [];
    }
  }

  function storedUser(username: string): StoredUser | undefined {
    const row = statements.userByName.get(username) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      id: Number(row['id']),
      username: String(row['username']),
      passwordHash: String(row['password_hash']),
      createdAt: String(row['created_at']),
    };
  }

  return {
    file,

    countUsers() {
      const row = statements.countUsers.get() as Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    listUsers() {
      return (statements.listUsers.all() as Record<string, unknown>[]).map((row) => ({
        id: Number(row['id']),
        username: String(row['username']),
        createdAt: String(row['created_at']),
      }));
    },

    getUser(username) {
      return storedUser(username);
    },

    getUserById(id) {
      const row = statements.userById.get(id) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;
      return {
        id: Number(row['id']),
        username: String(row['username']),
        createdAt: String(row['created_at']),
      };
    },

    createUser(input) {
      const createdAt = new Date().toISOString();
      const hash = hashPassword(input.password);
      try {
        statements.insertUser.run(input.username, hash, createdAt);
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateUsernameError(input.username);
        throw error;
      }
      const created = storedUser(input.username);
      if (created === undefined) {
        throw new Error(`The user "${input.username}" vanished between insert and read.`);
      }
      return { id: created.id, username: created.username, createdAt: created.createdAt };
    },

    verifyPassword(username, password) {
      const user = storedUser(username);
      if (user === undefined) {
        // Hash anyway, so a missing user and a wrong password take the same
        // time and the login form does not become a user enumerator.
        verifyPasswordHash(DUMMY_HASH, password);
        return undefined;
      }
      if (!verifyPasswordHash(user.passwordHash, password)) return undefined;
      return { id: user.id, username: user.username, createdAt: user.createdAt };
    },

    setPassword(userId, password) {
      // Hashed before the update rather than inside it, so a hash that throws
      // leaves the stored one alone.
      const hash = hashPassword(password);
      return statements.setPassword.run(hash, userId).changes > 0;
    },

    deleteUser(userId) {
      return statements.deleteUser.run(userId).changes > 0;
    },

    createSession(input) {
      const now = input.now ?? new Date();
      const session: Session = {
        id: randomToken(),
        userId: input.userId,
        csrfToken: randomToken(),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + input.lifetimeSeconds * 1000).toISOString(),
      };
      statements.insertSession.run(
        session.id,
        session.userId,
        session.csrfToken,
        session.createdAt,
        session.expiresAt,
      );
      return session;
    },

    getSession(id, now = new Date()) {
      const row = statements.sessionById.get(id) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;

      const session = toSession(row);
      // ISO 8601 in UTC sorts the way time runs, so string order is time order.
      if (session.expiresAt <= now.toISOString()) {
        statements.deleteSession.run(id);
        return undefined;
      }
      return session;
    },

    deleteSession(id) {
      return statements.deleteSession.run(id).changes > 0;
    },

    deleteSessionsForUser(userId, options = {}) {
      // `IS NOT` rather than `<>`, so a missing `except` compares against NULL
      // and spares nothing instead of matching nothing.
      return Number(statements.deleteSessionsForUser.run(userId, options.except ?? null).changes);
    },

    pruneSessions(now = new Date()) {
      return Number(statements.pruneSessions.run(now.toISOString()).changes);
    },

    countSettings() {
      const row = statements.countSettings.get() as Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    allSettings() {
      const settings: Record<string, string> = {};
      for (const row of statements.allSettings.all() as Record<string, unknown>[]) {
        settings[String(row['key'])] = String(row['value']);
      }
      return settings;
    },

    setSettings(values) {
      const updatedAt = new Date().toISOString();
      // One transaction, so a save that fails half way through leaves the
      // stored settings as they were rather than as a mixture of two versions.
      db.exec('BEGIN');
      try {
        for (const [key, value] of Object.entries(values)) {
          statements.putSetting.run(key, value, updatedAt);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    pushFlash(sessionId, entry) {
      const queued = [...readFlash(sessionId), entry];
      statements.writeFlash.run(JSON.stringify(queued), sessionId);
    },

    takeFlash(sessionId) {
      const queued = readFlash(sessionId);
      // The clear runs whether or not anything was queued; a row whose column
      // is already null costs one write and stays simple.
      statements.writeFlash.run(null, sessionId);
      return queued;
    },

    close() {
      if (!open) return;
      open = false;
      db.close();
    },
  };
}

/**
 * A well-formed hash of a password nobody has, verified against when the
 * username is unknown so that both failures cost the same.
 */
const DUMMY_HASH = hashPassword(
  'a password no user has, hashed once so that verification is constant time',
);

function isFlashMessage(value: unknown): value is FlashMessage {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry['kind'] === 'notice' || entry['kind'] === 'error') &&
    typeof entry['message'] === 'string'
  );
}

function toSession(row: Record<string, unknown>): Session {
  const userId = row['user_id'];
  return {
    id: String(row['id']),
    userId: userId === null || userId === undefined ? null : Number(userId),
    csrfToken: String(row['csrf_token']),
    createdAt: String(row['created_at']),
    expiresAt: String(row['expires_at']),
  };
}

/** 256 unguessable bits, hex encoded. Session ids and CSRF tokens are both this. */
function randomToken(): string {
  return randomBytes(SESSION_ID_BYTES).toString('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/**
 * Schema versions for the admin tables, applied in order. They keep their own
 * ledger so their numbering never collides with the content index's.
 *
 * Never edit a migration that has shipped; append a new one.
 */
const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );

      CREATE UNIQUE INDEX users_username ON users (username);

      CREATE TABLE sessions (
        id         TEXT PRIMARY KEY,
        user_id    INTEGER REFERENCES users (id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX sessions_expires_at ON sessions (expires_at);
      CREATE INDEX sessions_user_id ON sessions (user_id);
    `,
  },
  {
    // Flash messages: a JSON array of {kind, message}, queued by the request
    // that redirects and cleared by the one that renders them. They hang off
    // the session rather than a cookie so they cannot be forged or replayed,
    // and so they go when the session does.
    version: 2,
    sql: `ALTER TABLE sessions ADD COLUMN flash TEXT`,
  },
  {
    // Site settings: doc-1's "data that lives only in SQLite", mirrored to
    // content/_data/site.json on every save. Key and value rather than one
    // row per site, so the federation settings M3 adds cost a row rather than
    // a migration each.
    version: 3,
    sql: `
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT version FROM admin_migrations')
      .all()
      .map((row) => Number(row['version'])),
  );

  const record = db.prepare('INSERT INTO admin_migrations (version, applied_at) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      record.run(migration.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
