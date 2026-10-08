import { createFederation } from '@fedify/fedify';
import type { Context, Federation } from '@fedify/fedify';
import { Activity, Create, Person } from '@fedify/vocab';
import type {
  JsonLdDocument,
  PluginFederationContext,
  PluginFederationMiddleware,
} from '@geekity/cms/plugin';

import {
  WORDPRESS_ACTOR_PATH,
  WORDPRESS_FOLLOWERS_PATH,
  WORDPRESS_FOLLOWING_PATH,
  WORDPRESS_INBOX_PATH,
  WORDPRESS_OUTBOX_PATH,
  WORDPRESS_SHARED_INBOX_PATH,
  wordPressRequestTarget,
} from './records.ts';
import type { WordPressRecords } from './records.ts';

/**
 * The WordPress ActivityPub plugin's paths, served while this plugin is
 * enabled (TASK-70, TASK-282).
 *
 * A follower's server delivers to the inbox URL it cached from the actor
 * document, and replaces it only when it next refetches the actor. A site that
 * moved here from the plugin therefore goes on being delivered to at
 * `/wp-json/activitypub/1.0/actors/2/inbox` and `/wp-json/activitypub/1.0/inbox`
 * for as long as those caches last, and decision-14 calls that **cache rather
 * than identity**: the site carries the plugin's layout until the caches have
 * moved on, and then the plugin is disabled.
 *
 * Everything a peer reads back is the canonical identity. The actor served at
 * `…/actors/2` is the same `Person` the author URL serves, same `id`, same
 * canonical `inbox`, so a peer that refetches here learns the new endpoints.
 *
 * A Fedify federation of the plugin's own is how a second inbox path gets
 * signature verification at all: one federation has exactly one pair of inbox
 * listeners (doc-8). It shares the site federation's KV store and is set to
 * `per-origin` idempotence, as the canonical inbox is, so one `Follow`
 * redelivered to `andrew`'s inbox and to `2`'s is handled once.
 *
 * Every document crosses from the site as JSON-LD and is parsed here with
 * this plugin's own vocabulary, because a bundled plugin carries its own copy
 * of Fedify and the site's objects are not instances of this copy's classes.
 */
export function wordPressFederation(records: WordPressRecords): PluginFederationMiddleware {
  let federation: Federation<PluginFederationContext> | undefined;

  return async (context, next) => {
    const target = wordPressRequestTarget(new URL(context.request.url).pathname);
    if (target === undefined) return await next();

    // Recorded before Fedify is asked, because the record is of what the site
    // was asked for: a peer still holding the old inbox URL is news whether or
    // not the number in it still names anybody.
    await records.recordRequest({
      target,
      username:
        target.wordpressActorId === undefined
          ? undefined
          : records.userByNumber(context.site, target.wordpressActorId),
      at: context.now(),
    });

    // Built on the first request that reaches one of the paths, because the
    // KV store it shares arrives with the request.
    federation ??= build(context, records);
    return await federation.fetch(context.request, {
      contextData: context,
      onNotFound: next,
      async onNotAcceptable() {
        const response = await next();
        if (response.status !== 404) return response;
        return new Response('Not acceptable', {
          status: 406,
          headers: { 'content-type': 'text/plain', vary: 'Accept' },
        });
      },
    });
  };
}

/**
 * The compatibility federation: the plugin's inbox and collections, mapped to
 * users by the number WordPress gave them. Nothing else is registered:
 * WebFinger, NodeInfo and the actor's real endpoints belong to the site.
 */
