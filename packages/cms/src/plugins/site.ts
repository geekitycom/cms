/**
 * The site as a plugin reaches it (decision-33): the accounts, keys and
 * followers behind {@link PluginSite}, and the registry a site's config
 * installs. Shared by requests and the command line, so a plugin's command
 * and its federation read the same files the same way.
 */

import path from 'node:path';

import { listUsers, setUserActorId } from '../admin/accounts.ts';
import { readSiteSettings } from '../admin/settings.ts';
import type { AdminStore, CommentRecord } from '../admin/store.ts';
import { acceptUpload, refusedUpload } from '../admin/uploads.ts';
import { renderCommentMarkdown } from '../comments/markdown.ts';
import { commentsFile, putComments, readComments } from '../comments/records.ts';
import type { ResolvedConfig } from '../config.ts';
import { slugForPermalink } from '../content/parser.ts';
import { readFileIfPresentSync } from '../files/atomic.ts';
import { actorKeyFile, loadActorKeyPairs, writeActorKeyFile } from '../federation/keys.ts';
import { addFollower, readFollowers } from '../federation/records.ts';
import type { PluginComment, PluginSite } from '../plugin.ts';
import { createPluginRegistry } from './registry.ts';
import type { InstalledPlugin, PluginRegistry } from './registry.ts';

/** Every plugin the site config installs, and those from the plugins folder, registered. */
export function sitePluginRegistry(
  config: ResolvedConfig,
  folderPlugins: readonly InstalledPlugin[] = [],
): PluginRegistry {
  return createPluginRegistry(
    [
      ...config.plugins.map((plugin, index) => ({
        plugin,
        source: `the site config, plugins[${String(index)}]`,
      })),
      ...folderPlugins,
    ],
    {
      dataDir: config.dataDir,
      contentDir: config.contentDir,
      env: process.env,
      allowPrivateAddress: config.federation.allowPrivateAddress ?? false,
      lookup: config.hostLookup,
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
    contentDir,

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

    checkUpload(name, bytes) {
      const outcome = acceptUpload(name, '', bytes, config);
      return refusedUpload(outcome)
        ? { accepted: false, why: outcome.error }
        : { accepted: true, bytes: outcome.bytes };
    },

    comments(permalink) {
      const slug = postSlug(permalink);
      return {
        file: path.relative(contentDir, commentsFile(contentDir, slug)).split(path.sep).join('/'),
        comments: readComments({ contentDir, dataDir }, slug).map(pluginCommentOf),
      };
    },

    async putComments(permalink, comments) {
      await putComments(
        { admin, contentDir, dataDir },
        postSlug(permalink),
        permalink,
        comments.map(commentRecordOf),
      );
    },
  };
}

function postSlug(permalink: string): string {
  const slug = slugForPermalink(permalink);
  if (slug === undefined) throw new Error(`${permalink} names no post a comment can be on.`);
  return slug;
}

function pluginCommentOf(comment: CommentRecord): PluginComment {
  return {
    id: comment.id,
    source: comment.source,
    kind: comment.kind,
    status: comment.status,
    author: { ...comment.author },
    markdown: comment.content.markdown,
    submitted: comment.submitted,
    inReplyTo: comment.inReplyTo,
    url: comment.url,
  };
}

function commentRecordOf(comment: PluginComment): CommentRecord {
  return {
    id: comment.id,
    source: comment.source,
    kind: comment.kind,
    status: comment.status,
    author: { ...comment.author },
    content: { markdown: comment.markdown, html: renderCommentMarkdown(comment.markdown) },
    submitted: comment.submitted,
    addressHash: null,
    inReplyTo: comment.inReplyTo,
    url: comment.url,
    notify: false,
  };
}
