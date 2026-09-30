import type { Context, DocumentLoader } from '@fedify/fedify';
import { isActor } from '@fedify/vocab';
import type { Actor, Link } from '@fedify/vocab';

import { primaryUser } from '../admin/accounts.ts';
import type { ActorProfile, AdminStore } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import type { NotificationTimers } from '../notifications/digest.ts';
import { systemNotificationTimers } from '../notifications/digest.ts';
import { senderKeyPairs } from './actor.ts';
import type { FederationContextData } from './federation.ts';

/**
 * The names and faces of the fediverse actors who are not followers
 * (TASK-184).
 *
 * A follower is named from the profile it published when it followed. Anybody
 * else who liked, boosted, answered or quoted a post used to be named by a
 * guess at their handle from the last segment of their actor URL, and a
 * current Mastodon mints ids like `/ap/users/117132440785278319`, which hold
 * no name at all. So the actor document is read when one of their activities
 * arrives, and what it says is kept in the `actor_profiles` cache.
 *
 * Nothing here runs while a page is served. {@link ActorProfileService.capture}
 * is how the inbox asks for a profile, and it hands back nothing to wait on;
 * the sweep fetches every inbox actor with no profile or a stale one, which is
 * the backfill of a log written before this existed, the refresh of profiles
 * that have changed, and the rebuild after the database has been deleted
 * (decision-9) all at once.
 */

/** How old a stored profile gets before the sweep fetches it again. */
export const PROFILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** How long an actor whose document could not be read is left alone. */
export const PROFILE_RETRY_MS = 60 * 60 * 1000;

/** How often the sweep runs. */
export const PROFILE_SWEEP_MS = 6 * 60 * 60 * 1000;

/** Read one actor's profile, or `undefined` when there is no actor to read. */
export type ActorProfileLoader = (actorId: string) => Promise<ActorProfile | undefined>;

/**
 * The site's {@link ActorProfileLoader}: a GET of the actor document, signed
 * as the site's first account.
 *
 * Signed because mastodon.social, like any server in authorized fetch mode,
 * answers an unsigned request for an actor with a 401. The inbox verifies a
 * delivery's signature with a fetch signed as the recipient, which is why the
 * activity got in at all; the sweep has no recipient, and the first account is
 * the one that can be chosen without asking, as it is for a relay.
 */
export function signedProfileLoader(
  contextOf: () => Context<FederationContextData>,
): ActorProfileLoader {
  return async (actorId) => {
    const context = contextOf();
    const signer = primaryUser(context.data.config.dataDir);
    const [key] = signer === undefined ? [] : await senderKeyPairs(context, signer);
    const loaders = {
      documentLoader: key === undefined ? context.documentLoader : context.getDocumentLoader(key),
      contextLoader: context.contextLoader,
    };
    const found = await context.lookupObject(actorId, loaders);
    return isActor(found) ? await profileFrom(found, loaders) : undefined;
  };
}

/** Where the service reports an actor it could not read. */
export interface ActorProfileLogger {
  warn(message: string): void;
}

/** What {@link createActorProfileService} needs. */
export interface CreateActorProfileServiceOptions {
  readonly admin: Pick<
    AdminStore,
    'getActorProfile' | 'putActorProfile' | 'listActorsToProfile' | 'listFollowers'
  >;
  readonly config: Pick<ResolvedConfig, 'now'>;
  readonly load: ActorProfileLoader;
  /** Defaults to the real interval timer. */
  readonly timers?: NotificationTimers | undefined;
  /** Defaults to `console`. */
  readonly logger?: ActorProfileLogger | undefined;
}

/** Fetches and keeps the profiles of the actors who are not followers. */
export interface ActorProfileService {
  /**
   * Fetch this actor's profile in the background when the site knows nothing
   * of them: no follower record, no stored profile, no fetch already running
   * and no failure within {@link PROFILE_RETRY_MS}. Returns at once.
   */
  capture(actorId: string): void;
  /**
   * Fetch the profile of every inbox actor that is not a follower and has
   * none, or one older than {@link PROFILE_MAX_AGE_MS}, one at a time.
   * Queued behind any sweep already running.
   */
  sweep(): Promise<void>;
  /** Sweep now and then every {@link PROFILE_SWEEP_MS}. Safe twice. */
  start(): void;
  /** Stop the timer. Safe before starting and safe twice. */
  stop(): void;
  /** Resolve once every fetch and sweep in flight has finished. */
  settled(): Promise<void>;
}

