import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import { actorKeyFile, ensureKeysDir, KEY_FILE_MODE } from '../federation/keys.ts';
import { readFileIfPresentSync, writeFileAtomicallySync } from '../files/atomic.ts';
import { relayList } from '../site/setting-values.ts';
import type { SiteSettings } from '../site/settings.ts';
import { fileWith, storedValues } from '../settings/registry.ts';
import { SITE, siteJsonPath } from '../site/namespace.ts';
import { isRecord } from '../util/guards.ts';
import { USERS_FILE_MODE, usersFile, usersJsonText } from '../site/users.ts';
import { DEFAULT_MENU_NAME, menuItemsFromText } from '../site/navigation.ts';
import { taxonomyRedirectsOf } from '../content/taxonomy.ts';
import type { TaxonomyRedirect } from '../content/taxonomy.ts';

/**
 * One row of the settings table TASK-14 wrote, for the one boot that reads it.
 *
 * Settings live in `content/_data/site.json` now (decision-9), so this shape
 * exists only so `migrateSettingsToFile` can write the rows out before the
 * table goes. `updatedAt` is what tells a row written by the settings screen
 * from a `site.json` a person edited afterwards.
 */
export interface LegacySetting {
  /** The setting's name, e.g. `title`. */
  key: string;
  /** Its value, always a string; numbers and lists were spelled as text. */
  value: string;
  /** When it was last written, as an ISO instant. */
  updatedAt: string;
}

/**
 * One row of the actor key table TASK-16 wrote, for the one boot that reads it.
 *
 * Key pairs live in `data/keys` as JWK files now (decision-9), so this shape
 * exists only so `migrateActorKeysToFiles` can write the rows out before the
 * table goes. The public half the table also held is not here: it is derived
 * from the private one, and reading it would only invite the two to disagree.
 */
export interface LegacyActorKey {
  /** Which actor the pair belonged to: the sentinel identifier, not a handle. */
  identifier: string;
  /**
   * Which algorithm it is for, as the table spelled it. A bare string rather
   * than one of the algorithms this version knows, on purpose: a row a later
   * version wrote is still a key that must reach a file rather than go with
   * the table.
   */
  algorithm: string;
  /** The private key as JWK, JSON encoded. What the file ends up holding. */
  privateJwk: string;
}

/**
 * One row of the users table TASK-9 wrote, for the one boot that reads it.
 *
 * Accounts live in `data/users.json` now (decision-9), so this shape exists
 * only so `migrateUsersToFile` can write the rows out before the table goes.
 * The id comes with them: a session in the same database names its user by it,
 * and a migration that renumbered everybody would sign the whole site out.
 */
export interface LegacyUser {
  /** The row id, which the file keeps. */
  id: number;
  /** The login name. */
  username: string;
  /** The PHC-encoded argon2id hash, moved into the file as it stands. */
  passwordHash: string;
  /** When the user was created, as an ISO instant. */
  createdAt: string;
}

export function legacySettings(db: DatabaseSync): LegacySetting[] | undefined {
  // Prepared here, after the check, because a statement over a missing table
  // throws when it is prepared rather than when it is run.
  if (!hasTable(db, 'settings')) return undefined;

  return (
    db.prepare('SELECT key, value, updated_at FROM settings').all() as Record<string, unknown>[]
  ).map((row) => ({
    key: String(row['key']),
    value: String(row['value']),
    updatedAt: String(row['updated_at']),
  }));
}

export function legacyActorKeys(db: DatabaseSync): LegacyActorKey[] | undefined {
  if (!hasTable(db, 'actor_keys')) return undefined;

  return (
    db.prepare('SELECT identifier, algorithm, private_jwk FROM actor_keys').all() as Record<
      string,
      unknown
    >[]
  ).map((row) => ({
    identifier: String(row['identifier']),
    algorithm: String(row['algorithm']),
    privateJwk: String(row['private_jwk']),
  }));
}

export function legacyUsers(db: DatabaseSync): LegacyUser[] | undefined {
  if (!hasTable(db, 'users')) return undefined;

  return (
    db
      .prepare('SELECT id, username, password_hash, created_at FROM users ORDER BY id')
      .all() as Record<string, unknown>[]
  ).map((row) => ({
    id: Number(row['id']),
    username: String(row['username']),
    passwordHash: String(row['password_hash']),
    createdAt: String(row['created_at']),
  }));
}

/**
 * Drop a table whose contents this version keeps in files instead.
 *
 * Called once the rows have been written out, and safe when the table is
 * already gone. It is deliberately not a schema migration: a migration runs
 * when the database is opened, which is before anything knows where the
 * content directory is, and dropping the rows before they are written out is
 * the one mistake this cannot make.
 */
export function dropLegacyTable(db: DatabaseSync, name: string): void {
  // The name is never a caller's to invent: it is one of this file's own
  // shipped table names, so quoting it is enough.
  db.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
}

/** Whether the database has a table by that name. */
function hasTable(db: DatabaseSync, name: string): boolean {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").all(name)
      .length > 0
  );
}

/**
 * Turn an older site's settings rows into `content/_data/site.json`, once, and
 * drop the table.
 *
 * TASK-14 made SQLite the source and the file its mirror; decision-9 reversed
 * that, and a site upgrading across the two has rows nothing would ever read
 * again. So the first boot of this version writes them out. Which side wins
 * when both have something to say is decided the way it is decided everywhere
 * else: the file wins when it was written after the last save, because that is
 * a hand edit or a restored checkout, and the rows win otherwise. Either way
 * the actor handle and type come from the rows, because `site.json` never
 * carried them and losing them would rename the site's actor.
 *
 * Synchronous because `createCms` is: it runs before the server is listening
 * and before anything else has touched the file.
 */
