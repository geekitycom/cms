import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { randomToken } from './sessions.ts';

/**
 * One outstanding password reset: the right to set one user's password once,
 * until it is used or it expires.
 *
 * The token is only ever in hand at the moment it is made, because the link is
 * the only copy: the database keeps its SHA-256, so reading the table tells
 * somebody that a reset was asked for and nothing more.
 */
export interface PasswordReset {
  /** Whose password this sets. */
  readonly userId: number;
  /** When it was asked for, as an ISO 8601 instant. */
  readonly createdAt: string;
  /** When it stops working, as an ISO 8601 instant. */
  readonly expiresAt: string;
}

/** A {@link PasswordReset} with the one thing the database never keeps. */
export interface IssuedPasswordReset extends PasswordReset {
  /**
   * The token itself, 256 random bits hex encoded, handed back exactly once.
   * It goes in the link and nowhere else.
   */
  readonly token: string;
}

/** What {@link TokenStore.createPasswordReset} is given. */
export interface CreatePasswordResetInput {
  /** Whose password the link will set. */
  userId: number;
  /** How long the link lasts, in seconds. */
  lifetimeSeconds: number;
  /** The clock, injectable so expiry is testable. Defaults to now. */
  now?: Date | undefined;
}

/** Password reset links and spent one-click tokens, both kept only as hashes. */
export interface TokenStore {
  /**
   * Issue a password reset link and hand back its token, which is the only
   * time the token exists outside the link.
   */
  createPasswordReset(input: CreatePasswordResetInput): IssuedPasswordReset;
  /**
   * What a token entitles its holder to, or `undefined` when it entitles them
   * to nothing: no such token, or one that has expired. An expired row is
   * deleted on the way past, as an expired session's is.
   */
  getPasswordReset(token: string, now?: Date): PasswordReset | undefined;
  /** Spend a token. Returns `false` when there was nothing to spend. */
  deletePasswordReset(token: string): boolean;
  /**
   * Cancel every reset a user has outstanding, and say how many went.
   *
   * What a finished reset calls: the link that was used is spent, and so is
   * every other one asked for in the meantime, because whoever set the
   * password now owns the account and the others are only ways back in for
   * somebody who does not.
   */
  deletePasswordResetsForUser(userId: number): number;
  /** Delete every expired reset. Returns how many went. */
  prunePasswordResets(now?: Date): number;
  /**
   * Spend a one-click link's token, and say whether it had anything left.
   *
   * `true` the first time and `false` for ever after, which is what makes a
   * link in an email single use (TASK-55). Only the token's SHA-256 is kept,
   * as a password reset's is, so a copy of this file is not a list of the
   * links a site has sent. `expiresAt` is the moment the token's own signature
   * stops meaning anything, and is only there so the row can be swept.
   */
  spendToken(token: string, expiresAt: string, now?: Date): boolean;
  /** Delete every spent token that has expired. Returns how many went. */
  pruneSpentTokens(now?: Date): number;
}

export function openTokenStore(db: DatabaseSync): TokenStore {
  const statements = {
    insertPasswordReset: db.prepare(`
      INSERT INTO password_resets (token_hash, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `),
    passwordResetByHash: db.prepare('SELECT * FROM password_resets WHERE token_hash = ?'),
    deletePasswordReset: db.prepare('DELETE FROM password_resets WHERE token_hash = ?'),
    deletePasswordResetsForUser: db.prepare('DELETE FROM password_resets WHERE user_id = ?'),
    prunePasswordResets: db.prepare('DELETE FROM password_resets WHERE expires_at <= ?'),
    spendToken: db.prepare(`
      INSERT OR IGNORE INTO spent_tokens (token_hash, spent_at, expires_at) VALUES (?, ?, ?)
    `),
    pruneSpentTokens: db.prepare('DELETE FROM spent_tokens WHERE expires_at <= ?'),
  };
  return {
    createPasswordReset(input) {
      const now = input.now ?? new Date();
      const token = randomToken();
      const reset: IssuedPasswordReset = {
        token,
        userId: input.userId,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + input.lifetimeSeconds * 1000).toISOString(),
      };

      statements.insertPasswordReset.run(
        hashToken(token),
        reset.userId,
        reset.createdAt,
        reset.expiresAt,
      );
      return reset;
    },

    getPasswordReset(token, now = new Date()) {
      const hash = hashToken(token);
      const row = statements.passwordResetByHash.get(hash) as Record<string, unknown> | undefined;
      if (row === undefined) return undefined;

      const reset: PasswordReset = {
        userId: Number(row['user_id']),
        createdAt: String(row['created_at']),
        expiresAt: String(row['expires_at']),
      };

      // The same rule the sessions follow: an expired row is deleted rather
      // than ignored, so a clock that goes backwards cannot revive a link.
      if (reset.expiresAt <= now.toISOString()) {
        statements.deletePasswordReset.run(hash);
        return undefined;
      }
      return reset;
    },

    deletePasswordReset(token) {
      return statements.deletePasswordReset.run(hashToken(token)).changes > 0;
    },

    deletePasswordResetsForUser(userId) {
      return Number(statements.deletePasswordResetsForUser.run(userId).changes);
    },

    prunePasswordResets(now = new Date()) {
      return Number(statements.prunePasswordResets.run(now.toISOString()).changes);
    },

    spendToken(token, expiresAt, now = new Date()) {
      // `INSERT OR IGNORE` rather than a read then a write: two clicks on the
      // same link arriving together must not both find nothing and both act.
      const written = statements.spendToken.run(hashToken(token), now.toISOString(), expiresAt);
      return Number(written.changes) > 0;
    },

    pruneSpentTokens(now = new Date()) {
      return Number(statements.pruneSpentTokens.run(now.toISOString()).changes);
    },
  };
}

/**
 * A reset token as the database keeps it: its SHA-256, hex encoded.
 *
 * Plain SHA-256 rather than argon2 on purpose. What argon2 buys is time
 * against somebody guessing a password people chose, and there is nothing to
 * guess here: the token is 256 bits out of `randomBytes`, so the only way to
 * hold a valid one is to have been sent it. What the hash is for is that a
 * copy of `geekity.db` — a backup, a stray file — is not a stack of working
 * reset links.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
