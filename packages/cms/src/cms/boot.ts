import type { DatabaseSync } from 'node:sqlite';

import {
  adminStoreOwning,
  migrateActorKeysToFiles,
  migrateSettingsToFile,
  migrateUsersToFile,
  openAdminDatabase,
} from '../admin/index.ts';
import type { AdminStore } from '../admin/index.ts';
import { databaseFile, rebuildingIfOutdated } from '../cache.ts';
import {
  createAkismetChecker,
  migrateCommentEmails,
  migrateCommentKeys,
  rebuildCommentIndexes,
} from '../comments/index.ts';
import type { CommentRecords } from '../comments/index.ts';
import { isResolvedConfig, resolveConfig } from '../config.ts';
import type { GeekityConfig, ResolvedConfig } from '../config.ts';
import { openContentStore } from '../content/index.ts';
import type { ContentStore } from '../content/index.ts';
import {
  assertActorKeysUsable,
  backfillDeleted,
  migrateFederationToFiles,
  rebuildFederationIndexes,
} from '../federation/index.ts';
import type { InstalledPlugin, PluginRegistry } from '../plugins/registry.ts';
import { migratePluginSettings } from '../plugins/migrate-settings.ts';
import { sitePluginRegistry } from '../plugins/site.ts';
import { latchDevModeOn } from '../settings/dev-mode.ts';
import { createSettings, SITE } from '../site/namespace.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import { listUsers } from '../site/users.ts';

export interface Booted {
  readonly resolved: ResolvedConfig;
  readonly plugins: PluginRegistry;
  readonly store: ContentStore;
  readonly admin: AdminStore;
  readonly commentRecords: CommentRecords;
  readonly settings: SettingsRegistry;
}

export function boot(
  config: GeekityConfig | ResolvedConfig,
  folderPlugins: readonly InstalledPlugin[] | undefined,
): Booted {
  const configured = isResolvedConfig(config) ? config : resolveConfig(config);
  const settings = createSettings({ config: configured });
  if (configured.devMode) latchDevModeOn(settings);

  const { store, admin, adminDb } = rebuildingIfOutdated(configured.dataDir, () =>
    openBothStoresOrNeither(configured),
  );

  // A site upgrading from the version that kept its settings in SQLite has
  // rows nothing would read again: they become content/_data/site.json here,
  // once, and the table goes (decision-9). A site that has already been
  // through it does nothing but check.
  migrateSettingsToFile(adminDb, configured.contentDir);

  migratePluginSettings({
    contentDir: configured.contentDir,
    dataDir: configured.dataDir,
    log: (line) => {
      console.log(line);
    },
  });

  const resolved = withCommentChecker(configured, settings);
  let plugins: PluginRegistry;
  try {
    plugins = sitePluginRegistry(resolved, folderPlugins ?? [], settings);
  } catch (error) {
    admin.close();
    store.close();
    throw error;
  }

  // And the same for its actor's key pairs, which become JWK files under
  // data/keys. This is the migration that must not fail: an actor whose
  // private key is lost is one every follower stops being able to verify, so
  // the rows are written out before the table is dropped, and a file that is
  // already there always wins.
  migrateActorKeysToFiles(adminDb, resolved.dataDir);

  // And the accounts, which become data/users.json. The ids come with them, so
  // a session the database already holds still names the person it was made
  // for, and the file wins where there already is one.
  migrateUsersToFile(adminDb, resolved.dataDir);

  // And the log of what the inbox was told, which becomes
  // content/_data/federation/inbox/{yyyy}-{mm}.jsonl. Unlike the three above,
  // no table is dropped: `ap_inbox` and `followers` stay as indexes of the
  // files, which is why the rebuild is next and runs on every boot rather than
  // once. The site actor's followers are not migrated: decision-14 replaced it
  // with one actor per user, and nobody inherits a follow made with somebody
  // who no longer exists.
  migrateFederationToFiles({ admin, contentDir: resolved.contentDir });
  rebuildFederationIndexes({ admin, contentDir: resolved.contentDir });

  // And the Deletes sent before objectIds.json kept them, so a post they
  // tombstoned comes back under a fresh id. The delivery log is a cache a
  // rebuild throws away, so this is only as good as the log is on the first
  // boot that runs it; from then on the file holds them.
  backfillDeleted(resolved.contentDir, admin.listDeletedObjectIds());

  // And the comments, which are files under content/_data/comments/ with
  // their authors' emails under data/comments/ (TASK-50, TASK-182). A comment
  // file that still holds an email, from before they moved or from a hand
  // edit, has it moved first; then the index is rebuilt, on every boot for the
  // same reason the federation one is.
  const commentRecords = { admin, contentDir: resolved.contentDir, dataDir: resolved.dataDir };
  migrateCommentEmails(commentRecords);
  migrateCommentKeys(commentRecords);
  rebuildCommentIndexes(commentRecords);

  // And, once the files are the whole story, that every user's keys are
  // readable. This is the one thing here that can stop a boot: an actor that
  // publishes no key is one no follower can verify, and Fedify would serve
  // exactly that rather than complain. A minute of downtime with the file
  // named is the better failure. A user who has never federated has no key
  // files at all, which is not damage and does not stop anything.
  for (const user of listUsers(resolved.dataDir)) {
    assertActorKeysUsable(resolved.dataDir, user.username);
  }

  return { resolved, plugins, store, admin, commentRecords, settings };
}

/**
 * A config with the base URL the site's settings hold, when neither the
 * environment nor the config file sets one: `site.base_url`, which the
 * General settings page writes to `url` in `content/_data/site.json`.
 *
 * It is settled once, before the CMS is built, rather than per request.
 * `geekity` settles every config it loads; a site that builds its own CMS and
 * keeps its base URL in the settings awaits this first.
 */
export async function settleConfig(
  config: GeekityConfig | ResolvedConfig,
): Promise<ResolvedConfig> {
  const resolved = isResolvedConfig(config) ? config : resolveConfig(config);
  if (resolved.baseUrlSource !== 'default') return resolved;
  const stored = await createSettings({ config: resolved }).get(SITE.base_url);
  return stored === '' ? resolved : Object.freeze({ ...resolved, baseUrl: stored });
}

function withCommentChecker(resolved: ResolvedConfig, settings: SettingsRegistry): ResolvedConfig {
  return Object.freeze({
    ...resolved,
    // Akismet, when the site has not named a checker of its own (TASK-52). A
    // config that names one wins outright, because a site that has written a
    // checker meant it; this is the one the settings screen turns on with a key
    // rather than a deployment.
    //
    // Built whether or not there is an `akismet.key`: it reads the key on
    // every call, so a key pasted into the settings screen filters the
    // next comment and a key removed stops filtering at once, neither of them
    // needing a restart. With no key it sends nothing anywhere.
    commentChecker:
      resolved.commentChecker ??
      createAkismetChecker({
        settings,
        // Read when a comment arrives rather than now, so a change of language on
        // the settings screen reaches Akismet without a restart either.
        language: () => settings.get(SITE.language),
      }),
  });
}

function openBothStoresOrNeither(resolved: ResolvedConfig): {
  store: ContentStore;
  admin: AdminStore;
  adminDb: DatabaseSync;
} {
  const { dataDir, baseUrl, now } = resolved;
  const store = openContentStore({ dataDir, baseUrl, now });
  try {
    const adminDb = openAdminDatabase(dataDir, now);
    return { store, admin: adminStoreOwning(adminDb, databaseFile(dataDir), now), adminDb };
  } catch (error) {
    store.close();
    throw error;
  }
}
