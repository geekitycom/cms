import { createRequire } from 'node:module';

import { createFederation, InProcessMessageQueue, MemoryKvStore } from '@fedify/fedify';
import type { Context, Federation, FederationOptions, PageItems } from '@fedify/fedify';
import { Accept, Announce, Create, Delete, Follow, Like, Reject, Undo } from '@fedify/vocab';

import { countUsers, listUsers } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import type { AdminStore } from '../admin/store.ts';
import type { FederationOverrides, ResolvedConfig } from '../config.ts';
import type { Document } from '../content/document.ts';
import type { ContentStore } from '../content/store.ts';
import { authorNames } from '../web/authors.ts';
import { userActor, userByUsername } from './actor.ts';
import { isFederatedDocument, postCreateActivity } from './article.ts';
import { followersPage, lastFollowersCursor } from './followers.ts';
import {
  handleAccept,
  handleDelete,
  handleFollow,
  handleLoggedActivity,
  handleReject,
  handleUndo,
} from './inbox.ts';
import { loadActorKeyPairs } from './keys.ts';
import {
  ACTOR_PATH,
  federationOrigin,
  FOLLOWERS_PATH,
  FOLLOWING_PATH,
  INBOX_PATH,
  NODEINFO_PATH,
  OUTBOX_PATH,
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
  /** The followers, the inbox log and the relay records. */
  readonly admin: AdminStore;
  /** The content index, which the outbox and the post articles are built from. */
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
 * Build the site's `Federation` object: one actor per user, their keys, their
 * collections, WebFinger's neighbours and NodeInfo.
 *
 * A post's object is not here — it is its permalink (decision-13), served by
 * the middleware in `mount.ts`, which also owns `/.well-known/webfinger`
 * (doc-8) because Fedify's own cannot publish the aliases decision-14 wants.
 *
 * It is a factory rather than a module-level singleton so the KV store and the
 * queue are arguments (decision-5), so a test can build one per data directory,
 * and so a site that outgrows the in-memory pair changes a call rather than
 * this file. The followers come out of SQLite, per user; the following
 * collection is empty, and doc-4 says it always will be.
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

  /** The user a dispatcher's identifier names, off the context's data dir. */
  function actorFor(
    context: { data: FederationContextData },
    identifier: string,
  ): User | undefined {
    return userByUsername(context.data.config.dataDir, identifier);
  }

  federation
    .setActorDispatcher(ACTOR_PATH, async (context, identifier) => {
      const user = actorFor(context, identifier);
      if (user === undefined) return null;
      return await userActor(context, user, { baseUrl: context.data.config.baseUrl });
    })
    // WebFinger asks for a username, and a user's username *is* their
    // identifier now, so this is the identity function over the people who
    // exist. It stays registered because Fedify's own lookups — `parseUri`,
    // the collection URIs — go through it, even though `mount.ts` answers
    // `/.well-known/webfinger` itself.
    .mapHandle((context, username) => (actorFor(context, username) === undefined ? null : username))
    .setKeyPairsDispatcher(async (context, identifier) =>
      actorFor(context, identifier) === undefined
        ? []
        : await loadActorKeyPairs(context.data.config.dataDir, identifier),
    );

  // No object dispatcher for posts. decision-13 makes a post's id its
  // permalink, which Fedify never minted and cannot route: the permalink
  // middleware in `mount.ts` answers an ActivityStreams request there, and
  // `isFederatedDocument` is the one rule it and the outbox both read, so they
  // cannot disagree about what exists.

  /** Every stored `author` string that reads as this user (TASK-67). */
  function namesOf(context: { data: FederationContextData }, user: User): string[] {
    return authorNames(listUsers(context.data.config.dataDir), user);
  }

  federation
    .setOutboxDispatcher(OUTBOX_PATH, (context, identifier, cursor) => {
      const user = actorFor(context, identifier);
      return user === undefined ? null : outboxPage(context, namesOf(context, user), cursor);
    })
    .setCounter((context, identifier) => {
      const user = actorFor(context, identifier);
      return user === undefined ? null : context.data.store.countByAuthor(namesOf(context, user));
    })
    // Paging is cursor-based, and the cursor is an offset, so the first page
    // is always the start of the archive and the last is wherever the archive
    // currently ends.
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

  // One user's followers, straight out of SQLite and paged like the outbox.
  // Fedify renders each one as its actor id, and hands the same rows — inbox
  // and shared inbox included — to `ctx.sendActivity(…, 'followers', …)`, so
  // this one dispatcher is both what a peer reads and where delivery would fan
  // out to.
  federation
    .setFollowersDispatcher(FOLLOWERS_PATH, (context, identifier, cursor) => {
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
  // Always empty: doc-4 says a blog's author follows nobody through this CMS,
  // and the one thing the site does follow — a relay (FEP-ae0c) — is a
  // subscription rather than a relationship anybody reads this collection to
  // learn about.
  federation.setFollowingDispatcher(FOLLOWING_PATH, (context, identifier) =>
    actorFor(context, identifier) === undefined ? null : { items: [] },
  );

  // The inbox, personal and shared. Fedify has already verified the signature
  // by the time a listener runs — an unsigned or badly signed delivery never
  // reaches one — so a handler may trust that the activity's actor really sent
  // it. An activity of a type not listed here is answered 202 and dropped,
  // which is what doc-4 asks for everything past these five.
  federation
    .setInboxListeners(INBOX_PATH, SHARED_INBOX_PATH)
    // `per-origin` rather than Fedify's default `per-inbox`, which folds the
    // recipient identifier into the key. The WordPress compatibility switch
    // (TASK-70) mounts a second set of inboxes over the same KV store, where
    // the same person is `2` rather than their username, and one `Follow`
    // redelivered to both would otherwise be handled twice (doc-8).
    .withIdempotency('per-origin')
    .on(Follow, handleFollow)
    .on(Accept, handleAccept)
    .on(Reject, handleReject)
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
        users: { total: countUsers(context.data.config.dataDir) },
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
  return document !== undefined && isFederatedDocument(document, store.now())
    ? document
    : undefined;
}

/**
 * One page of one user's outbox: the `Create` that announced each of their
 * posts, newest first.
 *
 * The cursor is the offset into the archive as a decimal string. That keeps a
 * page URL meaning what it meant when it was minted, which a cursor derived
 * from the site's page size would not: the size is a setting somebody may
 * change between two requests.
 *
 * Exported for the WordPress compatibility federation (TASK-70), which serves
 * the same page at the plugin's own outbox path.
 */
export function outboxPage(
  context: Context<FederationContextData>,
  names: readonly string[],
  cursor: string | null,
): PageItems<Create> {
  const offset = cursorOffset(cursor);
  const { store } = context.data;
  const documents = store.listByAuthor(names, { limit: OUTBOX_PAGE_SIZE, offset });
  const total = store.countByAuthor(names);
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
