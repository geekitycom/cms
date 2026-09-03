import { createRequire } from 'node:module';

import { createFederation, InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify';
import type {
  Federation,
  FederationOptions,
  KvStore,
  MessageQueue,
  PageItems,
  RequestContext,
} from '@fedify/fedify';
import { Article } from '@fedify/vocab';
import type { Create } from '@fedify/vocab';

import { readSiteSettings } from '../admin/settings.ts';
import type { AdminStore } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import type { ContentStore } from '../content/store.ts';
import { AVATAR_SETTING, siteActor } from './actor.ts';
import { isFederatedDocument, postArticle, postCreateActivity } from './article.ts';
import { loadActorKeyPairs, SITE_ACTOR_IDENTIFIER } from './keys.ts';
import {
  ACTOR_PATH,
  federationOrigin,
  FOLLOWERS_PATH,
  FOLLOWING_PATH,
  INBOX_PATH,
  NODEINFO_PATH,
  OUTBOX_PATH,
  POST_OBJECT_PATH,
  SHARED_INBOX_PATH,
} from './paths.ts';

/** The `software.name` this CMS reports in NodeInfo. Lower case, as the schema demands. */
export const SOFTWARE_NAME = 'geekity-cms';

/**
 * How many activities one page of the outbox holds.
 *
 * A constant rather than the site's `postsPerPage`, because an outbox cursor
 * is a URL a peer may come back to: changing the setting would silently move
 * every page boundary underneath whoever is walking the collection.
 */
export const OUTBOX_PAGE_SIZE = 20;

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
 * Build the site's `Federation` object: the actor, its keys, the post objects,
 * the outbox, WebFinger and NodeInfo.
 *
 * It is a factory rather than a module-level singleton so the KV store and the
 * queue are arguments (decision-5), so a test can build one per data directory,
 * and so a site that outgrows the in-memory pair changes a call rather than
 * this file. The follow collections are registered but empty; TASK-18 fills
 * the followers.
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

  // A post's ActivityStreams object. `null` is a 404, which is what a draft, a
  // trashed post, a page and a slug that names nothing all get: the object
  // dispatcher is the only thing that decides whether an object exists, so it
  // cannot disagree with the outbox about it.
  federation.setObjectDispatcher(Article, POST_OBJECT_PATH, (context, values) => {
    const document = federatedPost(context.data.store, values.slug);
    return document === undefined ? null : postArticle(context, document);
  });

  federation
    .setOutboxDispatcher(OUTBOX_PATH, (context, identifier, cursor) =>
      identifier === SITE_ACTOR_IDENTIFIER ? outboxPage(context, cursor) : null,
    )
    .setCounter((context, identifier) =>
      identifier === SITE_ACTOR_IDENTIFIER ? context.data.store.counts().posts : null,
    )
    // Paging is cursor-based, and the cursor is an offset, so the first page
    // is always the start of the archive and the last is wherever the archive
    // currently ends.
    .setFirstCursor((_context, identifier) => (identifier === SITE_ACTOR_IDENTIFIER ? '0' : null))
    .setLastCursor((context, identifier) => {
      if (identifier !== SITE_ACTOR_IDENTIFIER) return null;
      const total = context.data.store.counts().posts;
      return String(
        total === 0 ? 0 : Math.floor((total - 1) / OUTBOX_PAGE_SIZE) * OUTBOX_PAGE_SIZE,
      );
    });

  // Registered so the actor may advertise them and so a peer that dereferences
  // one gets an empty collection rather than a 404. The contents arrive with
  // the follower store (TASK-18).
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
 * The published post a slug names, or `undefined`.
 *
 * Slugs are not unique across years, and the index answers with the newest
 * match. That is the same rule the admin's own slug lookup follows, so a
 * collision resolves the same way wherever it is asked about.
 */
export function federatedPost(store: ContentStore, slug: string): Document | undefined {
  const document = store.getBySlug(slug);
  return document !== undefined && isFederatedDocument(document) ? document : undefined;
}

/**
 * One page of the outbox: the `Create` that announced each post, newest first.
 *
 * The cursor is the offset into the archive as a decimal string. That keeps a
 * page URL meaning what it meant when it was minted, which a cursor derived
 * from the site's page size would not: the size is a setting somebody may
 * change between two requests.
 */
function outboxPage(
  context: RequestContext<FederationContextData>,
  cursor: string | null,
): PageItems<Create> {
  const offset = cursorOffset(cursor);
  const { store } = context.data;
  const documents = store.listPosts({ limit: OUTBOX_PAGE_SIZE, offset });
  const total = store.counts().posts;
  const next = offset + OUTBOX_PAGE_SIZE;

  return {
    items: documents.map((document) => postCreateActivity(context, document)),
    nextCursor: next < total ? String(next) : null,
    prevCursor: offset <= 0 ? null : String(Math.max(0, offset - OUTBOX_PAGE_SIZE)),
  };
}

/** A cursor as an offset. Anything unreadable starts at the beginning. */
function cursorOffset(cursor: string | null): number {
  if (cursor === null || !/^[0-9]+$/.test(cursor)) return 0;
  return Number(cursor);
}

/** The published version of `@geekity/cms`, which NodeInfo reports. */
function packageVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest = require('../../package.json') as { version?: string };
  return manifest.version ?? '0.0.0';
}
