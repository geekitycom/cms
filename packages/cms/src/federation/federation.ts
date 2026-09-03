import { createRequire } from 'node:module';

import { createFederation, InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify';
import type {
  Federation,
  FederationOptions,
  FederationOrigin,
  KvStore,
  MessageQueue,
} from '@fedify/fedify';

import { readSiteSettings } from '../admin/settings.ts';
import type { AdminStore } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import type { ContentStore } from '../content/store.ts';
import { AVATAR_SETTING, siteActor } from './actor.ts';
import { loadActorKeyPairs, SITE_ACTOR_IDENTIFIER } from './keys.ts';

/**
 * Where the ActivityPub endpoints live, under one prefix so they never
 * collide with a permalink. doc-4 puts post objects at `/ap/posts/{slug}`;
 * the actor is its sibling.
 */
export const FEDERATION_PREFIX = '/ap';

/**
 * The actor's path template.
 *
 * The identifier is a template variable because Fedify requires one, but only
 * {@link SITE_ACTOR_IDENTIFIER} ever answers: a site is one actor. Because that
 * identifier is a constant rather than the handle, the actor's id is
 * `{baseUrl}/ap/actor` however often the handle is renamed.
 */
export const ACTOR_PATH = `${FEDERATION_PREFIX}/{identifier}` as const;

/** The actor's inbox, its outbox and its two follow collections. */
export const INBOX_PATH = `${ACTOR_PATH}/inbox` as const;
export const OUTBOX_PATH = `${ACTOR_PATH}/outbox` as const;
export const FOLLOWERS_PATH = `${ACTOR_PATH}/followers` as const;
export const FOLLOWING_PATH = `${ACTOR_PATH}/following` as const;
/** The instance-wide inbox, which a peer may use to deliver to every actor at once. */
export const SHARED_INBOX_PATH = `${FEDERATION_PREFIX}/shared-inbox` as const;

/** Where the NodeInfo 2.1 document lives; `/.well-known/nodeinfo` points at it. */
export const NODEINFO_PATH = '/nodeinfo/2.1';

/** The `software.name` this CMS reports in NodeInfo. Lower case, as the schema demands. */
export const SOFTWARE_NAME = 'geekity-cms';

/** What every Fedify dispatcher in the CMS is handed. */
export interface FederationContextData {
  /** Settings and, through them, the actor's profile and its keys. */
  readonly admin: AdminStore;
  /** The content index, which the outbox and the post objects are built from. */
  readonly store: ContentStore;
  /** Config after defaults and environment overrides. */
  readonly config: ResolvedConfig;
}

/** A CMS federation object, with the context data its dispatchers expect. */
export type SiteFederation = Federation<FederationContextData>;

/** What {@link createSiteFederation} takes. */
export interface CreateSiteFederationOptions {
  /**
   * The site's base URL. Fedify otherwise mints ids from `request.url`, which
   * behind a proxy is the internal address rather than the one peers
   * dereference, so this is the one option with no sensible default.
   *
   * Only its origin is used; see {@link federationOrigin}.
   */
  baseUrl: string;
  /**
   * Fedify's cache and idempotence store. Defaults to an in-memory one, which
   * is what decision-5 chose for phase one: nothing that has to survive a
   * restart lives in it. Swap it for `@fedify/sqlite` or `@fedify/redis`
   * without touching anything else here.
   */
  kv?: KvStore | undefined;
  /**
   * The delivery and inbox queue. Defaults to Fedify's in-process one, again
   * per decision-5: a queued delivery is lost if the process exits before it
   * drains, which is the trade phase one accepts.
   */
  queue?: MessageQueue | undefined;
  /**
   * Whether the document loader may fetch private and loopback addresses. Off,
   * as it must be in production; tests that federate two local servers turn it
   * on.
   */
  allowPrivateAddress?: boolean | undefined;
  /** Anything else Fedify takes, for a site that needs to reach past this factory. */
  federationOptions?: Partial<FederationOptions<FederationContextData>> | undefined;
}

/**
 * Build the site's `Federation` object: the actor, its keys, WebFinger and
 * NodeInfo.
 *
 * It is a factory rather than a module-level singleton so the KV store and the
 * queue are arguments (decision-5), so a test can build one per data directory,
 * and so a site that outgrows the in-memory pair changes a call rather than
 * this file. The collections are registered but empty; TASK-17 fills the
 * outbox and TASK-18 the followers.
 */
export function createSiteFederation(options: CreateSiteFederationOptions): SiteFederation {
  const federation = createFederation<FederationContextData>({
    kv: options.kv ?? new MemoryKvStore(),
    queue: options.queue ?? new InProcessMessageQueue(),
    origin: federationOrigin(options.baseUrl),
    ...(options.allowPrivateAddress === undefined
      ? {}
      : { allowPrivateAddress: options.allowPrivateAddress }),
    ...options.federationOptions,
  });

  federation
    .setActorDispatcher(ACTOR_PATH, async (context, identifier) => {
      if (identifier !== SITE_ACTOR_IDENTIFIER) return null;
      const settings = readSiteSettings(context.data.admin);
      return await siteActor(context, identifier, {
        settings,
        avatarUrl: context.data.admin.allSettings()[AVATAR_SETTING],
      });
    })
    // WebFinger asks for a username; this is what turns the handle somebody
    // typed into the identifier the URLs are built from, and what makes the
    // handle a setting rather than part of the actor's id.
    .mapHandle((context, username) =>
      username === readSiteSettings(context.data.admin).actorHandle ? SITE_ACTOR_IDENTIFIER : null,
    )
    .setKeyPairsDispatcher(async (context, identifier) =>
      identifier === SITE_ACTOR_IDENTIFIER
        ? await loadActorKeyPairs(context.data.admin, identifier)
        : [],
    );

  // Registered so the actor may advertise them and so a peer that dereferences
  // one gets an empty collection rather than a 404. The contents arrive with
  // the outbox (TASK-17) and the follower store (TASK-18).
  federation.setOutboxDispatcher(OUTBOX_PATH, (_context, identifier) =>
    identifier === SITE_ACTOR_IDENTIFIER ? { items: [] } : null,
  );
  federation.setFollowersDispatcher(FOLLOWERS_PATH, (_context, identifier) =>
    identifier === SITE_ACTOR_IDENTIFIER ? { items: [] } : null,
  );
  // Always empty, and always will be: doc-4 says the site follows nobody.
  federation.setFollowingDispatcher(FOLLOWING_PATH, (_context, identifier) =>
    identifier === SITE_ACTOR_IDENTIFIER ? { items: [] } : null,
  );

  // No listeners yet, so an activity is accepted and logged rather than acted
  // on. Registering the endpoint now is what lets the actor publish an inbox
  // at all; TASK-18 adds the `Follow` and `Undo` handlers.
  federation.setInboxListeners(INBOX_PATH, SHARED_INBOX_PATH);

  federation.setNodeInfoDispatcher(NODEINFO_PATH, (context) => {
    const counts = context.data.store.counts();
    return {
      software: { name: SOFTWARE_NAME, version: packageVersion() },
      protocols: ['activitypub'],
      // A CMS is not a signup service; the admin makes accounts by hand.
      openRegistrations: false,
      usage: {
        users: { total: context.data.admin.countUsers() },
        localPosts: counts.posts,
        localComments: 0,
      },
    };
  });

  return federation;
}

/**
 * The origin a base URL federates under: its host for handles, its scheme and
 * authority for ids.
 *
 * The path is dropped, and has to be. WebFinger and NodeInfo are defined at
 * `/.well-known/…` on the host, not under whatever directory a site happens to
 * be mounted in, so a site at `https://example.com/blog` is still the actor
 * `@blog@example.com` and still answers discovery at the host root. Its posts
 * keep their base path; only the federation endpoints ignore it.
 */
export function federationOrigin(baseUrl: string): FederationOrigin {
  const url = new URL(baseUrl);
  return { handleHost: url.host, webOrigin: url.origin };
}

/** The published version of `@geekity/cms`, which NodeInfo reports. */
function packageVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest = require('../../package.json') as { version?: string };
  return manifest.version ?? '0.0.0';
}
