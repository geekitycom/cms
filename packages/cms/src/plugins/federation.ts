/**
 * The federation phase plugins answer in (decision-33): after the canonical
 * federation, before stored ids. A plugin running a federation of its own
 * reaches the site's through {@link PluginFederationContext}, and everything
 * that crosses is plain data, because a bundled plugin carries its own copy
 * of Fedify and an object built by one copy fails the other's type checks.
 */

import type { KvStore } from '@fedify/fedify';
import type { Context, MiddlewareHandler } from 'hono';

import { listUsers } from '../admin/accounts.ts';
import type { GeekityEnv } from '../env.ts';
import { userActor, userByUsername } from '../federation/actor.ts';
import { lastOutboxCursor, outboxPage } from '../federation/federation.ts';
import type { SiteFederation } from '../federation/federation.ts';
import { followersPage, lastFollowersCursor } from '../federation/followers.ts';
import { receiveActivity } from '../federation/inbox.ts';
import { loadActorKeyPairs } from '../federation/keys.ts';
import { contextData } from '../federation/mount.ts';
import type {
  JsonLdDocument,
  PluginFederationContext,
  PluginFederationMiddleware,
} from '../plugin.ts';
import { authorNames } from '../web/authors.ts';
import type { PluginRegistry } from './registry.ts';
import { pluginSite } from './site.ts';

/** What every plugin federation shares with the site's own. */
export interface PluginFederationOptions {
  registry: PluginRegistry;
  canonical: SiteFederation;
  kv: KvStore;
  allowPrivateAddress: boolean;
}

/**
 * Run each active plugin's federation middleware in turn. A request no
 * plugin answers, and every request while none is active, goes on to the
 * rest of the site.
 */
export function pluginFederation(options: PluginFederationOptions): MiddlewareHandler<GeekityEnv> {
  const mounted = options.registry.plugins.filter(
    (entry) => entry.problem === undefined && entry.federation.length > 0,
  );

  return async (c, next) => {
    const running: PluginFederationMiddleware[] = mounted
      .filter((entry) => c.var.activePlugins.has(entry.plugin.name))
      .flatMap((entry) => entry.federation);
    if (running.length === 0) return await next();

    const context = federationContext(c, options);
    const dispatch = async (index: number): Promise<Response> => {
      const middleware = running[index];
      if (middleware === undefined) {
        await next();
        return c.res;
      }
      return await middleware(context, () => dispatch(index + 1));
    };
    return await dispatch(0);
  };
}

function federationContext(
  c: Context<GeekityEnv>,
  options: PluginFederationOptions,
): PluginFederationContext {
  const { config } = c.var;
  const canonical = () => options.canonical.createContext(c.req.raw, contextData(c));
  const userNamed = (username: string) => userByUsername(config.dataDir, username);

  return {
    request: c.req.raw,
    site: pluginSite({ admin: c.var.admin, config }),
    kv: options.kv,
    allowPrivateAddress: options.allowPrivateAddress,
    now: () => config.now(),

    async actor(username) {
      const user = userNamed(username);
      if (user === undefined) return undefined;
      const context = canonical();
      const actor = await userActor(context, user, { baseUrl: config.baseUrl });
      return (await actor.toJsonLd({ contextLoader: context.contextLoader })) as JsonLdDocument;
    },

    async keyPairs(username) {
      if (userNamed(username) === undefined) return [];
      return await loadActorKeyPairs(config.dataDir, username);
    },

    outbox(username) {
      const user = userNamed(username);
      if (user === undefined) return undefined;
      const names = authorNames(listUsers(config.dataDir), user);
      const totalItems = c.var.store.countByAuthor(names);
      return {
        totalItems,
        firstCursor: '0',
        lastCursor: lastOutboxCursor(totalItems),
        async page(cursor) {
          const context = canonical();
          const page = outboxPage(context, names, cursor);
          const items = await Promise.all(
            page.items.map(
              async (item) =>
                (await item.toJsonLd({ contextLoader: context.contextLoader })) as JsonLdDocument,
            ),
          );
          return {
            items,
            nextCursor: page.nextCursor ?? null,
            prevCursor: page.prevCursor ?? null,
          };
        },
      };
    },

    followers(username) {
      if (userNamed(username) === undefined) return undefined;
      const totalItems = c.var.admin.countFollowers(username);
      return {
        totalItems,
        firstCursor: '0',
        lastCursor: lastFollowersCursor(totalItems),
        page(cursor) {
          const page = followersPage(canonical(), username, cursor);
          return Promise.resolve({
            items: page.items.map((recipient) => ({
              id: recipient.id?.href ?? '',
              inboxId: recipient.inboxId?.href ?? '',
              sharedInboxId: recipient.endpoints?.sharedInbox?.href ?? null,
            })),
            nextCursor: page.nextCursor ?? null,
            prevCursor: page.prevCursor ?? null,
          });
        },
      };
    },

    async receive(activity, recipient) {
      await receiveActivity(canonical(), activity, recipient);
    },
  };
}
