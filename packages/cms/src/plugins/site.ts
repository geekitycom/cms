/**
 * The site as a plugin reaches it (decision-33): the accounts, keys and
 * followers behind {@link PluginSite}, and the registry a site's config
 * installs. Shared by requests and the command line, so a plugin's command
 * and its federation read the same files the same way.
 */

import { listUsers, setUserActorId } from '../admin/accounts.ts';
import { readSiteSettings } from '../admin/settings.ts';
import type { AdminStore } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import { readFileIfPresentSync } from '../files/atomic.ts';
import { actorKeyFile, loadActorKeyPairs, writeActorKeyFile } from '../federation/keys.ts';
import { addFollower, readFollowers } from '../federation/records.ts';
import type { PluginSite } from '../plugin.ts';
import { createPluginRegistry } from './registry.ts';
import type { PluginRegistry } from './registry.ts';

/** Every plugin the site config installs, registered. */
export function sitePluginRegistry(config: ResolvedConfig): PluginRegistry {
  return createPluginRegistry(
    config.plugins.map((plugin, index) => ({
      plugin,
      source: `the site config, plugins[${String(index)}]`,
    })),
    {
      dataDir: config.dataDir,
      contentDir: config.contentDir,
      env: process.env,
      allowPrivateAddress: config.federation.allowPrivateAddress ?? false,
      lookup: config.hostLookup,
      // Read when asked: the base URL settles after boot reads the settings,
      // and the title changes with them.
      siteInfo: () => ({
        baseUrl: config.baseUrl,
        title: readSiteSettings(config.contentDir).title,
      }),
    },
  );
}

export function pluginSite(options: { admin: AdminStore; config: ResolvedConfig }): PluginSite {
  const { admin, config } = options;
  const { contentDir, dataDir } = config;

  return {
    baseUrl: config.baseUrl,

    users: () =>
      listUsers(dataDir).map((user) => ({
        username: user.username,
        ...(user.actorId === undefined ? {} : { actorId: user.actorId }),
      })),

    setActorId: (username, actorId) => setUserActorId({ dataDir, username, actorId }),

    actorKey(username, algorithm) {
      const file = actorKeyFile(dataDir, username, algorithm);
      return { file, jwk: readFileIfPresentSync(file) };
    },

    writeActorKey(username, algorithm, jwk) {
      writeActorKeyFile(dataDir, username, algorithm, jwk);
    },

    async loadActorKeys(username) {
      await loadActorKeyPairs(dataDir, username);
    },

    followers: (username) =>
      readFollowers(contentDir, username).map((follower) => ({
        actorId: follower.actorId,
        inboxId: follower.inboxId,
        sharedInboxId: follower.sharedInboxId,
        handle: follower.handle,
        name: follower.name,
        iconUrl: follower.iconUrl,
        url: follower.url,
      })),

    async addFollower(username, follower) {
      await addFollower({ admin, contentDir }, username, follower);
    },
  };
}
