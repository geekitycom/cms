/**
 * What the plugin keeps in its data folder, `data/plugins/@geekity/plugin-wordpress/`:
 * the number the WordPress ActivityPub plugin gave each person, and when each
 * of its old paths was last asked for.
 *
 * Files rather than a table, because the database is a cache a site may delete
 * (decision-9), and both of these are facts the site cannot work out again.
 */

import type { PluginDataFolder, PluginSite } from '@geekity/cms/plugin';

/** Where the plugin's REST namespace lives, on the site's origin. */
export const WORDPRESS_ACTIVITYPUB_BASE = '/wp-json/activitypub/1.0';

/** The plugin's actor path. Its identifier is the WordPress user's number. */
export const WORDPRESS_ACTOR_PATH = `${WORDPRESS_ACTIVITYPUB_BASE}/actors/{identifier}` as const;

/** The actor's inbox, outbox and two follow collections, as the plugin spells them. */
export const WORDPRESS_INBOX_PATH = `${WORDPRESS_ACTOR_PATH}/inbox` as const;
export const WORDPRESS_OUTBOX_PATH = `${WORDPRESS_ACTOR_PATH}/outbox` as const;
export const WORDPRESS_FOLLOWERS_PATH = `${WORDPRESS_ACTOR_PATH}/followers` as const;
export const WORDPRESS_FOLLOWING_PATH = `${WORDPRESS_ACTOR_PATH}/following` as const;

/** The plugin's instance-wide inbox, which its `sharedInbox` endpoint names. */
export const WORDPRESS_SHARED_INBOX_PATH = `${WORDPRESS_ACTIVITYPUB_BASE}/inbox` as const;

/** The file mapping each username to its WordPress number. */
export const ACTORS_FILE = 'actors.json';

/** The file holding when each path was last asked for. */
export const REQUESTS_FILE = 'requests.json';

/** One of the plugin's paths, as the record of what was asked for names it. */
export type WordPressRoute = 'actor' | 'inbox' | 'outbox' | 'followers' | 'following';

/** Every per-person path, in the order the plugin's actor names them. */
export const WORDPRESS_ROUTES: readonly WordPressRoute[] = [
  'actor',
  'inbox',
  'outbox',
  'followers',
  'following',
];

/** Which compatibility path a request is for, and whose. */
export interface WordPressRequestTarget {
  /** The path it is, or `sharedInbox` for the instance-wide one. */
  readonly route: WordPressRoute | 'sharedInbox';
  /** The WordPress number in the path, or `undefined` for the shared inbox. */
  readonly wordpressActorId?: string | undefined;
}

/**
 * The compatibility path a request asks for, or `undefined` for anything else.
 *
 * Matched here rather than left to Fedify because the record of what was last
 * asked for is written whether or not a user answers: a delivery to a number
 * nobody carries is still a peer holding the old URL. Fedify's router still
 * decides what is served.
 */
export function wordPressRequestTarget(pathname: string): WordPressRequestTarget | undefined {
  if (pathname === WORDPRESS_SHARED_INBOX_PATH) return { route: 'sharedInbox' };

  const under = `${WORDPRESS_ACTIVITYPUB_BASE}/actors/`;
  if (!pathname.startsWith(under)) return undefined;

  const [number, name, ...rest] = pathname.slice(under.length).split('/');
  if (number === undefined || number === '' || rest.length > 0) return undefined;

  if (name === undefined || name === '') return { route: 'actor', wordpressActorId: number };
  if (isWordPressRoute(name) && name !== 'actor') return { route: name, wordpressActorId: number };
  return undefined;
}

/** When each compatibility path was last asked for. */
export interface WordPressRequests {
  /** When the instance-wide inbox was last delivered to, or `undefined`. */
  readonly sharedInbox?: string | undefined;
  /** When each of a user's own paths was last asked for, by username. */
  readonly users: Readonly<Record<string, Readonly<Partial<Record<WordPressRoute, string>>>>>;
}

/** Thrown when a WordPress number already belongs to another user. */
export class ConflictingWordPressIdError extends Error {
  override readonly name = 'ConflictingWordPressIdError';
  /** The user who already has it. */
  readonly username: string;

  constructor(username: string, wordpressActorId: number) {
    super(`WordPress actor ${String(wordpressActorId)} already belongs to "${username}".`);
    this.username = username;
  }
}