function build(
  first: PluginFederationContext,
  records: WordPressRecords,
): Federation<PluginFederationContext> {
  const federation = createFederation<PluginFederationContext>({
    kv: first.kv,
    origin: new URL(first.site.baseUrl).origin,
    allowPrivateAddress: first.allowPrivateAddress,
  });

  /** The username a dispatcher's identifier names, which here is a number. */
  function userOf(context: { data: PluginFederationContext }, identifier: string) {
    return records.userByNumber(context.data.site, identifier);
  }

  /** What parsing a document from the site with this copy's vocabulary needs. */
  function loaders(context: Context<PluginFederationContext>) {
    return { documentLoader: context.documentLoader, contextLoader: context.contextLoader };
  }

  federation
    .setActorDispatcher(WORDPRESS_ACTOR_PATH, async (context, identifier) => {
      const username = userOf(context, identifier);
      if (username === undefined) return null;
      // The canonical document, verbatim: a peer refetching the actor at the
      // old URL is exactly the peer that should learn the new inbox.
      const actor = await context.data.actor(username);
      return actor === undefined ? null : await Person.fromJsonLd(actor, loaders(context));
    })
    .setKeyPairsDispatcher(async (context, identifier) => {
      const username = userOf(context, identifier);
      return username === undefined ? [] : await context.data.keyPairs(username);
    });

  federation
    .setOutboxDispatcher(WORDPRESS_OUTBOX_PATH, async (context, identifier, cursor) => {
      const username = userOf(context, identifier);
      const outbox = username === undefined ? undefined : context.data.outbox(username);
      if (outbox === undefined) return null;
      const page = await outbox.page(cursor);
      return {
        items: await Promise.all(
          page.items.map((item: JsonLdDocument) => Create.fromJsonLd(item, loaders(context))),
        ),
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
      };
    })
    .setCounter((context, identifier) => {
      const username = userOf(context, identifier);
      return username === undefined ? null : (context.data.outbox(username)?.totalItems ?? null);
    })
    .setFirstCursor((context, identifier) => {
      const username = userOf(context, identifier);
      return username === undefined ? null : (context.data.outbox(username)?.firstCursor ?? null);
    })
    .setLastCursor((context, identifier) => {
      const username = userOf(context, identifier);
      return username === undefined ? null : (context.data.outbox(username)?.lastCursor ?? null);
    });

  federation
    .setFollowersDispatcher(WORDPRESS_FOLLOWERS_PATH, async (context, identifier, cursor) => {
      const username = userOf(context, identifier);
      const followers = username === undefined ? undefined : context.data.followers(username);
      if (followers === undefined) return null;
      const page = await followers.page(cursor);
      return {
        items: page.items.map((recipient) => ({
          id: new URL(recipient.id),
          inboxId: new URL(recipient.inboxId),
          endpoints: {
            sharedInbox: recipient.sharedInboxId === null ? null : new URL(recipient.sharedInboxId),
          },
        })),
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
      };
    })
    .setCounter((context, identifier) => {
      const username = userOf(context, identifier);
      return username === undefined ? null : (context.data.followers(username)?.totalItems ?? null);
    })
    .setFirstCursor((context, identifier) => {
      const username = userOf(context, identifier);
      return username === undefined
        ? null
        : (context.data.followers(username)?.firstCursor ?? null);
    })
    .setLastCursor((context, identifier) => {
      const username = userOf(context, identifier);
      return username === undefined ? null : (context.data.followers(username)?.lastCursor ?? null);
    });

  federation.setFollowingDispatcher(WORDPRESS_FOLLOWING_PATH, (context, identifier) =>
    userOf(context, identifier) === undefined ? null : { items: [] },
  );

  // Every activity goes to the site's own inbox handlers, which decide what
  // each type means. `recipient` arrives here as the WordPress number, straight
  // off the path, and the site's handlers mean a username by it.
  federation
    .setInboxListeners(WORDPRESS_INBOX_PATH, WORDPRESS_SHARED_INBOX_PATH)
    .withIdempotency('per-origin')
    .on(Activity, async (context, activity) => {
      const recipient = context.recipient === null ? null : userOf(context, context.recipient);
      await context.data.receive((await activity.toJsonLd()) as JsonLdDocument, recipient ?? null);
    });

  return federation;
}
