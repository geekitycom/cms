import type { DatabaseSync } from 'node:sqlite';

import { inTransaction, NO_LIMIT, nullableText } from './rows.ts';
import type { ListPageOptions } from './rows.ts';

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
  /**
   * Which user is followed (decision-14).
   *
   * Every user is an actor with followers of their own, so a follower is only
   * ever a follower *of somebody*: the column is what makes one person's
   * followers collection, and one person's delivery, theirs. It is the name of
   * the directory the file came from rather than anything the file says.
   */
  readonly username: string;
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

export interface FollowerStore {
  /**
   * How many actors follow one user, or the whole site when no user is named.
   * What a user's followers collection counts.
   */
  countFollowers(username?: string): number;
  /**
   * Followers, newest follow first, optionally one page of them.
   *
   * Newest first matches the outbox, and means the collection's first page is
   * the followers a human is most likely to be looking for. A follow that
   * arrives while somebody is walking the collection shifts the pages under
   * them by one, which is the same trade the outbox makes.
   */
  listFollowers(username?: string, options?: ListPageOptions): Follower[];
  /** One user's follower by actor id, or `undefined`. */
  getFollower(username: string, actorId: string): Follower | undefined;

  /**
   * Store a follower, replacing whatever was known about that actor. The
   * original `followedAt` is kept, because a repeat `Follow` from an actor
   * that already follows is a redelivery rather than a new follow.
   */
  putFollower(follower: NewFollower): Follower;
  /** Forget one user's follower. Returns `false` when there was nothing to forget. */
  deleteFollower(username: string, actorId: string): boolean;
  /**
   * Make the followers index say exactly this, in one transaction.
   *
   * What a rebuild from every `content/_data/federation/{username}/followers.json` calls
   * (decision-9): the file is the source, so a row it does not carry is a row
   * that should not be delivered to, and replacing the lot is the only way to
   * say that. Nothing outside a rebuild should reach for it.
   */
  replaceFollowers(followers: readonly NewFollower[]): void;
}

export function openFollowerStore(db: DatabaseSync): FollowerStore {
  const statements = {
    // `?1 IS NULL` is how one statement answers both questions: naming a user
    // counts theirs, naming nobody counts the site's.
    countFollowers: db.prepare(
      'SELECT COUNT(*) AS count FROM followers WHERE ?1 IS NULL OR username = ?1',
    ),
    listFollowers: db.prepare(`
      SELECT * FROM followers
      WHERE ?1 IS NULL OR username = ?1
      ORDER BY followed_at DESC, actor_id DESC
      LIMIT ?2 OFFSET ?3
    `),
    followerById: db.prepare('SELECT * FROM followers WHERE username = ? AND actor_id = ?'),

    putFollower: db.prepare(`
      INSERT INTO followers (
        username, actor_id, inbox_id, shared_inbox_id, handle, name, icon_url, url, followed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (username, actor_id) DO UPDATE SET
        inbox_id = excluded.inbox_id,
        shared_inbox_id = excluded.shared_inbox_id,
        handle = excluded.handle,
        name = excluded.name,
        icon_url = excluded.icon_url,
        url = excluded.url
    `),
    deleteFollower: db.prepare('DELETE FROM followers WHERE username = ? AND actor_id = ?'),
    clearFollowers: db.prepare('DELETE FROM followers'),
  };
  return {
    countFollowers(username) {
      const row = statements.countFollowers.get(username ?? null) as
        Record<string, unknown> | undefined;
      return Number(row?.['count'] ?? 0);
    },

    listFollowers(username, options = {}) {
      const rows = statements.listFollowers.all(
        username ?? null,
        options.limit ?? NO_LIMIT,
        options.offset ?? 0,
      ) as Record<string, unknown>[];
      return rows.map(toFollower);
    },

    getFollower(username, actorId) {
      const row = statements.followerById.get(username, actorId) as
        Record<string, unknown> | undefined;
      return row === undefined ? undefined : toFollower(row);
    },

    putFollower(follower) {
      statements.putFollower.run(
        follower.username,
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
      const row = statements.followerById.get(follower.username, follower.actorId) as
        Record<string, unknown> | undefined;
      if (row === undefined) {
        throw new Error(`The follower "${follower.actorId}" vanished between insert and read.`);
      }
      return toFollower(row);
    },

    deleteFollower(username, actorId) {
      return statements.deleteFollower.run(username, actorId).changes > 0;
    },

    replaceFollowers(followers) {
      inTransaction(db, () => {
        statements.clearFollowers.run();
        for (const follower of followers) {
          statements.putFollower.run(
            follower.username,
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
  };
}

function toFollower(row: Record<string, unknown>): Follower {
  return {
    username: String(row['username']),
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