/** The plugin's two files, read and written through its data folder. */
export interface WordPressRecords {
  /** Each username's WordPress number. */
  actors(): ReadonlyMap<string, number>;
  /**
   * The user the plugin numbered `identifier`, or `undefined`. The identifier
   * is a path segment, so it is compared as the decimal the plugin writes:
   * `02` and `2.0` name nobody, because neither is a URL it ever published.
   * A number whose user the site no longer has names nobody either.
   */
  userByNumber(site: PluginSite, identifier: string): string | undefined;
  /**
   * Give a user their WordPress number. Returns whether anything changed;
   * throws {@link ConflictingWordPressIdError} when another user has it.
   */
  setNumber(username: string, wordpressActorId: number): Promise<boolean>;
  requests(): WordPressRequests;
  /**
   * Record that one path was just asked for. A path whose number names
   * nobody is not recorded: the record is per user.
   */
  recordRequest(options: {
    target: WordPressRequestTarget;
    username: string | undefined;
    at: Date;
  }): Promise<void>;
}

export function wordPressRecords(data: PluginDataFolder): WordPressRecords {
  function actors(): Map<string, number> {
    return actorsFrom(parseOrUndefined(data.read(ACTORS_FILE)));
  }

  return {
    actors,

    userByNumber(site, identifier) {
      if (!/^[1-9][0-9]*$/.test(identifier)) return undefined;
      const wanted = Number(identifier);
      const known = new Set(site.users().map((user) => user.username));
      for (const [username, number] of actors()) {
        if (number === wanted && known.has(username)) return username;
      }
      return undefined;
    },

    async setNumber(username, wordpressActorId) {
      let changed = false;
      await data.update(ACTORS_FILE, (current) => {
        const held = actorsFrom(parseOrUndefined(current));
        for (const [other, number] of held) {
          if (other !== username && number === wordpressActorId) {
            throw new ConflictingWordPressIdError(other, wordpressActorId);
          }
        }
        changed = held.get(username) !== wordpressActorId;
        held.set(username, wordpressActorId);
        return `${JSON.stringify(Object.fromEntries(held), null, 2)}\n`;
      });
      return changed;
    },

    requests: () => requestsFrom(parseOrUndefined(data.read(REQUESTS_FILE))),

    async recordRequest({ target, username, at }) {
      if (target.route !== 'sharedInbox' && username === undefined) return;
      const instant = at.toISOString();

      await data.update(REQUESTS_FILE, (current) => {
        const requests = requestsFrom(parseOrUndefined(current));
        const next: WordPressRequests =
          target.route === 'sharedInbox'
            ? { ...requests, sharedInbox: instant }
            : {
                ...requests,
                users: {
                  ...requests.users,
                  [username ?? '']: { ...requests.users[username ?? ''], [target.route]: instant },
                },
              };
        return `${JSON.stringify(next, null, 2)}\n`;
      });
    },
  };
}

/** The bytes of a file as whatever JSON they hold, or nothing usable. */
function parseOrUndefined(source: string | undefined): unknown {
  if (source === undefined) return undefined;
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

/**
 * The numbers a file holds, keeping only whole positive ones: anything else
 * could never appear in one of the plugin's paths.
 */
function actorsFrom(value: unknown): Map<string, number> {
  const actors = new Map<string, number>();
  if (!isRecord(value)) return actors;
  for (const [username, number] of Object.entries(value)) {
    if (typeof number === 'number' && Number.isInteger(number) && number > 0) {
      actors.set(username, number);
    }
  }
  return actors;
}

/**
 * Whatever the file held as the instants this version understands. Read key
 * by key and dropped rather than refused: a damaged record should cost the
 * screen a column, not the site a request.
 */
function requestsFrom(value: unknown): WordPressRequests {
  if (!isRecord(value)) return { users: {} };

  const users: Record<string, Partial<Record<WordPressRoute, string>>> = {};
  const listed = value['users'];
  if (isRecord(listed)) {
    for (const [username, routes] of Object.entries(listed)) {
      if (!isRecord(routes)) continue;
      const kept: Partial<Record<WordPressRoute, string>> = {};
      for (const [name, instant] of Object.entries(routes)) {
        if (typeof instant === 'string' && isWordPressRoute(name)) kept[name] = instant;
      }
      if (Object.keys(kept).length > 0) users[username] = kept;
    }
  }

  const shared = value['sharedInbox'];
  return { ...(typeof shared === 'string' ? { sharedInbox: shared } : {}), users };
}

function isWordPressRoute(name: string): name is WordPressRoute {
  return (WORDPRESS_ROUTES as readonly string[]).includes(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