export function migrateSettingsToFile(db: DatabaseSync, contentDir: string): void {
  const rows = legacySettings(db);

  if (rows !== undefined && rows.length > 0) {
    const stored = settingsFromRows(rows);
    const file = siteJsonPath(contentDir);
    const existing = siteJsonIn(readFileIfPresentSync(file) ?? '');
    const settings = fileWasEditedLast(file, rows) ? storedValues(SITE, existing) : stored;

    writeFileAtomicallySync(
      file,
      `${JSON.stringify(fileWith(SITE, settings, existing), null, 2)}\n`,
    );
  }

  // Dropped whether or not it had rows: a fresh database gets the table from
  // migration 3, which has shipped and so is never edited, and a site that has
  // been migrated must not be asked again on the next boot.
  dropLegacyTable(db, 'settings');
}

/**
 * Turn an older site's `actor_keys` rows into files under `data/keys`, once,
 * and drop the table.
 *
 * The rows this writes out are the site actor's, which no version after
 * TASK-68 has: decision-14 replaced it with one actor per user, and a user's
 * keys are named after their username rather than after the sentinel `actor`.
 * The files are still written rather than dropped on the floor, because a
 * private key is the one thing this CMS never deletes for somebody — an
 * operator who wants the old identity back has it on disk to move.
 *
 * This is the migration decision-9 calls the one that must not fail. Settings
 * a site could type again and followers a site could ask for again; an actor's
 * private key is the site's identity, and losing it means every follower's
 * cached public key stops verifying its posts for good. So the rows are
 * written out before the table goes, never after, and a file that is already
 * there always wins — a site that has booted this version once has the truth
 * on disk, and a row left over from before it did must not overwrite it.
 *
 * Synchronous because `createCms` is: it runs before the server is listening
 * and before anything has asked for a key.
 */
export function migrateActorKeysToFiles(db: DatabaseSync, dataDir: string): void {
  const rows = legacyActorKeys(db);

  if (rows !== undefined && rows.length > 0) {
    ensureKeysDir(dataDir);
    for (const row of rows) {
      const file = actorKeyFile(dataDir, row.identifier, row.algorithm);
      // Only the private half is written: the public one is derived from it,
      // and a stored pair whose halves disagreed would be worse than none. The
      // row is written out as it stands, byte for byte apart from the trailing
      // newline every file here ends with — a key is not something to
      // re-encode on the way past.
      if (readFileIfPresentSync(file) === undefined) {
        writeFileAtomicallySync(file, `${row.privateJwk.trimEnd()}\n`, { mode: KEY_FILE_MODE });
      }
    }
  }

  // Dropped whether or not it had rows: a fresh database gets the table from
  // migration 4, which has shipped and so is never edited, and a site that has
  // been migrated must not be asked again on the next boot.
  dropLegacyTable(db, 'actor_keys');
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
export function migrateUsersToFile(db: DatabaseSync, dataDir: string): void {
  const rows = legacyUsers(db);
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

  dropLegacyTable(db, 'users');
}

function siteJsonIn(source: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(source);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The old key/value rows as settings, defaults filled in. */
function settingsFromRows(rows: readonly LegacySetting[]): SiteSettings {
  const stored: Record<string, string> = {};
  for (const row of rows) stored[row.key] = row.value;

  // Through the file's own reader, so one description of what a setting is
  // worth serves both: the rows are spelled as the file spells them and read
  // back the same way. `relays`, `navigation` and `taxonomyRedirects` were
  // stored one entry per line, which is not how the file holds them.
  return storedValues(SITE, {
    ...stored,
    ...(stored['baseUrl'] === undefined ? {} : { url: stored['baseUrl'] }),
    ...(stored['postsPerPage'] === undefined
      ? {}
      : { postsPerPage: Number(stored['postsPerPage']) }),
    relays: relayList(stored['relays'] ?? ''),
    menus: { [DEFAULT_MENU_NAME]: menuItemsFromText(stored['navigation'] ?? '') },
    taxonomyRedirects: redirectList(stored['taxonomyRedirects'] ?? ''),
  });
}

/**
 * Whether `site.json` has been written since the newest settings row was.
 *
 * A missing file has not, so the rows win. A file whose modification time
 * cannot be read is treated the same way: the rows are the only thing that is
 * certainly there.
 */
function fileWasEditedLast(file: string, rows: readonly LegacySetting[]): boolean {
  let modified: number;
  try {
    modified = statSync(file).mtimeMs;
  } catch {
    return false;
  }

  const newest = rows.reduce((latest, row) => {
    const at = Date.parse(row.updatedAt);
    return Number.isNaN(at) ? latest : Math.max(latest, at);
  }, 0);

  return modified > newest;
}

/**
 * A `taxonomy|from|to` block as the renames it names, which is how the old
 * settings table spelled them ({@link migrateSettingsToFile}).
 *
 * The same tolerance the rest of this file reads its lists with: a line that
 * is not three non-empty parts naming a real taxonomy is dropped rather than
 * failing the read.
 */
function redirectList(value: string): TaxonomyRedirect[] {
  const entries: Record<string, unknown>[] = [];
  for (const line of value.split('\n')) {
    const parts = line.split('|');
    if (parts.length !== 3) continue;
    entries.push({
      taxonomy: (parts[0] ?? '').trim(),
      from: (parts[1] ?? '').trim(),
      to: (parts[2] ?? '').trim(),
    });
  }
  // Through the same reader `site.json` goes through, so the two spellings of
  // the list cannot mean different things.
  return taxonomyRedirectsOf(entries);
}
