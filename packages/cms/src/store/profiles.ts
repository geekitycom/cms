import type { DatabaseSync } from 'node:sqlite';

import { nullableText } from './rows.ts';

/**
 * How a remote actor presents itself: what a conversation shows of somebody
 * who is not a follower (TASK-184).
 *
 * Read out of the actor document when one of their activities arrives, and
 * kept only in the cache (decision-9): a profile is somebody else's to change,
 * and it can always be fetched again.
 */
export interface ActorProfile {
  /** The actor's ActivityStreams id, which is what identifies them. */
  readonly actorId: string;
  /** `@preferredUsername@host`, or `null` when the document names no username. */
  readonly handle: string | null;
  /** The display name the actor published, or `null`. */
  readonly name: string | null;
  /** The actor's avatar, or `null`. */
  readonly iconUrl: string | null;
  /** The actor's profile page, for a human following the link, or `null`. */
  readonly url: string | null;
}

/** An {@link ActorProfile} as the cache holds it, with when it was fetched. */
export interface StoredActorProfile extends ActorProfile {
  /** When the document was read, as an ISO 8601 instant. */
  readonly fetchedAt: string;
}

export interface ProfileStore {
  /**
   * Whether a URL is an avatar a reader of this site can be shown: the picture
   * of a follower who has done something to a post, or of the author of an
   * approved comment or webmention. The avatar proxy fetches nothing else
   * (TASK-134), so it cannot be pointed at an arbitrary URL.
   */
  isAvatarSource(url: string): boolean;
  /** Every URL {@link ProfileStore.isAvatarSource} answers yes for, each once. */
  listAvatarSources(): string[];
  /** The stored profile of a remote actor, or `undefined` (TASK-184). */
  getActorProfile(actorId: string): StoredActorProfile | undefined;
  /** Store a remote actor's profile, replacing whatever was stored for them. */
  putActorProfile(profile: StoredActorProfile): void;
  /**
   * Every actor the inbox log names who is not a follower and whose profile
   * is missing or was fetched before `fetchedBefore`, each once: the actors
   * whose profiles are due.
   */
  listActorsToProfile(fetchedBefore: string): string[];
}

export function openProfileStore(db: DatabaseSync): ProfileStore {
  const statements = {
    isAvatarSource: db.prepare(`
      SELECT 1 FROM followers
      WHERE icon_url = ?1 AND actor_id IN (SELECT actor_id FROM ap_inbox)
      UNION ALL
      SELECT 1 FROM actor_profiles
      WHERE icon_url = ?1 AND actor_id IN (SELECT actor_id FROM ap_inbox)
      UNION ALL
      SELECT 1 FROM comments WHERE author_avatar = ?1 AND status = 'approved'
      LIMIT 1
    `),
    listAvatarSources: db.prepare(`
      SELECT icon_url AS url FROM followers
      WHERE icon_url IS NOT NULL AND actor_id IN (SELECT actor_id FROM ap_inbox)
      UNION
      SELECT icon_url AS url FROM actor_profiles
      WHERE icon_url IS NOT NULL AND actor_id IN (SELECT actor_id FROM ap_inbox)
      UNION
      SELECT author_avatar AS url FROM comments
      WHERE author_avatar IS NOT NULL AND status = 'approved'
    `),
    actorProfileById: db.prepare('SELECT * FROM actor_profiles WHERE actor_id = ?'),
    putActorProfile: db.prepare(`
      INSERT INTO actor_profiles (actor_id, handle, name, icon_url, url, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (actor_id) DO UPDATE SET
        handle = excluded.handle,
        name = excluded.name,
        icon_url = excluded.icon_url,
        url = excluded.url,
        fetched_at = excluded.fetched_at
    `),
    listActorsToProfile: db.prepare(`
      SELECT DISTINCT actor_id FROM ap_inbox
      WHERE actor_id NOT IN (SELECT actor_id FROM followers)
        AND actor_id NOT IN (SELECT actor_id FROM actor_profiles WHERE fetched_at >= ?)
      ORDER BY actor_id
    `),
  };
  return {
    isAvatarSource(url) {
      return statements.isAvatarSource.get(url) !== undefined;
    },

    listAvatarSources() {
      return (statements.listAvatarSources.all() as Record<string, unknown>[]).map((row) =>
        String(row['url']),
      );
    },

    getActorProfile(actorId) {
      const row = statements.actorProfileById.get(actorId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : toActorProfile(row);
    },

    putActorProfile(profile) {
      statements.putActorProfile.run(
        profile.actorId,
        profile.handle,
        profile.name,
        profile.iconUrl,
        profile.url,
        profile.fetchedAt,
      );
    },

    listActorsToProfile(fetchedBefore) {
      return (statements.listActorsToProfile.all(fetchedBefore) as Record<string, unknown>[]).map(
        (row) => String(row['actor_id']),
      );
    },
  };
}

function toActorProfile(row: Record<string, unknown>): StoredActorProfile {
  return {
    actorId: String(row['actor_id']),
    handle: nullableText(row['handle']),
    name: nullableText(row['name']),
    iconUrl: nullableText(row['icon_url']),
    url: nullableText(row['url']),
    fetchedAt: String(row['fetched_at']),
  };
}
