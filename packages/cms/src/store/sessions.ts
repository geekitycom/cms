import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { Clock } from '../util/clock.ts';

import { getRow } from './rows.ts';
import type { Row } from './rows.ts';

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

export type FlashKind = 'notice' | 'warning' | 'error';

const FLASH_KINDS: ReadonlySet<unknown> = new Set<FlashKind>(['notice', 'warning', 'error']);

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

/** What {@link SessionStore.createSession} is given. */
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

export interface SessionStore {
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

  /** Delete every expired session. Returns how many went. */
  pruneSessions(now?: Date): number;
  /**
   * Queue a message for the next page this session asks for. Does nothing when
   * there is no such session, which is what a logout followed by a flash is.
   */
  pushFlash(sessionId: string, entry: FlashMessage): void;
  /**
   * Every queued message for a session, in order, removed as it is read, so a
   * flash survives exactly one page and no more. A read-only store leaves them
   * queued, for the worker that takes over to show again.
   */
  takeFlash(sessionId: string): FlashMessage[];
  pushClearedAutosave(sessionId: string, key: string): void;
  takeClearedAutosaves(sessionId: string): string[];
}

export function openSessionStore(
  db: DatabaseSync,
  isReadOnly: () => boolean,
  clock: Clock,
): SessionStore {
  const statements = {
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
    readCleared: db.prepare('SELECT cleared_autosaves FROM sessions WHERE id = ?'),
    writeCleared: db.prepare('UPDATE sessions SET cleared_autosaves = ? WHERE id = ?'),
  };

  /**
   * The messages queued on a session. A column that will not parse is treated
   * as empty: a flash is a convenience, and losing one is better than a 500 on
   * every admin page until the row is cleaned up by hand.
   */
  function readFlash(sessionId: string): FlashMessage[] {
    return parseList(getRow(statements.readFlash, (row) => row['flash'], sessionId)).filter(
      isFlashMessage,
    );
  }

  function readCleared(sessionId: string): string[] {
    return parseList(
      getRow(statements.readCleared, (row) => row['cleared_autosaves'], sessionId),
    ).filter((key): key is string => typeof key === 'string');
  }

  return {
    createSession(input) {
      const now = input.now ?? clock();
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

    getSession(id, now = clock()) {
      const session = getRow(statements.sessionById, toSession, id);
      if (session === undefined) return undefined;

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

    pruneSessions(now = clock()) {
      return Number(statements.pruneSessions.run(now.toISOString()).changes);
    },

    pushFlash(sessionId, entry) {
      const queued = [...readFlash(sessionId), entry];
      statements.writeFlash.run(JSON.stringify(queued), sessionId);
    },

    takeFlash(sessionId) {
      const queued = readFlash(sessionId);
      if (!isReadOnly()) statements.writeFlash.run(null, sessionId);
      return queued;
    },

    pushClearedAutosave(sessionId, key) {
      const queued = [...readCleared(sessionId), key];
      statements.writeCleared.run(JSON.stringify(queued), sessionId);
    },

    takeClearedAutosaves(sessionId) {
      const queued = readCleared(sessionId);
      if (!isReadOnly()) statements.writeCleared.run(null, sessionId);
      return queued;
    },
  };
}

function parseList(raw: unknown): unknown[] {
  if (typeof raw !== 'string' || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isFlashMessage(value: unknown): value is FlashMessage {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'kind' in value &&
    FLASH_KINDS.has(value.kind) &&
    'message' in value &&
    typeof value.message === 'string'
  );
}

function toSession(row: Row): Session {
  const userId = row['user_id'];
  return {
    id: String(row['id']),
    userId: userId === null || userId === undefined ? null : Number(userId),
    csrfToken: String(row['csrf_token']),
    createdAt: String(row['created_at']),
    expiresAt: String(row['expires_at']),
  };
}

/**
 * 256 unguessable bits, hex encoded. Session ids, CSRF tokens and password
 * reset tokens are all this.
 */
export function randomToken(): string {
  return randomBytes(SESSION_ID_BYTES).toString('hex');
}
