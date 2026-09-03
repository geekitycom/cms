import { createRequire } from 'node:module';

import { createFederation, InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify';
import type { Federation, FederationOptions, PageItems, RequestContext } from '@fedify/fedify';
import { Announce, Article, Create, Delete, Follow, Like, Undo } from '@fedify/vocab';

import { readSiteSettings } from '../admin/settings.ts';
import type { AdminStore } from '../admin/store.ts';
import type { FederationOverrides, ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import type { ContentStore } from '../content/store.ts';
import { AVATAR_SETTING, siteActor } from './actor.ts';
import { isFederatedDocument, postArticle, postCreateActivity } from './article.ts';
import { followersPage, lastFollowersCursor } from './followers.ts';
import { handleDelete, handleFollow, handleLoggedActivity, handleUndo } from './inbox.ts';
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

/**
 * What {@link createSiteFederation} takes: the site's base URL, and the
 * {@link FederationOverrides} a site may swap the defaults for.
 */
export interface CreateSiteFederationOptions extends FederationOverrides {
  /**
   * The site's base URL. Fedify otherwise mints ids from `request.url`, which
   * behind a proxy is the internal address rather than the one peers
   * dereference, so this is the one option with no sensible default.
   *
   * Only its origin is used; see {@link federationOrigin}.
   */
  baseUrl: string;
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
 * this file. The followers come out of SQLite; the following collection is
 * empty, and doc-4 says it always will be.
 */
export function createSiteFederation(options: CreateSiteFederationOptions): SiteFederation {
  const federation = createFederation<FederationContextData>({
    kv: options.kv ?? new MemoryKvStore(),
    origin: federationOrigin(options.baseUrl),
    // `null` is not the same as absent: it asks for no queue at all, so an
    // activity is handled and delivered inside the request that carried it.
    // Leaving the key off entirely is how Fedify is told that, which is why
    // this is a spread rather than a value.
    ...(options.queue === null ? {} : { queue: options.queue ?? new InProcessMessageQueue() }),
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

  // The followers, straight out of SQLite and paged like the outbox. Fedify
  // renders each one as its actor id, and hands the same rows — inbox and
  // shared inbox included — to `ctx.sendActivity(…, 'followers', …)`, so this
  // one dispatcher is both what a peer reads and where delivery fans out to.
  federation
    .setFollowersDispatcher(FOLLOWERS_PATH, (context, identifier, cursor) =>
      identifier === SITE_ACTOR_IDENTIFIER ? followersPage(context, cursor) : null,
    )
    .setCounter((context, identifier) =>
      identifier === SITE_ACTOR_IDENTIFIER ? context.data.admin.countFollowers() : null,
    )
    .setFirstCursor((_context, identifier) => (identifier === SITE_ACTOR_IDENTIFIER ? '0' : null))
    .setLastCursor((context, identifier) =>
      identifier === SITE_ACTOR_IDENTIFIER
        ? lastFollowersCursor(context.data.admin.countFollowers())
        : null,
    );
  // Always empty, and always will be: doc-4 says the site follows nobody.
  federation.setFollowingDispatcher(FOLLOWING_PATH, (_context, identifier) =>
    identifier === SITE_ACTOR_IDENTIFIER ? { items: [] } : null,
  );

  // The inbox, personal and shared. Fedify has already verified the signature
  // by the time a listener runs — an unsigned or badly signed delivery never
  // reaches one — so a handler may trust that the activity's actor really sent
  // it. An activity of a type not listed here is answered 202 and dropped,
  // which is what doc-4 asks for everything past these five.
  federation
    .setInboxListeners(INBOX_PATH, SHARED_INBOX_PATH)
    .on(Follow, handleFollow)
    .on(Undo, handleUndo)
    .on(Delete, handleDelete)
    .on(Like, handleLoggedActivity)
    .on(Announce, handleLoggedActivity)
    .on(Create, handleLoggedActivity);

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
