import type { DatabaseSync } from 'node:sqlite';

import { openDatabase } from '../cache.ts';
import type { Migration } from '../cache.ts';
import type { Clock } from '../util/clock.ts';
import { replyTargetOf } from './inbox-replies.ts';
import { replyKeyOf } from './inbox.ts';
import { nullableText } from './rows.ts';

/** The table this store's applied versions are recorded in. */
export const LEDGER = 'admin_migrations';

/**
 * Schema versions for the admin tables, applied in order. They keep their own
 * ledger so their numbering never collides with the content index's.
 *
 * Never edit a migration that has shipped; append a new one.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    // Users and sessions, when SQLite still held both. The accounts have since
    // moved into `data/users.json`, so nothing reads the users table any
    // more: `migrateUsersToFile` writes its rows out on the first boot of that
    // version and drops it. The migration stays exactly as it shipped, because
    // a shipped migration is never edited — which does mean a brand new
    // database creates the table here and drops it a moment later. Migration
    // 11 is where sessions lose the foreign key into it.
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
    // Site settings, when SQLite was still the source of them. They have since
    // moved into content/_data/site.json, so nothing reads this table
    // any more: `migrateSettingsToFile` writes its rows out on the first boot
    // of that version and drops it. The migration stays exactly as it shipped,
    // because a shipped migration is never edited — which does mean a brand
    // new database creates the table here and drops it a moment later.
    version: 3,
    sql: `
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    // The site actor's signing keys, when SQLite still held them. They have
    // since moved into JWK files under `data/keys`, so nothing reads this table
    // any more: `migrateActorKeysToFiles` writes its rows out on the first boot
    // of that version and drops it. The migration stays exactly as it shipped,
    // because a shipped migration is never edited — which does mean a brand new
    // database creates the table here and drops it a moment later.
    version: 4,
    sql: `
      CREATE TABLE actor_keys (
        identifier  TEXT NOT NULL,
        algorithm   TEXT NOT NULL,
        private_jwk TEXT NOT NULL,
        public_jwk  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (identifier, algorithm)
      );
    `,
  },
  {
    // The site's followers. Fedify's KV store is a cache and may be
    // thrown away; a follower may not, because an actor that followed and was
    // forgotten simply stops hearing from the site. Keyed by actor id, which
    // is what a `Follow`, an `Undo(Follow)` and an actor's own `Delete` all
    // name, so all three find the same row.
    version: 5,
    sql: `
      CREATE TABLE followers (
        actor_id        TEXT PRIMARY KEY,
        inbox_id        TEXT NOT NULL,
        shared_inbox_id TEXT,
        handle          TEXT,
        name            TEXT,
        icon_url        TEXT,
        url             TEXT,
        followed_at     TEXT NOT NULL
      );

      CREATE INDEX followers_followed_at ON followers (followed_at);
    `,
  },
  {
    // Inbound activities that are recorded rather than acted on: likes,
    // boosts and replies, which a later phase surfaces. The raw JSON-LD is
    // kept because what that phase wants out of an activity is not knowable
    // yet. The unique index on the activity id is what makes a redelivery an
    // update rather than a second like; SQLite counts NULLs as distinct, so
    // an activity that arrived without an id is always its own row.
    version: 6,
    sql: `
      CREATE TABLE ap_inbox (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id   TEXT,
        activity_type TEXT NOT NULL,
        actor_id      TEXT NOT NULL,
        object_id     TEXT,
        received_at   TEXT NOT NULL,
        json          TEXT NOT NULL
      );

      CREATE UNIQUE INDEX ap_inbox_activity_id ON ap_inbox (activity_id);
      CREATE INDEX ap_inbox_received_at ON ap_inbox (received_at);
      CREATE INDEX ap_inbox_actor_id ON ap_inbox (actor_id);
    `,
  },
  {
    // Outbound delivery. Two tables, because an activity
    // is one thing and its fate at each follower is another: keeping the
    // JSON-LD once rather than once per follower is what makes a redelivery to
    // a thousand followers a single read, and one row per (activity, follower)
    // is what lets the admin see which follower did not get it.
    //
    // The activity's own id is the key. It is derived from the post's object
    // id — `#create`, `#update/{hash}`, `#delete/{time}` — so re-sending the
    // same announcement updates the row it belongs to instead of writing a
    // second one that says the same thing.
    version: 7,
    sql: `
      CREATE TABLE ap_outbound (
        activity_id   TEXT PRIMARY KEY,
        activity_type TEXT NOT NULL,
        object_id     TEXT NOT NULL,
        slug          TEXT,
        created_at    TEXT NOT NULL,
        json          TEXT NOT NULL
      );

      CREATE INDEX ap_outbound_created_at ON ap_outbound (created_at);
      CREATE INDEX ap_outbound_object_id ON ap_outbound (object_id);

      CREATE TABLE ap_deliveries (
        activity_id  TEXT NOT NULL REFERENCES ap_outbound (activity_id) ON DELETE CASCADE,
        actor_id     TEXT NOT NULL,
        inbox_id     TEXT NOT NULL,
        status       TEXT NOT NULL,
        error        TEXT,
        attempted_at TEXT NOT NULL,
        PRIMARY KEY (activity_id, actor_id)
      );

      CREATE INDEX ap_deliveries_attempted_at ON ap_deliveries (attempted_at);
      CREATE INDEX ap_deliveries_status ON ap_deliveries (status);
    `,
  },
  {
    // What a logged reply answers, so a post's comments can be counted and
    // listed without reading every activity the site was ever sent.
    //
    // It is an index of the JSON beside it rather than a fact of its own: the
    // backfill runs the very function the writer runs, so a database rebuilt
    // from the inbox log holds what this one holds.
    version: 8,
    sql: `
      ALTER TABLE ap_inbox ADD COLUMN in_reply_to TEXT;
      CREATE INDEX ap_inbox_in_reply_to ON ap_inbox (in_reply_to);
    `,
    run(db) {
      const rows = db.prepare('SELECT id, json FROM ap_inbox').all();
      const update = db.prepare('UPDATE ap_inbox SET in_reply_to = ? WHERE id = ?');
      for (const row of rows) {
        update.run(replyTargetOf(String(row['json'])), Number(row['id']));
      }
    },
  },
  {
    // Relay subscriptions (FEP-ae0c). The list of relays is a
    // setting mirrored to site.json; this is where each handshake stands,
    // which is operational state and derivable again from the file — a relay
    // in the list with no row here is simply followed again on the next boot.
    //
    // Keyed by the inbox rather than by the relay's actor id, because the
    // inbox is the only thing known when the `Follow` goes out: the actor id
    // arrives with the `Accept`, days later if a human has to approve it.
    version: 9,
    sql: `
      CREATE TABLE ap_relays (
        inbox_id   TEXT PRIMARY KEY,
        actor_id   TEXT,
        state      TEXT NOT NULL,
        reason     TEXT,
        follow_id  TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX ap_relays_follow_id ON ap_relays (follow_id);
      CREATE INDEX ap_relays_actor_id ON ap_relays (actor_id);
    `,
  },
  {
    // The CMS's own operational state, as opposed to the site's settings. It
    // is a table of its own rather than more rows in `settings` because the
    // number of settings is what decides whether a site is seeded from
    // content/_data/site.json, and because nothing here belongs in that file.
    version: 10,
    sql: `
      CREATE TABLE cms_state (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    // Sessions without the foreign key into `users`, because there is no users
    // table any more: the accounts live in `data/users.json`, and
    // `migrateUsersToFile` drops the table on the boot after this migration
    // runs. The constraint could not survive that either way — with
    // `foreign_keys` on, dropping the parent cascades every login away, and an
    // insert afterwards fails with "no such table: main.users" — and SQLite
    // cannot drop a constraint in place, so the table is rebuilt. Every row is
    // copied across, so a site upgrading keeps the logins it had. What the key
    // was doing is done in the admin guard instead: a session naming a user
    // the file no longer holds is not a session.
    version: 11,
    sql: `
      CREATE TABLE sessions_without_users (
        id         TEXT PRIMARY KEY,
        user_id    INTEGER,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        flash      TEXT
      );

      INSERT INTO sessions_without_users (
        id, user_id, csrf_token, created_at, expires_at, flash
      )
      SELECT id, user_id, csrf_token, created_at, expires_at, flash FROM sessions;

      DROP TABLE sessions;
      ALTER TABLE sessions_without_users RENAME TO sessions;

      CREATE INDEX sessions_expires_at ON sessions (expires_at);
      CREATE INDEX sessions_user_id ON sessions (user_id);
    `,
  },
  {
    // The outcomes without the payloads. With files as the source of truth,
    // "send this stored activity again" becomes "send this post as it now
    // reads", so nothing needs the JSON-LD any more and `ap_outbound` goes:
    // an activity rebuilt from the file is the current answer, and a copy of
    // what went out last time could only ever be a staler one.
    //
    // What that table held about an activity that an outcome cannot do
    // without — its type, the object it was about and the slug — moves onto
    // the outcome row, which is now the whole of what SQLite remembers about
    // anything the site has sent. The foreign key has to go with the parent,
    // and SQLite cannot drop a constraint in place, so `ap_deliveries` is
    // rebuilt the way migration 11 rebuilt `sessions`. Every row that has an
    // activity to name is carried across as a courtesy: this table is a cache
    // and is allowed to be empty, so a row whose activity is somehow missing
    // is dropped rather than invented a type for.
    version: 12,
    sql: `
      CREATE TABLE ap_deliveries_standalone (
        activity_id   TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        object_id     TEXT NOT NULL,
        slug          TEXT,
        actor_id      TEXT NOT NULL,
        inbox_id      TEXT NOT NULL,
        status        TEXT NOT NULL,
        error         TEXT,
        attempted_at  TEXT NOT NULL,
        PRIMARY KEY (activity_id, actor_id)
      );

      INSERT INTO ap_deliveries_standalone (
        activity_id, activity_type, object_id, slug,
        actor_id, inbox_id, status, error, attempted_at
      )
      SELECT
        ap_deliveries.activity_id,
        ap_outbound.activity_type,
        ap_outbound.object_id,
        ap_outbound.slug,
        ap_deliveries.actor_id,
        ap_deliveries.inbox_id,
        ap_deliveries.status,
        ap_deliveries.error,
        ap_deliveries.attempted_at
      FROM ap_deliveries
      JOIN ap_outbound ON ap_outbound.activity_id = ap_deliveries.activity_id;

      DROP TABLE ap_deliveries;
      ALTER TABLE ap_deliveries_standalone RENAME TO ap_deliveries;

      CREATE INDEX ap_deliveries_attempted_at ON ap_deliveries (attempted_at);
      CREATE INDEX ap_deliveries_status ON ap_deliveries (status);
      CREATE INDEX ap_deliveries_object_id ON ap_deliveries (object_id, attempted_at);

      DROP TABLE ap_outbound;
    `,
  },
  {
    // What a post's conversation is read by. `in_reply_to` already
    // had an index because a post's replies are counted on every feed; the
    // object an activity is about had none, and that is the column a like, a
    // boost, a `Delete` of a reply and an `Undo` of a like are all found by.
    version: 13,
    sql: `
      CREATE INDEX ap_inbox_object_id ON ap_inbox (object_id);
    `,
  },
  {
    // Native comments, which are files under
    // `content/_data/comments/` and nothing else: this table is an index of
    // them, emptied and read back on every boot exactly as `followers` and
    // `ap_inbox` are. Nothing here is a fact the files do not carry.
    //
    // The id is the comment's own name rather than a row number, because it is
    // what a reply names, what a moderation form posts and what the page
    // anchors on — all three have to survive a rebuilt index. The author's
    // name and email are indexed together because that pair is the whole of
    // WordPress's auto-approval rule.
    version: 14,
    sql: `
      CREATE TABLE comments (
        id           TEXT PRIMARY KEY,
        slug         TEXT NOT NULL,
        permalink    TEXT NOT NULL,
        source       TEXT NOT NULL,
        kind         TEXT NOT NULL,
        status       TEXT NOT NULL,
        author_name  TEXT NOT NULL,
        author_url   TEXT,
        author_email TEXT,
        markdown     TEXT NOT NULL,
        html         TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        address_hash TEXT,
        in_reply_to  TEXT
      );

      CREATE INDEX comments_slug ON comments (slug, submitted_at);
      CREATE INDEX comments_status ON comments (status, submitted_at);
      CREATE INDEX comments_author ON comments (author_name, author_email, status);
    `,
  },
  {
    // Webmentions, which are two different things and so two changes.
    //
    // A comment may now say where it lives, because a webmention lives on
    // somebody else's page: it is what a later webmention from that page is
    // recognised by, and what the thread's permalink points at for an entry
    // this site did not host. Its author may now have a face, out of the source
    // page's `h-card`. Both columns are an index of the comment files like
    // every other column of this table, so nothing backfills them — the rebuild
    // on the next boot does.
    //
    // What the site has sent is the other half, and it is a cache of outcomes
    // exactly as `ap_deliveries` is: no payload, one row per (post, target),
    // and a resend moves the row rather than adding to it. It is a table of
    // its own rather than a use of `ap_deliveries` because the federation
    // screen counts that table per activity, and a webmention is not one.
    version: 15,
    sql: `
      ALTER TABLE comments ADD COLUMN url TEXT;
      ALTER TABLE comments ADD COLUMN author_avatar TEXT;

      CREATE TABLE webmentions_sent (
        slug         TEXT NOT NULL,
        source       TEXT NOT NULL,
        target       TEXT NOT NULL,
        endpoint     TEXT,
        status       TEXT NOT NULL,
        error        TEXT,
        attempted_at TEXT NOT NULL,
        PRIMARY KEY (slug, target)
      );

      CREATE INDEX webmentions_sent_attempted_at ON webmentions_sent (attempted_at);
    `,
  },
  {
    // Password reset tokens. They sit beside the sessions, and for
    // the same reason: a reset link is a second, shorter-lived way of proving
    // you are somebody, and it is a cache — losing one costs the person
    // nothing but a second click on Forgot password. So `data/users.json`
    // stays the whole of what a site must back up, and a restart, a rebuild or
    // a `geekity rebuild` invalidates every link in flight, which is the safe
    // direction to fail in.
    //
    // The key is the token's SHA-256 rather than the token, so the database
    // holds nothing a working link could be rebuilt from: somebody who reads
    // this table — a backup, a stray copy of the file — learns that a reset
    // was asked for and nothing else. It is a plain hash rather than argon2
    // because the token is 256 random bits and there is no guess to slow down;
    // what argon2 buys on a password it cannot buy here.
    version: 16,
    sql: `
      CREATE TABLE password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX password_resets_expires_at ON password_resets (expires_at);
      CREATE INDEX password_resets_user_id ON password_resets (user_id);
    `,
  },
  {
    // The two halves of a notification's one-click links.
    //
    // `spent_tokens` is what makes such a link single use. The link itself is
    // not stored — it is an HMAC-signed claim, so that a moderation link in an
    // inbox goes on working across a rebuilt or restored cache, which is a
    // thing a site may do whenever it likes, since the database is a cache.
    // Only the fact that one has been used is written down, keyed by its
    // SHA-256 for the reason `password_resets` is, and swept once the signature
    // has expired. Losing this table forgets which links were spent, and that
    // costs a site nothing: every action a link performs is idempotent, so
    // doing it a second time is doing it once.
    //
    // `comments.notify` is the commenter's "tell me about replies", which the
    // file says and this column indexes like every other column of that table.
    // Nothing backfills it: the rebuild on the next boot does, and a comment
    // written before this shipped never asked to be told.
    version: 17,
    sql: `
      CREATE TABLE spent_tokens (
        token_hash TEXT PRIMARY KEY,
        spent_at   TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX spent_tokens_expires_at ON spent_tokens (expires_at);

      ALTER TABLE comments ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    // Followers belong to a user, and the inbox log says who was told.
    // The site actor is gone, so there is nothing to
    // backfill: the `followers` table is rebuilt on every boot from the files
    // under `content/_data/federation/{username}/`, and the rows a site
    // carried for the site actor name nobody. The table is therefore dropped
    // and made again with the new key rather than altered — `actor_id` was its
    // primary key, and one actor may follow two of this site's users.
    version: 18,
    sql: `
      DROP TABLE followers;

      CREATE TABLE followers (
        username        TEXT NOT NULL,
        actor_id        TEXT NOT NULL,
        inbox_id        TEXT NOT NULL,
        shared_inbox_id TEXT,
        handle          TEXT,
        name            TEXT,
        icon_url        TEXT,
        url             TEXT,
        followed_at     TEXT NOT NULL,
        PRIMARY KEY (username, actor_id)
      );

      CREATE INDEX followers_followed_at ON followers (followed_at);
      CREATE INDEX followers_actor_id ON followers (actor_id);

      ALTER TABLE ap_inbox ADD COLUMN recipient TEXT;

      CREATE INDEX ap_inbox_recipient ON ap_inbox (recipient);
    `,
  },
  {
    // The avatar proxy asks, per request for a picture, whether its URL is one
    // the site has recorded. Both columns are indexed so that
    // question is a lookup rather than a scan of every follower and comment.
    version: 19,
    sql: `
      CREATE INDEX followers_icon_url ON followers (icon_url);
      CREATE INDEX comments_author_avatar ON comments (author_avatar);
    `,
  },
  {
    // What a comment has had removed for privacy, as the JSON list
    // its file carries. Nothing backfills it: the rebuild on the next boot
    // does, and a comment nothing was removed from leaves it `NULL`.
    version: 20,
    sql: `ALTER TABLE comments ADD COLUMN redacted TEXT;`,
  },
  {
    // The profiles of actors who are not followers: whoever liked,
    // boosted, answered or quoted a post, as their actor document named them.
    // A cache and nothing else. Nothing backfills it here: the
    // profile sweep fetches every actor the inbox log names that has none.
    version: 21,
    sql: `
      CREATE TABLE actor_profiles (
        actor_id   TEXT PRIMARY KEY,
        handle     TEXT,
        name       TEXT,
        icon_url   TEXT,
        url        TEXT,
        fetched_at TEXT NOT NULL
      );

      CREATE INDEX actor_profiles_icon_url ON actor_profiles (icon_url);
    `,
  },
  {
    version: 22,
    sql: `ALTER TABLE comments ADD COLUMN rsvp TEXT;`,
  },
  {
    // What a \`/replies/\` key names, so resolving one is a lookup
    // rather than a walk of every comment and logged reply. A note's key is
    // its id's and is backfilled here; a native comment's hangs off the base
    // URL, which a migration does not know, so those rows are filled when the
    // store is opened with one, as they are whenever that base changes.
    version: 23,
    sql: `
      ALTER TABLE comments ADD COLUMN replies_key TEXT;
      ALTER TABLE comments ADD COLUMN keys_base TEXT;
      CREATE INDEX comments_replies_key ON comments (replies_key);
      ALTER TABLE ap_inbox ADD COLUMN reply_key TEXT;
      CREATE INDEX ap_inbox_reply_key ON ap_inbox (reply_key);
    `,
    run(db) {
      const rows = db.prepare('SELECT id, activity_type, object_id, json FROM ap_inbox').all();
      const update = db.prepare('UPDATE ap_inbox SET reply_key = ? WHERE id = ?');
      for (const row of rows) {
        const key = replyKeyOf({
          activityType: String(row['activity_type']),
          objectId: nullableText(row['object_id']),
          json: String(row['json']),
        });
        update.run(key, Number(row['id']));
      }
    },
  },
  {
    version: 24,
    sql: `ALTER TABLE comments ADD COLUMN via TEXT;`,
  },
  {
    version: 25,
    sql: `ALTER TABLE ap_inbox ADD COLUMN fetched INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    // A comment's key is its id, so the key worked out from its
    // guid against the base URL has nothing left to say.
    version: 26,
    sql: `
      DROP INDEX comments_replies_key;
      ALTER TABLE comments DROP COLUMN replies_key;
      ALTER TABLE comments DROP COLUMN keys_base;
      ALTER TABLE comments ADD COLUMN migrated INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE comments ADD COLUMN origin TEXT;
      ALTER TABLE comments ADD COLUMN user TEXT;
      ALTER TABLE comments ADD COLUMN actor TEXT;
    `,
  },
  {
    version: 27,
    sql: `ALTER TABLE sessions ADD COLUMN cleared_autosaves TEXT;`,
  },
];

export function openAdminDatabase(dataDir: string, now: Clock): DatabaseSync {
  return openDatabase({ dataDir, ledger: LEDGER, migrations: MIGRATIONS, now });
}