/** Build the profile service for one site. */
export function createActorProfileService(
  options: CreateActorProfileServiceOptions,
): ActorProfileService {
  const { admin, config, load } = options;
  const timers = options.timers ?? systemNotificationTimers;
  const logger = options.logger ?? console;

  const inFlight = new Map<string, Promise<void>>();
  /** When each actor last failed to load, in milliseconds. Lost on restart, which only means one more try. */
  const failedAt = new Map<string, number>();
  let sweeping: Promise<void> = Promise.resolve();
  let handle: unknown;

  const now = (): number => config.now().getTime();

  function failedRecently(actorId: string): boolean {
    const at = failedAt.get(actorId);
    return at !== undefined && now() - at < PROFILE_RETRY_MS;
  }

  /** Fetch one profile into the cache, once at a time per actor. */
  function refresh(actorId: string): Promise<void> {
    const running = inFlight.get(actorId);
    if (running !== undefined) return running;

    const started = fetchInto(actorId).finally(() => inFlight.delete(actorId));
    inFlight.set(actorId, started);
    return started;
  }

  async function fetchInto(actorId: string): Promise<void> {
    let profile: ActorProfile | undefined;
    try {
      profile = await load(actorId);
    } catch (thrown) {
      logger.warn(`Could not read the actor ${actorId}: ${messageOf(thrown)}`);
    }
    if (profile === undefined) {
      failedAt.set(actorId, now());
      return;
    }
    failedAt.delete(actorId);
    // Keyed by the id the activity named, which is the one a conversation
    // looks up, whatever the document calls itself.
    admin.putActorProfile({
      ...profile,
      actorId,
      fetchedAt: config.now().toISOString(),
    });
  }

  async function sweepOnce(): Promise<void> {
    const due = admin.listActorsToProfile(new Date(now() - PROFILE_MAX_AGE_MS).toISOString());
    for (const actorId of due) {
      if (failedRecently(actorId)) continue;
      await refresh(actorId);
    }
  }

  return {
    capture(actorId) {
      if (inFlight.has(actorId) || failedRecently(actorId)) return;
      if (admin.getActorProfile(actorId) !== undefined) return;
      if (admin.listFollowers().some((follower) => follower.actorId === actorId)) return;
      void refresh(actorId);
    },

    sweep() {
      const next = sweeping.then(sweepOnce).catch((thrown: unknown) => {
        logger.warn(`The actor profile sweep failed: ${messageOf(thrown)}`);
      });
      sweeping = next;
      return next;
    },

    start() {
      if (handle !== undefined) return;
      void this.sweep();
      handle = timers.set(() => void this.sweep(), PROFILE_SWEEP_MS);
    },

    stop() {
      if (handle !== undefined) timers.clear(handle);
      handle = undefined;
    },

    async settled() {
      await sweeping;
      await Promise.all([...inFlight.values()]);
    },
  };
}

/**
 * What an actor document says about how to show its actor. The one reading of
 * a profile, shared by a follow and by the profile cache, so a follower and a
 * stranger are named by the same rule.
 *
 * The handle is built from the document rather than from WebFinger: a
 * canonical one would take a round trip per actor to confirm the host, and
 * this is display data. The id is what identifies the actor, and the id is
 * what every other part of the system keys on.
 */
export async function profileFrom(
  actor: Actor,
  loaders: { documentLoader: DocumentLoader; contextLoader: DocumentLoader },
): Promise<ActorProfile | undefined> {
  if (actor.id === null) return undefined;
  const icon = await actor.getIcon({ ...loaders, suppressError: true });
  const username = actor.preferredUsername;

  return {
    actorId: actor.id.href,
    handle: username === null ? null : `@${username.toString()}@${actor.id.host}`,
    name: actor.name === null ? null : actor.name.toString(),
    iconUrl: linkHref(icon?.url ?? null) ?? actor.iconId?.href ?? null,
    url: linkHref(actor.url) ?? null,
  };
}

/** A `URL` or a `Link` as a plain href, or `null`. */
function linkHref(value: URL | Link | null): string | null {
  if (value === null) return null;
  return value instanceof URL ? value.href : (value.href?.href ?? null);
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
