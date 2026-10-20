import type { DatabaseSync } from 'node:sqlite';

import { databaseFile } from '../cache.ts';
import { systemClock } from '../util/clock.ts';
import type { Clock } from '../util/clock.ts';
import { openCommentStore } from './comments.ts';
import type { CommentStore } from './comments.ts';
import { conversationEvents } from './conversation.ts';
import type { ConversationEvents } from './conversation.ts';
import { openDeliveryStore } from './deliveries.ts';
import type { DeliveryStore } from './deliveries.ts';
import { openFollowerStore } from './followers.ts';
import type { FollowerStore } from './followers.ts';
import { openInboxStore } from './inbox.ts';
import type { InboxStore } from './inbox.ts';
import { openProfileStore } from './profiles.ts';
import type { ProfileStore } from './profiles.ts';
import { openRelayStore } from './relays.ts';
import type { RelayStore } from './relays.ts';
import { openAdminDatabase } from './schema.ts';
import { openSessionStore } from './sessions.ts';
import type { SessionStore } from './sessions.ts';
import { openStateStore } from './state.ts';
import type { StateStore } from './state.ts';
import { openTokenStore } from './tokens.ts';
import type { TokenStore } from './tokens.ts';
import { openWebmentionStore } from './webmentions.ts';
import type { WebmentionStore } from './webmentions.ts';

export {
  COMMENT_KINDS,
  COMMENT_SOURCES,
  COMMENT_STATUSES,
  importedFields,
  REDACTED_FIELDS,
  rsvpField,
  viaField,
} from './comments.ts';
export type {
  CommentAuthor,
  CommentContent,
  CommentKind,
  CommentRecord,
  CommentSource,
  CommentStatus,
  ListCommentsOptions,
  PostComment,
  RedactedField,
} from './comments.ts';
export type { ConversationWrite } from './conversation.ts';
export { DELIVERY_STATUSES } from './deliveries.ts';
export type { Delivery, DeliveryStatus, NewDelivery } from './deliveries.ts';
export type { Follower, NewFollower } from './followers.ts';
export type { InboxActivity, InboxInteraction, NewInboxActivity } from './inbox.ts';
export type { ActorProfile, StoredActorProfile } from './profiles.ts';
export { RELAY_STATES } from './relays.ts';
export type { NewRelay, Relay, RelayState } from './relays.ts';
export type { ListPageOptions } from './rows.ts';
export { openAdminDatabase } from './schema.ts';
export { SESSION_ID_BYTES } from './sessions.ts';
export type { CreateSessionInput, FlashKind, FlashMessage, Session } from './sessions.ts';
export type { CreatePasswordResetInput, IssuedPasswordReset, PasswordReset } from './tokens.ts';
export { WEBMENTION_SEND_STATUSES } from './webmentions.ts';
export type { NewSentWebmention, SentWebmention, WebmentionSendStatus } from './webmentions.ts';

/** Where {@link openAdminStore} puts, and finds, its tables. */
export interface OpenAdminStoreOptions {
  /** Directory the database lives in. Created if it is missing. */
  dataDir: string;
  /** What the records are stamped with. Defaults to the system clock. */
  now?: Clock | undefined;
}

/**
 * Everything the database holds that is not the content index: the sessions,
 * the followers and inbox indexes, the delivery outcomes, the relay handshake
 * and the scheduler's watermark.
 *
 * All of it is a cache (decision-9). The followers and the inbox rows are read
 * back from `content/_data/federation/` on every boot; the rest a site is free
 * to lose, and docs/content.md says what losing it costs. It is deliberately
 * not part of the {@link ContentStore}: the two share the file, one database per
 * site with a migration ledger each, and nothing else.
 */
export type AdminStore = SessionStore &
  TokenStore &
  StateStore &
  FollowerStore &
  ProfileStore &
  InboxStore &
  CommentStore &
  ConversationEvents &
  DeliveryStore &
  WebmentionStore &
  RelayStore & {
    /** Absolute path of the SQLite file, the same one the content index uses. */
    readonly file: string;
    /** What the records are stamped with: the clock the store was opened with. */
    now(): Date;
    /**
     * Refuse every write on this connection while on, with SQLite's
     * `query_only`. A worker handing over to a new one under `geekity serve`
     * turns it on, so the new worker's boot migrations run alone (TASK-288).
     */
    setReadOnly(readOnly: boolean): void;
    /** Close the database. Safe to call twice. */
    close(): void;
  };

/**
 * Open (and if needed create) the admin tables in `dataDir`, applying every
 * migration the package ships. Applying them is idempotent.
 *
 * The connection is its own; SQLite in WAL mode is happy with the content
 * index holding a second one on the same file.
 */
export function openAdminStore(options: OpenAdminStoreOptions): AdminStore {
  const now = options.now ?? systemClock;
  return adminStoreOwning(
    openAdminDatabase(options.dataDir, now),
    databaseFile(options.dataDir),
    now,
  );
}

export function adminStoreOwning(db: DatabaseSync, file: string, now: Clock): AdminStore {
  let open = true;
  let readOnly = false;
  const { events, written } = conversationEvents();

  return {
    file,
    now,
    ...openSessionStore(db, () => readOnly, now),
    ...openTokenStore(db, now),
    ...openStateStore(db, now),
    ...openFollowerStore(db, now),
    ...openProfileStore(db),
    ...openInboxStore(db, written, now),
    ...openCommentStore(db, written),
    ...events,
    ...openDeliveryStore(db, now),
    ...openWebmentionStore(db, now),
    ...openRelayStore(db, now),

    setReadOnly(on) {
      db.exec(`PRAGMA query_only = ${on ? 'ON' : 'OFF'}`);
      readOnly = on;
    },

    close() {
      if (!open) return;
      open = false;
      db.close();
    },
  };
}
