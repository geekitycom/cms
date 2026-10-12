import type { DatabaseSync } from 'node:sqlite';

import { databaseFile } from '../cache.ts';
import { openCommentStore } from './store/comments.ts';
import type { CommentStore } from './store/comments.ts';
import { conversationEvents } from './store/conversation.ts';
import type { ConversationEvents } from './store/conversation.ts';
import { openDeliveryStore } from './store/deliveries.ts';
import type { DeliveryStore } from './store/deliveries.ts';
import { openFollowerStore } from './store/followers.ts';
import type { FollowerStore } from './store/followers.ts';
import { openInboxStore } from './store/inbox.ts';
import type { InboxStore } from './store/inbox.ts';
import { openProfileStore } from './store/profiles.ts';
import type { ProfileStore } from './store/profiles.ts';
import { openRelayStore } from './store/relays.ts';
import type { RelayStore } from './store/relays.ts';
import { openAdminDatabase } from './store/schema.ts';
import { openSessionStore } from './store/sessions.ts';
import type { SessionStore } from './store/sessions.ts';
import { openStateStore } from './store/state.ts';
import type { StateStore } from './store/state.ts';
import { openTokenStore } from './store/tokens.ts';
import type { TokenStore } from './store/tokens.ts';
import { openWebmentionStore } from './store/webmentions.ts';
import type { WebmentionStore } from './store/webmentions.ts';

export {
  COMMENT_KINDS,
  COMMENT_SOURCES,
  COMMENT_STATUSES,
  importedFields,
  REDACTED_FIELDS,
  rsvpField,
  viaField,
} from './store/comments.ts';
export type {
  CommentAuthor,
  CommentContent,
  CommentKind,
  CommentRecord,
  CommentSource,
  CommentStatus,
  CommentStore,
  ListCommentsOptions,
  PostComment,
  RedactedField,
} from './store/comments.ts';
export type { ConversationEvents, ConversationWrite } from './store/conversation.ts';
export { DELIVERY_STATUSES } from './store/deliveries.ts';
export type { Delivery, DeliveryStatus, DeliveryStore, NewDelivery } from './store/deliveries.ts';
export type { Follower, FollowerStore, NewFollower } from './store/followers.ts';
export type { InboxActivity, InboxStore, NewInboxActivity } from './store/inbox.ts';
export type { ActorProfile, ProfileStore, StoredActorProfile } from './store/profiles.ts';
export { RELAY_STATES } from './store/relays.ts';
export type { NewRelay, Relay, RelayState, RelayStore } from './store/relays.ts';
export type { ListPageOptions } from './store/rows.ts';
export { openAdminDatabase } from './store/schema.ts';
export { SESSION_ID_BYTES } from './store/sessions.ts';
export type {
  CreateSessionInput,
  FlashKind,
  FlashMessage,
  Session,
  SessionStore,
} from './store/sessions.ts';
export type { StateStore } from './store/state.ts';
export type {
  CreatePasswordResetInput,
  IssuedPasswordReset,
  PasswordReset,
  TokenStore,
} from './store/tokens.ts';
export { WEBMENTION_SEND_STATUSES } from './store/webmentions.ts';
export type {
  NewSentWebmention,
  SentWebmention,
  WebmentionSendStatus,
  WebmentionStore,
} from './store/webmentions.ts';

/** Where {@link openAdminStore} puts, and finds, its tables. */
export interface OpenAdminStoreOptions {
  /** Directory the database lives in. Created if it is missing. */
  dataDir: string;
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
  return adminStoreOver(openAdminDatabase(options.dataDir), databaseFile(options.dataDir));
}

/**
 * The admin store over a database {@link openAdminDatabase} opened, for a
 * caller that runs the legacy migrations on the same connection first. Closing
 * the store closes `db`.
 */
export function adminStoreOver(db: DatabaseSync, file: string): AdminStore {
  let open = true;
  let readOnly = false;
  const { events, written } = conversationEvents();

  return {
    file,
    ...openSessionStore(db, () => readOnly),
    ...openTokenStore(db),
    ...openStateStore(db),
    ...openFollowerStore(db),
    ...openProfileStore(db),
    ...openInboxStore(db, written),
    ...openCommentStore(db, written),
    ...events,
    ...openDeliveryStore(db),
    ...openWebmentionStore(db),
    ...openRelayStore(db),

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
