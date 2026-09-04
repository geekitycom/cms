import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { databaseFile, openDatabase } from '../cache.ts';
import type { Migration } from '../cache.ts';
import { REPLY_ACTIVITY_TYPE, replyTargetOf } from '../federation/replies.ts';

/**
 * Which rows of the inbox log are replies: a `Create` that named something it
 * answers. Spelled once, because a count and a listing that disagreed about it
 * would show a post a number no page of comments could produce.
 */
const IS_REPLY = `activity_type = '${REPLY_ACTIVITY_TYPE}' AND in_reply_to IS NOT NULL`;

/** Where {@link openAdminStore} puts, and finds, its tables. */
export interface OpenAdminStoreOptions {
  /** Directory the database lives in. Created if it is missing. */
  dataDir: string;
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
 * A remote actor that follows this site.
 *
 * The followers are irreplaceable — an actor that followed and was forgotten
 * never hears from the site again and has no way of noticing — so
 * `content/_data/federation/followers.json` is where they are kept
 * (decision-9), and this row is the index of that file, emptied and read back
 * on every boot. The display columns are a copy of what the actor said about
 * itself when it followed, so the admin can list its followers without
 * dereferencing every one of them.
 */
export interface Follower {
  /** The follower's ActivityStreams id, which is what identifies it. */
  readonly actorId: string;
  /** Where an activity addressed to this follower is delivered. */
  readonly inboxId: string;
  /**
   * The follower's instance-wide inbox, when it published one. Delivering one
   * activity to a shared inbox reaches every follower on that instance, so it
   * is what keeps a popular post from becoming a thousand POSTs.
   */
  readonly sharedInboxId: string | null;
  /** `@name@host`, as the follower's own instance spells it, or `null`. */
  readonly handle: string | null;
  /** The display name the actor published, or `null`. */
  readonly name: string | null;
  /** The actor's avatar, or `null`. */
  readonly iconUrl: string | null;
  /** The actor's profile page, for a human following the link, or `null`. */
  readonly url: string | null;
  /** When the follow arrived, as an ISO 8601 instant. */
  readonly followedAt: string;
}

/**
 * A {@link Follower} on its way in.
 *
 * `followedAt` is optional and defaults to now; naming one is what makes an
 * import — or a test — able to say when a follow really happened.
 */
export type NewFollower = Omit<Follower, 'followedAt'> & {
  followedAt?: string | undefined;
};

/** How {@link AdminStore.listFollowers} and its inbox-log sibling page. */
export interface ListPageOptions {
  /** Largest number of rows to return. Everything, when it is not given. */
  limit?: number | undefined;
  /** How many rows to skip first. Zero when it is not given. */
  offset?: number | undefined;
}

/**
 * One activity that arrived in the inbox and was recorded rather than acted
 * on: doc-4's `Like`, `Announce` and `Create(Note)` reply, and the follow
 * traffic alongside them.
 *
 * The raw JSON-LD is kept whole because a later phase surfaces likes, boosts
 * and comments, and what that phase needs out of an activity is not knowable
 * from here.
 */
export interface InboxActivity {
  /** Row id, and the order activities arrived in. */
  readonly id: number;
  /** The activity's own id, or `null` for one that arrived without one. */
  readonly activityId: string | null;
  /** The compacted ActivityStreams type name, such as `Like` or `Announce`. */
  readonly activityType: string;
  /** Who sent it. */
  readonly actorId: string;
  /** What it was about — the post that was liked, the note replied to — or `null`. */
  readonly objectId: string | null;
  /**
   * The object this activity answers, for a `Create` that carried an
   * `inReplyTo`, and `null` for everything else.
   *
   * Derived from {@link InboxActivity.json} by {@link replyTargetOf} rather
   * than supplied, so an index rebuilt from the inbox log holds exactly what
   * the live one holds. It is a column so a post's replies can be counted
   * without reading every activity the site was ever sent.
   */
  readonly inReplyTo: string | null;
  /** When it arrived, as an ISO 8601 instant. */
  readonly receivedAt: string;
  /** The activity as compacted JSON-LD, exactly as it was received. */
  readonly json: string;
}

/**
 * An {@link InboxActivity} before the store has given it a row and the reply
 * target it derives.
 *
 * `receivedAt` is optional and defaults to now, exactly as a follower's
 * `followedAt` is: naming one is what lets the boot rebuild put the log's own
 * arrival times back rather than stamping every activity with the moment the
 * index was rebuilt.
 */
export type NewInboxActivity = Omit<InboxActivity, 'id' | 'receivedAt' | 'inReplyTo'> & {
  receivedAt?: string | undefined;
};

/** How one delivery of one activity to one follower ended. */
export const DELIVERY_STATUSES = ['sent', 'queued', 'failed'] as const;

/**
 * One of {@link DELIVERY_STATUSES}.
 *
 * `sent` is a POST the follower's server accepted. `queued` is one handed to
 * Fedify's outbox queue, which is as much as a site running with a queue can
 * know from the call: the queue retries out of band and does not report back.
 * `failed` is a delivery that threw, with the reason in the row.
 */
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * How one attempt to deliver one activity to one recipient ended, and what the
 * activity was.
 *
 * The whole of what SQLite keeps about anything the site has sent (decision-9).
 * No payload goes with it: an activity is rebuilt from the post's file at the
 * moment somebody asks for it to go again, so storing the bytes that went out
 * last time would only be a second, staler answer to the same question. What
 * is left is a cache of outcomes, and a site that deletes its database loses
 * nothing but the record of how yesterday's delivery went.
 *
 * The activity's own columns are here rather than in a table of their own
 * because there is no longer anything else to put in one: they are what the
 * federation screen reads to say what went out and when.
 */
export interface Delivery {
  /** The id of the activity that was delivered. */
  readonly activityId: string;
  /** `Create`, `Update` or `Delete`. */
  readonly activityType: string;
  /**
   * The ActivityStreams id of what it was about: a post, or the site's own
   * actor when the profile itself was what moved.
   */
  readonly objectId: string;
  /**
   * The post's slug when the activity went out, or `null` for an activity
   * about no post — which is what an actor `Update` is.
   */
  readonly slug: string | null;
  /** Which follower or relay it was delivered to. */
  readonly actorId: string;
  /** The inbox actually used, which is the shared one when the follower has one. */
  readonly inboxId: string;
  /** How it went. */
  readonly status: DeliveryStatus;
  /** Why it failed, or `null`. */
  readonly error: string | null;
  /** When the attempt was made, as an ISO 8601 instant. */
  readonly attemptedAt: string;
}

/** A {@link Delivery} before the store has timed it. */
export type NewDelivery = Omit<Delivery, 'attemptedAt'> & {
  attemptedAt?: string | undefined;
};

/** Where a relay subscription stands (FEP-ae0c). */
export const RELAY_STATES = ['pending', 'accepted', 'rejected'] as const;

/**
 * One of {@link RELAY_STATES}.
 *
 * `pending` is a `Follow` that has gone out and not been answered — which may
 * take days, because a relay is allowed to hold one for a human to approve.
 * `accepted` is one the relay answered `Accept` to, and the only state the
 * site delivers to. `rejected` is one it answered `Reject` to, with whatever
 * it said in {@link Relay.reason}.
 */
export type RelayState = (typeof RELAY_STATES)[number];

/**
 * The site's subscription to one relay.
 *
 * The list of relays itself is a setting, and so lives in `site.json`; this is
 * the state of the handshake with each of them, which is operational rather
 * than editorial. Keyed by the inbox because that is the only thing known when the
 * `Follow` goes out: a relay's actor id is not learned until it answers.
 */
export interface Relay {
  /** The relay's inbox, which is what the site was given and what it delivers to. */
  readonly inboxId: string;
  /** The relay actor's id, once it has answered, and `null` until then. */
  readonly actorId: string | null;
  /** Where the subscription stands. */
  readonly state: RelayState;
  /** Why a `Reject` was a reject, when it gave a reason, or `null`. */
  readonly reason: string | null;
  /** The id of the `Follow` that was sent, which an `Accept` names. */
  readonly followId: string | null;
  /** When the site first subscribed, as an ISO 8601 instant. */
  readonly createdAt: string;
  /** When the subscription last moved — accepted, rejected, re-followed. */
  readonly updatedAt: string;
}

/** A {@link Relay} before the store has timed it. */
export type NewRelay = Omit<Relay, 'createdAt' | 'updatedAt'> & {
  createdAt?: string | undefined;
};

/** Where a comment came from. */
export const COMMENT_SOURCES = ['comment', 'webmention'] as const;

/**
 * One of {@link COMMENT_SOURCES}.
 *
 * `comment` is the form under the post. `webmention` is another site's post
 * pointing at this one (TASK-51), which lands in the same file with the same
 * shape and is told apart only by this.
 */
export type CommentSource = (typeof COMMENT_SOURCES)[number];

/** What a comment is: something written, or a wordless pointer at the post. */
export const COMMENT_KINDS = ['reply', 'like', 'boost'] as const;

/** One of {@link COMMENT_KINDS}. The same three a conversation knows. */
export type CommentKind = (typeof COMMENT_KINDS)[number];

/** Where a comment stands with the moderator. */
export const COMMENT_STATUSES = ['pending', 'approved', 'spam'] as const;

/**
 * One of {@link COMMENT_STATUSES}.
 *
 * `pending` is waiting for somebody to look at it, and is the state almost
 * every comment starts in; `approved` is on the page and in the feeds; `spam`
 * is kept rather than deleted, so a checker can be told it was wrong and so a
 * mistake can be undone.
 */
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/** Who wrote a comment, as much as the site knows. */
export interface CommentAuthor {
  /** The name they gave, which is what the page shows. */
  name: string;
  /** Their website, or `null`. Shown, and marked `nofollow ugc` like any link. */
  url: string | null;
  /**
   * Their email, or `null`. **Never shown**: it is here for the moderator, for
   * the auto-approval rule, and for the spam checker.
   */
  email: string | null;
}

/** What a comment says, in both the forms the site keeps. */
export interface CommentContent {
  /** What was typed, which is what a person wrote and the source of truth. */
  markdown: string;
  /** {@link CommentContent.markdown} through the restricted profile. */
  html: string;
}

/**
 * One comment, as its post's file under `content/_data/comments/` holds it.
 *
 * The shape is deliberately wider than a form submission. A webmention
 * (TASK-51) is somebody else's post pointing at this one: it has a `url` and no
 * email, it may be a like rather than a reply, and it belongs in the same file
 * and the same thread. So every entry says its `source` and its `kind`, and
 * nothing assumes a person filled in a form.
 */
export interface CommentRecord {
  /** Its name, unique across the site, and what a reply puts in `inReplyTo`. */
  id: string;
  /** Where it came from. */
  source: CommentSource;
  /** What it is. */
  kind: CommentKind;
  /** Where it stands with the moderator. */
  status: CommentStatus;
  /** Who wrote it. */
  author: CommentAuthor;
  /** What it says. */
  content: CommentContent;
  /** When it was submitted, as an ISO 8601 instant. */
  submitted: string;
  /**
   * A salted hash of the address it came from, or `null`.
   *
   * The address itself is not kept: the file is published with the site and
   * goes into git, and an IP address there would be a reader's home written
   * into a public repository. The hash is enough to see that two comments came
   * from one place, which is what a moderator is actually asking.
   */
  addressHash: string | null;
  /** The comment it answers, or `null` for one answering the post itself. */
  inReplyTo: string | null;
}

/**
 * A {@link CommentRecord} with the post it is on.
 *
 * The file it lives in is named after the post's slug and records the post's
 * permalink, so both are facts of the file rather than of the entry; the index
 * carries them on the row because a query by id has no file to read them from.
 */
export interface PostComment extends CommentRecord {
  /** The post's slug, which names the file the comment lives in. */
  slug: string;
  /** That post's permalink, for the moderation screen and the feeds. */
  permalink: string;
}

/** How {@link AdminStore.listComments} narrows and pages. */
export interface ListCommentsOptions extends ListPageOptions {
  /** Only comments at this status. Every status when it is not given. */
  status?: CommentStatus | undefined;
}

/**
 * Everything the database holds that is not the content index: the sessions,
 * the followers and inbox indexes, the delivery outcomes, the relay handshake
 * and the scheduler's watermark.
 *
 * All of it is a cache (decision-9). The followers and the inbox rows are read
 * back from `content/_data/federation/` on every boot; the rest a site is free
 * to lose, and the README says what losing it costs. It is deliberately not
 * part of the {@link ContentStore}: the two share the file, one database per
 * site with a migration ledger each, and nothing else.
 */
export interface AdminStore {
  /** Absolute path of the SQLite file, the same one the content index uses. */
  readonly file: string;
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
   * The rows of the settings table an older version of this CMS wrote, or
   * `undefined` when the table is gone — which it is on every site that has
   * booted this version once.
   *
   * Settings live in `content/_data/site.json` now (decision-9). This is the
   * one read left of the table they used to live in, so the first boot after
   * the upgrade can write them out; `migrateSettingsToFile` in `settings.ts`
   * is what decides what they mean.
   */
  legacySettings(): LegacySetting[] | undefined;
  /**
   * The rows of the actor key table an older version of this CMS wrote, or
   * `undefined` when the table is gone — which it is on every site that has
   * booted this version once.
   *
   * Key pairs live in `data/keys` now (decision-9). This is the one read left
   * of the table they used to live in, and the reason it exists at all is that
   * losing an actor's private key is the one loss a federated site cannot
   * recover from; `migrateActorKeysToFiles` in `federation/keys.ts` writes them
   * out before the table is dropped.
   */
  legacyActorKeys(): LegacyActorKey[] | undefined;
  /**
   * The rows of the users table an older version of this CMS wrote, or
   * `undefined` when the table is gone — which it is on every site that has
   * booted this version once.
   *
   * Accounts live in `data/users.json` now (decision-9). This is the one read
   * left of the table they used to live in, so the first boot after the
   * upgrade can write them out; `migrateUsersToFile` in `accounts.ts` is what
   * does it, ids and all, so a session that names a user still finds them.
   */
  legacyUsers(): LegacyUser[] | undefined;
  /**
   * Drop a table whose contents this version keeps in files instead.
   *
   * Called once the rows have been written out, and safe when the table is
   * already gone. It is deliberately not a schema migration: a migration runs
   * when the database is opened, which is before anything knows where the
   * content directory is, and dropping the rows before they are written out is
   * the one mistake this milestone cannot make.
   */
  dropLegacyTable(name: string): void;
  /**
   * One piece of the CMS's own operational state, or `undefined`.
   *
   * Not a setting: nothing here is a site's choice and nothing here belongs in
   * `content/_data/site.json`, which is where a setting lives. It is a cache
   * like the rest of the database, and losing it costs a site nothing it
   * cannot work out again. The scheduler's watermark — how far through the
   * calendar it has got — lives here.
   */
  getState(key: string): string | undefined;
  /** Write one piece of that state. */
  setState(key: string, value: string): void;
  /** How many actors follow the site. What the followers collection counts. */
  countFollowers(): number;
  /**
   * Followers, newest follow first, optionally one page of them.
   *
   * Newest first matches the outbox, and means the collection's first page is
   * the followers a human is most likely to be looking for. A follow that
   * arrives while somebody is walking the collection shifts the pages under
   * them by one, which is the same trade the outbox makes.
   */
  listFollowers(options?: ListPageOptions): Follower[];
  /** One follower by actor id, or `undefined`. */
  getFollower(actorId: string): Follower | undefined;
  /**
   * Store a follower, replacing whatever was known about that actor. The
   * original `followedAt` is kept, because a repeat `Follow` from an actor
   * that already follows is a redelivery rather than a new follow.
   */
  putFollower(follower: NewFollower): Follower;
  /** Forget a follower. Returns `false` when there was nothing to forget. */
  deleteFollower(actorId: string): boolean;
  /**
   * Make the followers index say exactly this, in one transaction.
   *
   * What a rebuild from `content/_data/federation/followers.json` calls
   * (decision-9): the file is the source, so a row it does not carry is a row
   * that should not be delivered to, and replacing the lot is the only way to
   * say that. Nothing outside a rebuild should reach for it.
   */
  replaceFollowers(followers: readonly NewFollower[]): void;
  /** How many activities the inbound log holds. */
  countInboxActivities(): number;
  /** Logged activities, newest first, optionally one page of them. */
  listInboxActivities(options?: ListPageOptions): InboxActivity[];
  /**
   * Record an inbound activity, replacing an earlier row with the same
   * activity id so a redelivered `Like` stays one like. An activity that
   * arrived without an id is always a new row: there is nothing to match it
   * against.
   */
  logInboxActivity(activity: NewInboxActivity): InboxActivity;
  /**
   * Make the inbound log index say exactly this, in one transaction, with the
   * row ids starting again from one.
   *
   * The counterpart of {@link AdminStore.replaceFollowers} over
   * `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`. The ids restart
   * because a row id is the order things arrived in and nothing else: letting
   * them climb on every boot would give the same log different ids on two
   * machines holding the same files.
   */
  replaceInboxActivities(activities: readonly NewInboxActivity[]): void;
  /** How many logged activities are replies to anything at all. */
  countReplies(): number;
  /** Every logged reply, newest first, optionally one page of them. */
  listReplies(options?: ListPageOptions): InboxActivity[];
  /** How many replies one object — a post's ActivityStreams id — has. */
  countRepliesTo(objectId: string): number;
  /** One object's replies, newest first, optionally one page of them. */
  listRepliesTo(objectId: string, options?: ListPageOptions): InboxActivity[];
  /**
   * Every logged activity that names one of these objects — as what it is
   * about, or as what it answers — oldest first.
   *
   * The query a conversation is built from: the likes and boosts of a post,
   * the replies to it, and the `Delete` or `Undo` that takes one of those
   * back, all name an object this side already knows the id of. Both columns
   * are read because a `Create` is *about* the note it carries and only
   * `in_reply_to` says which post that note answers.
   *
   * Oldest first, because that is the order a thread reads in; a caller
   * wanting the newest can reverse a page it has. Naming nothing returns
   * nothing rather than everything.
   */
  listActivitiesAbout(objectIds: readonly string[]): InboxActivity[];
  /** One post's comments, oldest first, whatever status they are at. */
  listCommentsFor(slug: string): PostComment[];
  /**
   * How many of one post's comments stand at one status.
   *
   * A count rather than a list because that is what the feeds want: the RSS
   * `source:comments` element carries a number per item, and reading every
   * comment on every post of a feed page to arrive at it would be a page of
   * text for a page of integers.
   */
  countCommentsFor(slug: string, status: CommentStatus): number;
  /**
   * Comments across the site, newest first, optionally of one status and one
   * page of them. What the moderation screen and the site-wide feed read.
   */
  listComments(options: ListCommentsOptions): PostComment[];
  /** One comment by id, or `undefined`. */
  getComment(id: string): PostComment | undefined;
  /** How many comments stand at each status. What the dashboard shows. */
  countCommentsByStatus(): Record<CommentStatus, number>;
  /**
   * Whether this name and email have had a comment approved before.
   *
   * WordPress's rule, and the whole of the auto-approval decision: somebody a
   * moderator has already let through does not queue again. Both have to
   * match, so a stranger typing a regular's name is still held.
   */
  hasApprovedAuthor(name: string, email: string | null): boolean;
  /** Store a comment, replacing whatever was known about that id. */
  putComment(comment: PostComment): PostComment;
  /** Forget a comment. Returns `false` when there was nothing to forget. */
  deleteComment(id: string): boolean;
  /**
   * Make the comment index say exactly this, in one transaction.
   *
   * What a rebuild from `content/_data/comments/` calls (decision-9): the
   * files are the source, so a row they do not carry is a comment that should
   * not be on the page. Nothing outside a rebuild should reach for it.
   */
  replaceComments(comments: readonly PostComment[]): void;
  /**
   * Record how one delivery to one follower ended, replacing the previous
   * outcome for that pair: the table answers "where does this activity stand
   * with each follower", which a resend moves rather than adds to.
   */
  recordDelivery(delivery: NewDelivery): Delivery;
  /** Every follower's outcome for one activity, in follower order. */
  listDeliveries(activityId: string): Delivery[];
  /** How many followers this activity stands at each status with. */
  countDeliveriesByStatus(activityId: string): Record<DeliveryStatus, number>;
  /**
   * The most recent delivery to one inbox, whichever activity it carried, or
   * `undefined` when nothing has ever gone there.
   *
   * Keyed by the inbox rather than by the actor because that is what a relay
   * has: it is not a follower, so there is no follower row to look its
   * outcomes up by, and the inbox is the thing the site was told to deliver to.
   */
  lastDeliveryToInbox(inboxId: string): Delivery | undefined;
  /**
   * The most recent delivery about one object — a post's ActivityStreams id,
   * or the site actor's — or `undefined` when nothing about it has ever gone
   * out.
   *
   * What the federation screen's per-post row is filled in from. Keyed by the
   * object rather than by the activity because a post is a series of
   * activities and the row is about the post: the newest outcome is the one
   * that says where the post currently stands with the fediverse.
   */
  lastDeliveryToObject(objectId: string): Delivery | undefined;
  /** Every relay subscription, oldest first, however it stands. */
  listRelays(): Relay[];
  /** One relay subscription by the inbox it was made to, or `undefined`. */
  getRelay(inboxId: string): Relay | undefined;
  /**
   * The subscription one `Follow` established, or `undefined`.
   *
   * This is how an `Accept` or a `Reject` arriving later finds the relay it
   * answers: the activity names the follow, and the follow names the record.
   */
  getRelayByFollow(followId: string): Relay | undefined;
  /**
   * Store a relay subscription, replacing whatever was known about that inbox
   * and leaving the original `createdAt` alone: a subscription that moves from
   * pending to accepted is the same subscription, and when it began is a fact
   * only the row remembers.
   */
  putRelay(relay: NewRelay): Relay;
  /** Forget a relay subscription. Returns `false` when there was nothing to forget. */
  deleteRelay(inboxId: string): boolean;
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

/**
 * Open (and if needed create) the admin tables in `dataDir`, applying every
 * migration the package ships. Applying them is idempotent.
 *
 * The connection is its own; SQLite in WAL mode is happy with the content
 * index holding a second one on the same file.
 */
export function openAdminStore(options: OpenAdminStoreOptions): AdminStore {
  const file = databaseFile(options.dataDir);
  const db = openDatabase({ dataDir: options.dataDir, ledger: LEDGER, migrations: MIGRATIONS });

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
    getState: db.prepare('SELECT value FROM cms_state WHERE key = ?'),
    putState: db.prepare(`
      INSERT INTO cms_state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
    countFollowers: db.prepare('SELECT COUNT(*) AS count FROM followers'),
    listFollowers: db.prepare(`
      SELECT * FROM followers
      ORDER BY followed_at DESC, actor_id DESC
      LIMIT ? OFFSET ?
    `),
    followerById: db.prepare('SELECT * FROM followers WHERE actor_id = ?'),
    putFollower: db.prepare(`
      INSERT INTO followers (
        actor_id, inbox_id, shared_inbox_id, handle, name, icon_url, url, followed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (actor_id) DO UPDATE SET
        inbox_id = excluded.inbox_id,
        shared_inbox_id = excluded.shared_inbox_id,
        handle = excluded.handle,
        name = excluded.name,
        icon_url = excluded.icon_url,
        url = excluded.url
    `),
    deleteFollower: db.prepare('DELETE FROM followers WHERE actor_id = ?'),
    clearFollowers: db.prepare('DELETE FROM followers'),
    clearInboxActivities: db.prepare('DELETE FROM ap_inbox'),
    resetInboxSequence: db.prepare("DELETE FROM sqlite_sequence WHERE name = 'ap_inbox'"),
    countInboxActivities: db.prepare('SELECT COUNT(*) AS count FROM ap_inbox'),
    listInboxActivities: db.prepare(`
      SELECT * FROM ap_inbox
      ORDER BY received_at DESC, id DESC
      LIMIT ? OFFSET ?
    `),
    logInboxActivity: db.prepare(`
      INSERT INTO ap_inbox (
        activity_id, activity_type, actor_id, object_id, in_reply_to, received_at, json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (activity_id) DO UPDATE SET
        activity_type = excluded.activity_type,
        actor_id = excluded.actor_id,
        object_id = excluded.object_id,
        in_reply_to = excluded.in_reply_to,
        received_at = excluded.received_at,
        json = excluded.json
      RETURNING *
    `),
    countReplies: db.prepare(`SELECT COUNT(*) AS count FROM ap_inbox WHERE ${IS_REPLY}`),
    listReplies: db.prepare(`
      SELECT * FROM ap_inbox WHERE ${IS_REPLY}
      ORDER BY received_at DESC, id DESC
      LIMIT ? OFFSET ?
    `),
    countRepliesTo: db.prepare(`
      SELECT COUNT(*) AS count FROM ap_inbox WHERE ${IS_REPLY} AND in_reply_to = ?
    `),
    listRepliesTo: db.prepare(`
      SELECT * FROM ap_inbox WHERE ${IS_REPLY} AND in_reply_to = ?
      ORDER BY received_at DESC, id DESC
      LIMIT ? OFFSET ?
    `),
    listCommentsFor: db.prepare(`
      SELECT * FROM comments WHERE slug = ? ORDER BY submitted_at, id
    `),
    commentById: db.prepare('SELECT * FROM comments WHERE id = ?'),
    countCommentsFor: db.prepare(
      'SELECT COUNT(*) AS count FROM comments WHERE slug = ? AND status = ?',
    ),
    countCommentsByStatus: db.prepare(
      'SELECT status, COUNT(*) AS count FROM comments GROUP BY status',
    ),
    hasApprovedAuthor: db.prepare(`
      SELECT 1 FROM comments
      WHERE status = 'approved' AND author_name = ? AND author_email IS ?
      LIMIT 1
    `),
    putComment: db.prepare(`
      INSERT INTO comments (
        id, slug, permalink, source, kind, status,
        author_name, author_url, author_email,
        markdown, html, submitted_at, address_hash, in_reply_to
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        slug = excluded.slug,
        permalink = excluded.permalink,
        source = excluded.source,
        kind = excluded.kind,
        status = excluded.status,
        author_name = excluded.author_name,
        author_url = excluded.author_url,
        author_email = excluded.author_email,
        markdown = excluded.markdown,
        html = excluded.html,
        submitted_at = excluded.submitted_at,
        address_hash = excluded.address_hash,
        in_reply_to = excluded.in_reply_to
    `),
    deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
    clearComments: db.prepare('DELETE FROM comments'),
    recordDelivery: db.prepare(`
      INSERT INTO ap_deliveries (
        activity_id, activity_type, object_id, slug,
        actor_id, inbox_id, status, error, attempted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (activity_id, actor_id) DO UPDATE SET
        activity_type = excluded.activity_type,
        object_id = excluded.object_id,
        slug = excluded.slug,
        inbox_id = excluded.inbox_id,
        status = excluded.status,
        error = excluded.error,
        attempted_at = excluded.attempted_at
      RETURNING *
    `),
    listDeliveries: db.prepare(`
      SELECT * FROM ap_deliveries WHERE activity_id = ? ORDER BY actor_id
    `),
    countDeliveriesByStatus: db.prepare(`
      SELECT status, COUNT(*) AS count FROM ap_deliveries WHERE activity_id = ? GROUP BY status
    `),
    lastDeliveryToInbox: db.prepare(`
      SELECT * FROM ap_deliveries WHERE inbox_id = ?
      ORDER BY attempted_at DESC, rowid DESC
      LIMIT 1
    `),
    lastDeliveryToObject: db.prepare(`
      SELECT * FROM ap_deliveries WHERE object_id = ?
      ORDER BY attempted_at DESC, rowid DESC
      LIMIT 1
    `),
    listRelays: db.prepare('SELECT * FROM ap_relays ORDER BY created_at, inbox_id'),
    relayByInbox: db.prepare('SELECT * FROM ap_relays WHERE inbox_id = ?'),
    relayByFollow: db.prepare('SELECT * FROM ap_relays WHERE follow_id = ?'),
    putRelay: db.prepare(`
      INSERT INTO ap_relays (
        inbox_id, actor_id, state, reason, follow_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (inbox_id) DO UPDATE SET
        actor_id = excluded.actor_id,
        state = excluded.state,
        reason = excluded.reason,
        follow_id = excluded.follow_id,
        updated_at = excluded.updated_at
      RETURNING *
    `),
    deleteRelay: db.prepare('DELETE FROM ap_relays WHERE inbox_id = ?'),
  };

  let open = true;

  /**
   * Run a body with every write in it committed together, or none of them.
   *
   * The rebuilds are what need it: emptying an index and filling it again is
   * one step to everything reading it, and a half-emptied `followers` is a
   * site that has quietly stopped delivering to half its followers.
   */
  function inTransaction(body: () => void): void {
    db.exec('BEGIN');
    try {
      body();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

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

  return {
    file,

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

    countFollowers() {
      const row = statements.countFollowers.get() as Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    listFollowers(options = {}) {
      const rows = statements.listFollowers.all(
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      ) as Record<string, unknown>[];
      return rows.map(toFollower);
    },

    getFollower(actorId) {
      const row = statements.followerById.get(actorId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : toFollower(row);
    },

    putFollower(follower) {
      statements.putFollower.run(
        follower.actorId,
        follower.inboxId,
        follower.sharedInboxId,
        follower.handle,
        follower.name,
        follower.iconUrl,
        follower.url,
        follower.followedAt ?? new Date().toISOString(),
      );
      // Read back rather than returning what was written: the upsert leaves an
      // existing `followed_at` alone, so the row is the only thing that knows
      // when the follow really began.
      const row = statements.followerById.get(follower.actorId) as
        Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new Error(`The follower "${follower.actorId}" vanished between insert and read.`);
      }
      return toFollower(row);
    },

    deleteFollower(actorId) {
      return statements.deleteFollower.run(actorId).changes > 0;
    },

    replaceFollowers(followers) {
      inTransaction(() => {
        statements.clearFollowers.run();
        for (const follower of followers) {
          statements.putFollower.run(
            follower.actorId,
            follower.inboxId,
            follower.sharedInboxId,
            follower.handle,
            follower.name,
            follower.iconUrl,
            follower.url,
            follower.followedAt ?? new Date().toISOString(),
          );
        }
      });
    },

    countInboxActivities() {
      const row = statements.countInboxActivities.get() as Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    listInboxActivities(options = {}) {
      const rows = statements.listInboxActivities.all(
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      ) as Record<string, unknown>[];
      return rows.map(toInboxActivity);
    },

    logInboxActivity(activity) {
      const row = statements.logInboxActivity.get(
        activity.activityId,
        activity.activityType,
        activity.actorId,
        activity.objectId,
        // Derived here rather than passed in, so the column cannot say
        // something the stored activity does not.
        replyTargetOf(activity.json),
        activity.receivedAt ?? new Date().toISOString(),
        activity.json,
      ) as Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new Error(`The activity "${activity.activityType}" was not written to the log.`);
      }
      return toInboxActivity(row);
    },

    replaceInboxActivities(activities) {
      inTransaction(() => {
        statements.clearInboxActivities.run();
        // The AUTOINCREMENT high-water mark goes with the rows, so the same
        // log always produces the same ids however many times it is rebuilt.
        statements.resetInboxSequence.run();
        for (const activity of activities) {
          statements.logInboxActivity.run(
            activity.activityId,
            activity.activityType,
            activity.actorId,
            activity.objectId,
            replyTargetOf(activity.json),
            activity.receivedAt ?? new Date().toISOString(),
            activity.json,
          );
        }
      });
    },

    countReplies() {
      const row = statements.countReplies.get() as Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    listReplies(options = {}) {
      const rows = statements.listReplies.all(
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      ) as Record<string, unknown>[];
      return rows.map(toInboxActivity);
    },

    countRepliesTo(objectId) {
      const row = statements.countRepliesTo.get(objectId) as Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    listRepliesTo(objectId, options = {}) {
      const rows = statements.listRepliesTo.all(
        objectId,
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      ) as Record<string, unknown>[];
      return rows.map(toInboxActivity);
    },

    listActivitiesAbout(objectIds) {
      if (objectIds.length === 0) return [];

      // Prepared here rather than beside the others because the number of
      // placeholders is the number of ids: a conversation asks about the post,
      // then about the notes that answered it, and neither count is known when
      // the statements are built.
      const placeholders = objectIds.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `SELECT * FROM ap_inbox
           WHERE object_id IN (${placeholders}) OR in_reply_to IN (${placeholders})
           ORDER BY id ASC`,
        )
        .all(...objectIds, ...objectIds) as Record<string, unknown>[];
      return rows.map(toInboxActivity);
    },

    listCommentsFor(slug) {
      return (statements.listCommentsFor.all(slug) as Record<string, unknown>[]).map(toComment);
    },

    listComments(options = {}) {
      // Prepared here rather than beside the others because the `WHERE` is not
      // fixed: the screen asks for one status and the site-wide feed asks for
      // approved comments across every post.
      const where = options.status === undefined ? '' : 'WHERE status = ?';
      const parameters = options.status === undefined ? [] : [options.status];
      const rows = db
        .prepare(
          `SELECT * FROM comments ${where}
           ORDER BY submitted_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...parameters, options.limit ?? NO_LIMIT, options.offset ?? 0) as Record<
        string,
        unknown
      >[];
      return rows.map(toComment);
    },

    countCommentsFor(slug, status) {
      const row = statements.countCommentsFor.get(slug, status) as
        Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    getComment(id) {
      const row = statements.commentById.get(id) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : toComment(row);
    },

    countCommentsByStatus() {
      const counts: Record<CommentStatus, number> = { pending: 0, approved: 0, spam: 0 };
      for (const row of statements.countCommentsByStatus.all() as Record<string, unknown>[]) {
        counts[commentStatus(row['status'])] += Number(row['count'] ?? 0);
      }
      return counts;
    },

    hasApprovedAuthor(name, email) {
      // `IS` rather than `=`, so an author who gave no email is matched by the
      // rows that gave none either instead of matching nothing.
      return statements.hasApprovedAuthor.get(name, email) !== undefined;
    },

    putComment(comment) {
      statements.putComment.run(
        comment.id,
        comment.slug,
        comment.permalink,
        comment.source,
        comment.kind,
        comment.status,
        comment.author.name,
        comment.author.url,
        comment.author.email,
        comment.content.markdown,
        comment.content.html,
        comment.submitted,
        comment.addressHash,
        comment.inReplyTo,
      );
      return comment;
    },

    deleteComment(id) {
      return statements.deleteComment.run(id).changes > 0;
    },

    replaceComments(comments) {
      inTransaction(() => {
        statements.clearComments.run();
        for (const comment of comments) {
          statements.putComment.run(
            comment.id,
            comment.slug,
            comment.permalink,
            comment.source,
            comment.kind,
            comment.status,
            comment.author.name,
            comment.author.url,
            comment.author.email,
            comment.content.markdown,
            comment.content.html,
            comment.submitted,
            comment.addressHash,
            comment.inReplyTo,
          );
        }
      });
    },

    recordDelivery(delivery) {
      const row = statements.recordDelivery.get(
        delivery.activityId,
        delivery.activityType,
        delivery.objectId,
        delivery.slug,
        delivery.actorId,
        delivery.inboxId,
        delivery.status,
        delivery.error,
        delivery.attemptedAt ?? new Date().toISOString(),
      ) as Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new Error(
          `The delivery of "${delivery.activityId}" to "${delivery.actorId}" was not recorded.`,
        );
      }
      return toDelivery(row);
    },

    listDeliveries(activityId) {
      const rows = statements.listDeliveries.all(activityId) as Record<string, unknown>[];
      return rows.map(toDelivery);
    },

    countDeliveriesByStatus(activityId) {
      const counts: Record<DeliveryStatus, number> = { sent: 0, queued: 0, failed: 0 };
      for (const row of statements.countDeliveriesByStatus.all(activityId) as Record<
        string,
        unknown
      >[]) {
        const status = deliveryStatus(row['status']);
        counts[status] += Number(row['count'] ?? 0);
      }
      return counts;
    },

    lastDeliveryToInbox(inboxId) {
      const row = statements.lastDeliveryToInbox.get(inboxId) as
        Record<string, unknown> | undefined;
      return row === undefined ? undefined : toDelivery(row);
    },

    lastDeliveryToObject(objectId) {
      const row = statements.lastDeliveryToObject.get(objectId) as
        Record<string, unknown> | undefined;
      return row === undefined ? undefined : toDelivery(row);
    },

    listRelays() {
      return (statements.listRelays.all() as Record<string, unknown>[]).map(toRelay);
    },

    getRelay(inboxId) {
      const row = statements.relayByInbox.get(inboxId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : toRelay(row);
    },

    getRelayByFollow(followId) {
      const row = statements.relayByFollow.get(followId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : toRelay(row);
    },

    putRelay(relay) {
      const now = new Date().toISOString();
      const row = statements.putRelay.get(
        relay.inboxId,
        relay.actorId,
        relay.state,
        relay.reason,
        relay.followId,
        relay.createdAt ?? now,
        now,
      ) as Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new Error(`The relay subscription to "${relay.inboxId}" was not written.`);
      }
      return toRelay(row);
    },

    deleteRelay(inboxId) {
      return statements.deleteRelay.run(inboxId).changes > 0;
    },

    pruneSessions(now = new Date()) {
      return Number(statements.pruneSessions.run(now.toISOString()).changes);
    },

    legacySettings() {
      // Prepared here rather than with the rest, because the table this reads
      // is one that will not be there: a statement over a missing table throws
      // when it is prepared, which would take the whole store down.
      if (!hasTable(db, 'settings')) return undefined;

      return (
        db.prepare('SELECT key, value, updated_at FROM settings').all() as Record<string, unknown>[]
      ).map((row) => ({
        key: String(row['key']),
        value: String(row['value']),
        updatedAt: String(row['updated_at']),
      }));
    },

    legacyActorKeys() {
      // Prepared here for the same reason `legacySettings` is: the table is one
      // that will not be there, and a statement over a missing table throws
      // when it is prepared rather than when it is run.
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
    },

    legacyUsers() {
      // Prepared here for the same reason `legacySettings` is: the table is
      // one that will not be there, and a statement over a missing table
      // throws when it is prepared rather than when it is run.
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
    },

    dropLegacyTable(name) {
      // The name is never a caller's to invent: it is one of this file's own
      // shipped table names, so quoting it is enough.
      db.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
    },

    getState(key) {
      const row = statements.getState.get(key) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : String(row['value']);
    },

    setState(key, value) {
      statements.putState.run(key, value, new Date().toISOString());
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

function isFlashMessage(value: unknown): value is FlashMessage {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry['kind'] === 'notice' || entry['kind'] === 'error') &&
    typeof entry['message'] === 'string'
  );
}

/**
 * What a `LIMIT` means when the caller named none. SQLite reads a negative
 * limit as "every row", which is what an unpaged list asks for.
 */
const NO_LIMIT = -1;

/**
 * A `TEXT` column that may be `NULL`, as a string or `null`.
 *
 * Anything that is not text is read as `null` rather than stringified: every
 * column this is used on is declared `TEXT`, so a value of another shape is a
 * row somebody else wrote, and `[object Object]` is a worse answer than none.
 */
function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toFollower(row: Record<string, unknown>): Follower {
  return {
    actorId: String(row['actor_id']),
    inboxId: String(row['inbox_id']),
    sharedInboxId: nullableText(row['shared_inbox_id']),
    handle: nullableText(row['handle']),
    name: nullableText(row['name']),
    iconUrl: nullableText(row['icon_url']),
    url: nullableText(row['url']),
    followedAt: String(row['followed_at']),
  };
}

function toInboxActivity(row: Record<string, unknown>): InboxActivity {
  return {
    id: Number(row['id']),
    activityId: nullableText(row['activity_id']),
    activityType: String(row['activity_type']),
    actorId: String(row['actor_id']),
    objectId: nullableText(row['object_id']),
    inReplyTo: nullableText(row['in_reply_to']),
    receivedAt: String(row['received_at']),
    json: String(row['json']),
  };
}

function toDelivery(row: Record<string, unknown>): Delivery {
  return {
    activityId: String(row['activity_id']),
    activityType: String(row['activity_type']),
    objectId: String(row['object_id']),
    slug: nullableText(row['slug']),
    actorId: String(row['actor_id']),
    inboxId: String(row['inbox_id']),
    status: deliveryStatus(row['status']),
    error: nullableText(row['error']),
    attemptedAt: String(row['attempted_at']),
  };
}

function toComment(row: Record<string, unknown>): PostComment {
  return {
    id: String(row['id']),
    slug: String(row['slug']),
    permalink: String(row['permalink']),
    source: oneOf(row['source'], COMMENT_SOURCES, 'comment'),
    kind: oneOf(row['kind'], COMMENT_KINDS, 'reply'),
    status: commentStatus(row['status']),
    author: {
      name: String(row['author_name']),
      url: nullableText(row['author_url']),
      email: nullableText(row['author_email']),
    },
    content: { markdown: String(row['markdown']), html: String(row['html']) },
    submitted: String(row['submitted_at']),
    addressHash: nullableText(row['address_hash']),
    inReplyTo: nullableText(row['in_reply_to']),
  };
}

/**
 * A stored comment status, or `pending` for one this version does not know.
 *
 * Pending is the safe reading: showing a comment nobody approved is the one
 * mistake a moderation queue cannot make, and the screen is right there for
 * the row.
 */
function commentStatus(value: unknown): CommentStatus {
  return oneOf(value, COMMENT_STATUSES, 'pending');
}

/** A stored enumeration value, or the fallback for one this version does not know. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function toRelay(row: Record<string, unknown>): Relay {
  return {
    inboxId: String(row['inbox_id']),
    actorId: nullableText(row['actor_id']),
    state: relayState(row['state']),
    reason: nullableText(row['reason']),
    followId: nullableText(row['follow_id']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

/**
 * A stored relay state, or `pending` for one this version does not know.
 *
 * Pending is the safe reading of an unknown state: a subscription this version
 * cannot make sense of is one it should not be delivering public posts to, and
 * Retry is on the screen for exactly that row.
 */
function relayState(value: unknown): RelayState {
  return RELAY_STATES.includes(value as RelayState) ? (value as RelayState) : 'pending';
}

/**
 * A stored status, or `failed` for one this version does not know.
 *
 * An unreadable status is reported as the pessimistic one: an admin screen
 * showing a delivery as failed when it was not is a nuisance, and showing one
 * as sent when nobody knows is a lie.
 */
function deliveryStatus(value: unknown): DeliveryStatus {
  return DELIVERY_STATUSES.includes(value as DeliveryStatus) ? (value as DeliveryStatus) : 'failed';
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

/** Whether the database has a table by that name. */
function hasTable(db: DatabaseSync, name: string): boolean {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").all(name)
      .length > 0
  );
}

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

/** The table this store's applied versions are recorded in. */
const LEDGER = 'admin_migrations';

/**
 * Schema versions for the admin tables, applied in order. They keep their own
 * ledger so their numbering never collides with the content index's.
 *
 * Never edit a migration that has shipped; append a new one.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    // Users and sessions, when SQLite still held both. decision-9 moved the
    // accounts into `data/users.json`, so nothing reads the users table any
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
    // Site settings, when SQLite was still the source of them. decision-9
    // moved them into content/_data/site.json, so nothing reads this table
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
    // The site actor's signing keys, when SQLite still held them. decision-9
    // moved them into JWK files under `data/keys`, so nothing reads this table
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
    // The site's followers (doc-4). Fedify's KV store is a cache and may be
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
    // Outbound delivery (doc-4, decision-5). Two tables, because an activity
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
    // from the inbox log (TASK-32) holds what this one holds.
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
    // Relay subscriptions (FEP-ae0c, TASK-40). The list of relays is a
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
    // table any more: decision-9 moved the accounts into `data/users.json` and
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
    // The outcomes without the payloads. decision-9 replaces "send this stored
    // activity again" with "send this post as it now reads", so nothing needs
    // the JSON-LD any more and `ap_outbound` goes: an activity rebuilt from
    // the file is the current answer, and a copy of what went out last time
    // could only ever be a staler one.
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
    // What a post's conversation is read by (TASK-49). `in_reply_to` already
    // had an index because a post's replies are counted on every feed; the
    // object an activity is about had none, and that is the column a like, a
    // boost, a `Delete` of a reply and an `Undo` of a like are all found by.
    version: 13,
    sql: `
      CREATE INDEX ap_inbox_object_id ON ap_inbox (object_id);
    `,
  },
  {
    // Native comments (TASK-50), which are files under
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
];
