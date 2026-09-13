import path from 'node:path';

import { createFederation, InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify';
import type { Context, InboxContext } from '@fedify/fedify';
import { Accept, Announce, Create, Delete, Follow, Like, Reject, Undo } from '@fedify/vocab';
import type { Activity } from '@fedify/vocab';

import { listUsers } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import { authorNames } from '../web/authors.ts';
import { userActor } from './actor.ts';
import { federationOrigin } from './paths.ts';
import type { CreateSiteFederationOptions, FederationContextData } from './federation.ts';
import { outboxPage, OUTBOX_PAGE_SIZE } from './federation.ts';
import { followersPage, lastFollowersCursor } from './followers.ts';
import {
  handleAccept,
  handleDelete,
  handleFollow,
  handleLoggedActivity,
  handleReject,
  handleUndo,
} from './inbox.ts';
import type { SiteInboxContext } from './inbox.ts';
import { loadActorKeyPairs } from './keys.ts';
import type { SiteFederation } from './federation.ts';

/**
 * The WordPress ActivityPub plugin's paths, served behind a switch (TASK-70).
 *
 * A follower's server delivers to the inbox URL it cached from the actor
 * document, and replaces it only when it next refetches the actor. A site that
 * moved here from the plugin therefore goes on being delivered to at
 * `/wp-json/activitypub/1.0/actors/2/inbox` and `/wp-json/activitypub/1.0/inbox`
 * for as long as those caches last, and decision-14 calls that **cache rather
 * than identity**: the CMS carries the plugin's layout until the caches have
 * moved on, and no longer.
 *
 * So everything here is behind the `wordpressActivityPub` site setting, and
 * everything a peer reads back is the canonical identity. The actor served at
 * `…/actors/2` is the same `Person` the author URL serves — same `id`, same
 * canonical `inbox` — so a peer that refetches here learns the new endpoints
 * rather than being handed the old ones again. That is what eventually makes
 * the switch safe to turn off.
 *
 * A second `Federation` is how Fedify serves a second inbox path at all: one
 * object may have exactly one pair of inbox listeners, and `ctx.routeActivity`
 * re-verifies from scratch in a way a Mastodon or WordPress `Follow` cannot
 * satisfy (doc-8). The second object shares the canonical one's KV store, and
 * both sets of listeners are set to `per-origin` idempotence, because the
 * default folds the recipient identifier into the key — so the same `Follow`
 * redelivered to `andrew` and to `2` would otherwise be handled twice.
 */

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

/** What {@link createWordPressFederation} takes beyond the canonical options. */
export interface CreateWordPressFederationOptions extends CreateSiteFederationOptions {
  /**
   * The site's own federation, whose contexts every identity here is built
   * from.
   *
   * Fedify derives an actor's id, its key ids and its collection URLs from the
   * path it dispatches the actor at, and the paths here are the plugin's. A
   * document built off this object's own context would tell a peer that the
   * person *is* `…/wp-json/…/actors/2` and sign with a key id under it, which
   * is the opposite of what the switch is for.
   */
  canonical: SiteFederation;
}

/**
 * Build the compatibility federation: the plugin's inbox and collections,
 * mapped to users by the number WordPress gave them.
 *
 * Nothing else is registered. WebFinger, NodeInfo and the actor's real
 * endpoints belong to the canonical federation and stay there; this object
 * exists only so that deliveries and fetches aimed at the old layout land
 * somewhere, signature-verified at the real request path exactly as the
 * canonical inbox verifies them.
 */
export function createWordPressFederation(
  options: CreateWordPressFederationOptions,
): SiteFederation {
  const { canonical } = options;

  const federation = createFederation<FederationContextData>({
    kv: options.kv ?? new MemoryKvStore(),
    origin: federationOrigin(options.baseUrl),
    ...(options.queue === null ? {} : { queue: options.queue ?? new InProcessMessageQueue() }),
    ...(options.allowPrivateAddress === undefined
      ? {}
      : { allowPrivateAddress: options.allowPrivateAddress }),
    ...options.federationOptions,
  });

  /** The user a dispatcher's identifier names, which here is a number. */
  function actorFor(
    context: { data: FederationContextData },
    identifier: string,
  ): User | undefined {
    return userByWordPressActorId(context.data.config.dataDir, identifier);
  }

  /**
   * A context of the canonical federation over the same data.
   *
   * Every id a peer reads or verifies comes from here rather than from the
   * compatibility context, so the actor, the key ids, the `Accept` and the
   * collections a peer is pointed at are the ones the site really publishes.
   */
  function identity(context: Context<FederationContextData>): Context<FederationContextData> {
    return canonical.createContext(new URL(context.origin), context.data);
  }

  /** Every stored `author` string that reads as this user (TASK-67). */
  function namesOf(context: { data: FederationContextData }, user: User): string[] {
    return authorNames(listUsers(context.data.config.dataDir), user);
  }

  federation
    .setActorDispatcher(WORDPRESS_ACTOR_PATH, async (context, identifier) => {
      const user = actorFor(context, identifier);
      if (user === undefined) return null;
      // The canonical document, verbatim: a peer refetching the actor at the
      // old URL is exactly the peer that should learn the new inbox.
      return await userActor(identity(context), user, { baseUrl: context.data.config.baseUrl });
    })
    .setKeyPairsDispatcher(async (context, identifier) => {
      const user = actorFor(context, identifier);
      return user === undefined
        ? []
        : await loadActorKeyPairs(context.data.config.dataDir, user.username);
    });

  federation
    .setOutboxDispatcher(WORDPRESS_OUTBOX_PATH, (context, identifier, cursor) => {
      const user = actorFor(context, identifier);
      return user === undefined
        ? null
        : outboxPage(identity(context), namesOf(context, user), cursor);
    })
    .setCounter((context, identifier) => {
      const user = actorFor(context, identifier);
      return user === undefined ? null : context.data.store.countByAuthor(namesOf(context, user));
    })
    .setFirstCursor((context, identifier) =>
      actorFor(context, identifier) === undefined ? null : '0',
    )
    .setLastCursor((context, identifier) => {
      const user = actorFor(context, identifier);
      if (user === undefined) return null;
      const total = context.data.store.countByAuthor(namesOf(context, user));
      return String(
        total === 0 ? 0 : Math.floor((total - 1) / OUTBOX_PAGE_SIZE) * OUTBOX_PAGE_SIZE,
      );
    });

  federation
    .setFollowersDispatcher(WORDPRESS_FOLLOWERS_PATH, (context, identifier, cursor) => {
      const user = actorFor(context, identifier);
      return user === undefined ? null : followersPage(context, user.username, cursor);
    })
    .setCounter((context, identifier) => {
      const user = actorFor(context, identifier);
      return user === undefined ? null : context.data.admin.countFollowers(user.username);
    })
    .setFirstCursor((context, identifier) =>
      actorFor(context, identifier) === undefined ? null : '0',
    )
    .setLastCursor((context, identifier) => {
      const user = actorFor(context, identifier);
      return user === undefined
        ? null
        : lastFollowersCursor(context.data.admin.countFollowers(user.username));
    });

  federation.setFollowingDispatcher(WORDPRESS_FOLLOWING_PATH, (context, identifier) =>
    actorFor(context, identifier) === undefined ? null : { items: [] },
  );

  // The same five handlers the canonical inbox runs, over a canonical context.
  // `per-origin` idempotence is what keeps one `Follow` redelivered to both
  // inboxes from being handled twice (doc-8); the canonical federation is set
  // the same way, and they share a KV store so the two agree about what they
  // have already seen.
  federation
    .setInboxListeners(WORDPRESS_INBOX_PATH, WORDPRESS_SHARED_INBOX_PATH)
    .withIdempotency('per-origin')
    .on(Follow, canonically(handleFollow))
    .on(Accept, canonically(handleAccept))
    .on(Reject, canonically(handleReject))
    .on(Undo, canonically(handleUndo))
    .on(Delete, canonically(handleDelete))
    .on(Like, canonically(handleLoggedActivity))
    .on(Announce, canonically(handleLoggedActivity))
    .on(Create, canonically(handleLoggedActivity));

  /**
   * One inbox handler, run against the canonical federation.
   *
   * Two things are swapped. The context is the canonical one, so `parseUri`
   * recognises the site's own actor URLs, the `Accept` is signed with the key
   * the actor document publishes and sent from the id its followers hold. And
   * `recipient` — which arrives here as the WordPress number, straight off the
   * path — is the username, because that is what every handler and the inbox
   * log mean by a recipient.
   */
  function canonically<A extends Activity>(
    handle: (context: SiteInboxContext, activity: A) => Promise<void>,
  ): (context: SiteInboxContext, activity: A) => Promise<void> {
    return async (context, activity) => {
      const user = context.recipient === null ? undefined : actorFor(context, context.recipient);
      await handle(withRecipient(identity(context), context, user?.username ?? null), activity);
    };
  }

  return federation;
}

/**
 * A canonical context wearing one inbox delivery's recipient.
 *
 * A `Proxy` rather than a copy: Fedify's context is a class with private state,
 * so its methods have to keep running against the object they were made for.
 * Everything but `recipient` and `forwardActivity` is the canonical context's
 * own.
 */
function withRecipient(
  canonical: Context<FederationContextData>,
  delivered: SiteInboxContext,
  recipient: string | null,
): SiteInboxContext {
  return new Proxy(canonical as unknown as SiteInboxContext, {
    get(target, property) {
      if (property === 'recipient') return recipient;
      // Forwarding is the one thing only the delivering context can do: it
      // holds the bytes that arrived, signatures and all.
      if (property === 'forwardActivity') return delivered.forwardActivity.bind(delivered);
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

/**
 * The user the WordPress ActivityPub plugin numbered `identifier`, or
 * `undefined`.
 *
 * The identifier is a path segment, so it is compared as the decimal the
 * plugin writes: `02` and `2.0` name nobody, because neither is a URL the
 * plugin ever published.
 */
export function userByWordPressActorId(dataDir: string, identifier: string): User | undefined {
  if (!/^[1-9][0-9]*$/.test(identifier)) return undefined;
  const wanted = Number(identifier);
  return listUsers(dataDir).find((user) => user.wordpressActorId === wanted);
}

/** One of the plugin's paths, as the record of what was asked for names it. */
export type WordPressRoute = 'actor' | 'inbox' | 'outbox' | 'followers' | 'following';

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
 * asked for has to be written whether or not a user answers: a delivery to a
 * number nobody carries is still a peer holding the old URL, and it is exactly
 * the sort of thing the owner watching the screen wants to see. Fedify's
 * router still decides what is actually served.
 */
export function wordPressRequestTarget(pathname: string): WordPressRequestTarget | undefined {
  if (pathname === WORDPRESS_SHARED_INBOX_PATH) return { route: 'sharedInbox' };

  const under = `${WORDPRESS_ACTIVITYPUB_BASE}/actors/`;
  if (!pathname.startsWith(under)) return undefined;

  const [number, name, ...rest] = pathname.slice(under.length).split('/');
  if (number === undefined || number === '' || rest.length > 0) return undefined;

  if (name === undefined || name === '') return { route: 'actor', wordpressActorId: number };
  if (name === 'inbox' || name === 'outbox' || name === 'followers' || name === 'following') {
    return { route: name, wordpressActorId: number };
  }
  return undefined;
}

/** The file the instants live in, relative to `dataDir`. */
export const WORDPRESS_REQUESTS_FILE = 'wordpress-activitypub.json';

/** Where that file lives for a given data directory. */
export function wordPressRequestsFile(dataDir: string): string {
  return path.join(dataDir, WORDPRESS_REQUESTS_FILE);
}

/**
 * When each compatibility path was last asked for.
 *
 * A file under `data/` rather than a table, because the database is a cache a
 * site may delete (decision-9) and this is the one thing the switch is watched
 * by: an owner deciding whether every follower's server has refetched the
 * actor should not have that answer reset by a rebuild.
 */
export interface WordPressRequests {
  /** When the instance-wide inbox was last delivered to, or `undefined`. */
  readonly sharedInbox?: string | undefined;
  /** When each of a user's own paths was last asked for, by username. */
  readonly users: Readonly<Record<string, Readonly<Partial<Record<WordPressRoute, string>>>>>;
}

/** The file as it reads now; a site nobody has asked has nothing to say. */
export function readWordPressRequests(dataDir: string): WordPressRequests {
  const source = readFileIfPresentSync(wordPressRequestsFile(dataDir));
  if (source === undefined) return { users: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    // A record of who asked for what is not worth failing a request over, and
    // "never" is the honest answer when the file cannot be read.
    return { users: {} };
  }
  return requestsFrom(parsed);
}

/**
 * Record that one compatibility path was just asked for.
 *
 * Written through {@link updateFileAtomically}, so two deliveries arriving
 * together cannot lose one another's instant and a reader never sees a
 * half-written file. A path whose number names nobody is not recorded: the
 * record is per user, and there is no user to record it against.
 */
export async function recordWordPressRequest(options: {
  dataDir: string;
  target: WordPressRequestTarget;
  username?: string | undefined;
  at: Date;
}): Promise<void> {
  const { target, username } = options;
  if (target.route !== 'sharedInbox' && username === undefined) return;

  const instant = options.at.toISOString();
  const file = wordPressRequestsFile(options.dataDir);

  await updateFileAtomically(file, (current) => {
    const requests = requestsFrom(parseOrEmpty(current));
    const next: WordPressRequests =
      target.route === 'sharedInbox'
        ? { ...requests, sharedInbox: instant }
        : {
            ...requests,
            users: {
              ...requests.users,
              [username ?? '']: {
                ...requests.users[username ?? ''],
                [target.route]: instant,
              },
            },
          };
    return `${JSON.stringify(next, null, 2)}\n`;
  });
}

/** The bytes of the file as whatever JSON they hold, or nothing usable. */
function parseOrEmpty(source: string | undefined): unknown {
  if (source === undefined) return undefined;
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

/**
 * Whatever the file held as the instants this version understands.
 *
 * Read key by key and dropped rather than refused, on the rule the users file
 * and `site.json` are read by: this is a record of what happened, and a
 * damaged one should cost the screen a column, not the site a boot.
 */
function requestsFrom(value: unknown): WordPressRequests {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { users: {} };
  const record = value as Record<string, unknown>;

  const users: Record<string, Partial<Record<WordPressRoute, string>>> = {};
  const listed = record['users'];
  if (typeof listed === 'object' && listed !== null && !Array.isArray(listed)) {
    for (const [username, routes] of Object.entries(listed as Record<string, unknown>)) {
      if (typeof routes !== 'object' || routes === null || Array.isArray(routes)) continue;
      const kept: Partial<Record<WordPressRoute, string>> = {};
      for (const [name, instant] of Object.entries(routes as Record<string, unknown>)) {
        if (typeof instant === 'string' && isWordPressRoute(name)) kept[name] = instant;
      }
      if (Object.keys(kept).length > 0) users[username] = kept;
    }
  }

  const shared = record['sharedInbox'];
  return {
    ...(typeof shared === 'string' ? { sharedInbox: shared } : {}),
    users,
  };
}

/** Whether a stored key names a path this version serves. */
function isWordPressRoute(name: string): name is WordPressRoute {
  return (
    name === 'actor' ||
    name === 'inbox' ||
    name === 'outbox' ||
    name === 'followers' ||
    name === 'following'
  );
}

/** A compatibility context, for the handlers that are handed one. */
export type WordPressInboxContext = InboxContext<FederationContextData>;
