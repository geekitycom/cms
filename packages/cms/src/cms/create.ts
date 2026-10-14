import type { Server as HttpServer } from 'node:http';
import { Server as NetServer } from 'node:net';

import { serve as serveNode } from '@hono/node-server';
import type { Hono } from 'hono';

import type { AdminStore } from '../admin/index.ts';
import type { AvatarService } from '../avatars/index.ts';
import type { DocumentChangeHook, GeekityConfig, ResolvedConfig } from '../config.ts';
import type {
  ContentEventMap,
  ContentEvents,
  ContentStore,
  Scheduler,
  SyncResult,
} from '../content/index.ts';
import type { GeekityEnv } from '../web/env.ts';
import type { ReplyBackfill } from '../federation/backfill.ts';
import type {
  ActorProfileService,
  DeliveryService,
  RelayService,
  SiteFederation,
} from '../federation/index.ts';
import { refuseWritesUnder } from '../files/atomic.ts';
import type { DataFileDeclaration } from '../files/data-files.ts';
import type { IndexNowNotifier } from '../indexnow.ts';
import type { JobQueue } from '../jobs/types.ts';
import type { MailService, CommentDigest, CommentNotifier } from '../notifications/index.ts';
import type { FeedNotifier, NotifyReport } from '../notify.ts';
import { siteDataFiles } from '../plugins/data.ts';
import type { InstalledPlugin } from '../plugins/registry.ts';
import type { SettingsRegistry } from '../settings/types.ts';
import type { RetentionService } from '../privacy/retention.ts';
import type { Supervision } from '../supervisor/supervision.ts';
import { SITE } from '../site/namespace.ts';
import { messageOf } from '../util/errors.ts';
import type { ReplyContextService, WebmentionService } from '../webmention/index.ts';
import { syndicationTargetProblems } from '../webmention/syndication.ts';
import { createApp } from './app.ts';
import { boot } from './boot.ts';
import { endServices, releaseServices, startServices } from './lifecycle.ts';
import { createServices } from './services.ts';

/** A running (or runnable) CMS instance. */
export interface Cms {
  /**
   * The Hono app. Sites may add their own routes before calling
   * {@link Cms.serve}; handlers reach the index as `c.var.store`.
   */
  readonly app: Hono<GeekityEnv>;
  /** Config after defaults and environment overrides were applied. */
  readonly config: ResolvedConfig;
  /** The content index, opened against {@link ResolvedConfig.dataDir} on boot. */
  readonly store: ContentStore;
  /**
   * Everything in the database that is not the content index: the sessions,
   * the followers and inbox indexes, the delivery outcomes, the relay
   * handshake and the scheduler's watermark. In the same file as the index.
   *
   * All of it is derived or disposable (decision-9); the accounts and the
   * actor's keys, which are not, are files under `dataDir`.
   */
  readonly admin: AdminStore;
  /**
   * Every runtime setting (decision-53): maintenance and dev mode so far, each
   * read through the environment, the config, its file under `dataDir` and its
   * default, and written by the admin and `geekity settings`.
   */
  readonly settings: SettingsRegistry;
  /**
   * Every declaration in effect for this site (decision-55): core's, the
   * settings registry's, each loaded plugin's, and one for each folder under
   * `data/plugins/` whose plugin is not loaded. A file under `dataDir` that
   * none of them covers is a file nobody declared.
   */
  dataFiles(): DataFileDeclaration[];
  /**
   * The site's ActivityPub actor, already mounted on {@link Cms.app}: the
   * actor document, WebFinger, NodeInfo, the inbox and the collections.
   *
   * It is exposed so a site — or a later milestone — may register more
   * dispatchers and listeners on it, and so `ctx.sendActivity` has something
   * to be called through when a post is published.
   */
  readonly federation: SiteFederation;
  /**
   * Outbound ActivityPub delivery: what sends a post to the followers when it
   * is published, edited or withdrawn, and what an admin screen calls to send
   * one of them as it now reads.
   *
   * It is already subscribed to the index; a site only reaches for it to
   * resend a post, or to wait for the deliveries in flight.
   */
  readonly delivery: DeliveryService;
  /**
   * The admin job queue (decision-54): long actions queued by the admin or
   * the CLI and run out of the request, with their status in
   * `data/jobs.json`. Started by {@link Cms.serve}; a CLI command that is not
   * serving queues a job and runs it here with `jobs.run(id)`.
   */
  readonly jobs: JobQueue;
  /**
   * The site's relay subscriptions (FEP-ae0c): what follows a relay when one
   * is added to the settings, what an `Accept` marks accepted, and what every
   * public activity is delivered to alongside the followers.
   */
  readonly relays: RelayService;
  /**
   * The site's outgoing webmentions: what tells the pages a post links to that
   * it links to them, and what an admin screen calls to tell them again.
   *
   * It is already subscribed to the index; a site reaches for it to send one
   * post's links again, or to wait for the ones in flight.
   */
  readonly webmentions: WebmentionService;
  /**
   * What a post shows of the page it answers, reposts, likes or bookmarks
   * (TASK-123, TASK-244): fetched when the post is saved or synced, kept in
   * `content/_data/replyContexts.json`, and read from there when a page is
   * drawn. Already subscribed to the index; a site or a test reaches for it to
   * wait for the fetches in flight.
   */
  readonly replyContexts: ReplyContextService;
  /**
   * The remote avatars a conversation shows, cached under `data/avatars/` and
   * served from `/_geekity/avatars/` (TASK-134). Swept on a timer once the site
   * serves; a site or a test reaches for it to sweep now or to wait.
   */
  readonly avatars: AvatarService;
  /**
   * The profiles of the fediverse actors who are not followers, cached in the
   * database and fetched in the background (TASK-184). Swept on a timer once
   * the site serves; a site or a test reaches for it to sweep now or to wait.
   */
  readonly actorProfiles: ActorProfileService;
  /**
   * The fediverse replies nobody delivered, read off the `replies`
   * collections of the fediverse replies in recent threads (TASK-321). Swept
   * on a timer once the site serves; a site or a test reaches for it to sweep
   * now or to wait.
   */
  readonly replyBackfill: ReplyBackfill;
  /**
   * The sweep that removes commenter emails, address hashes and contact
   * messages once they outlive the periods in the site's settings (TASK-135).
   * Runs on a timer once the site serves; a site or a test reaches for it to
   * sweep now or to wait.
   */
  readonly retention: RetentionService;
  /**
   * The site's rssCloud and WebSub client: what tells the notify server named
   * in the settings that a feed changed, so a subscriber hears at once rather
   * than on its next poll.
   *
   * It is already subscribed to the index; a site reaches for it to ping a
   * feed of its own ({@link Cms.notifyFeeds}), or to wait for the pings in
   * flight.
   */
  readonly notifier: FeedNotifier;
  /**
   * What tells the IndexNow search engines which URLs a publish, an edit or a
   * deletion moved (TASK-151), while the site has IndexNow on. Already
   * subscribed to the index; a site or a test reaches for it to send what it
   * has gathered now and wait for it.
   */
  readonly indexNow: IndexNowNotifier;
  /**
   * The site's outgoing email (TASK-53): what the settings screen's Send test
   * email button uses, and what the password resets, moderation notices and
   * contact messages built on it will.
   *
   * A site with no mail configuration still has one. Its `send` logs that the
   * message was not sent and resolves successfully, so a feature that emails
   * never has to ask whether the site can.
   */
  readonly mail: MailService;
  /**
   * Who is told about comments (TASK-55): the moderators when one is waiting,
   * and a commenter when a reply to them is approved.
   *
   * Here so a site's own code can send the same notice for a comment it
   * created itself. With no mail configuration it sends nothing, like the mail
   * service behind it.
   */
  readonly notifications: CommentNotifier;
  /**
   * The batched half of the same notice (TASK-60): what writes to a user who
   * chose an hourly or a daily digest instead of a message per comment.
   *
   * It is started by {@link Cms.serve} and stopped by {@link Cms.close}; a
   * site reaches for it to send what is due without waiting for the tick,
   * which is also what a test does.
   */
  readonly digests: CommentDigest;
  /**
   * The publisher of scheduled posts: what holds a future-dated post back and
   * releases it when its date arrives.
   *
   * It is already subscribed to the index and started by {@link Cms.serve}; a
   * site reaches for it to ask what it is waiting for, or to release what is
   * due without waiting for the timer.
   */
  readonly scheduler: Scheduler;
  /**
   * Index changes, as they happen: `created`, `updated`, `deleted`,
   * `published`, `unpublished` and the catch-all `change`. Every listener is
   * handed the document before and after the change.
   */
  readonly events: ContentEvents;
  /**
   * Run a hook for every `created`, `updated` and `deleted`. The same thing
   * the `onDocumentChange` config option does, for a site that would rather
   * subscribe from its entry file. Returns the function that unsubscribes.
   *
   * The boot scan reports a cold index as a directory full of creations, so a
   * hook that must not re-fire on a rebuilt index should check
   * `change.origin !== 'scan'`.
   */
  onDocumentChange(hook: DocumentChangeHook): () => void;
  /**
   * Run a hook whenever a document becomes visible on the public site: created
   * live, a draft published, or a document restored from the trash. Subject to
   * the same `origin` caveat as {@link Cms.onDocumentChange}. Returns the
   * function that unsubscribes.
   */
  onPublish(hook: DocumentChangeHook): () => void;
  /**
   * Run `listener` each time the index settles: after every scan, and after
   * a run of watcher changes once none is waiting, when every listener on
   * {@link Cms.events} has finished with them. Returns the function that
   * unsubscribes.
   */
  onSettled(listener: () => unknown): () => void;
  /**
   * Tell the notify server that these feeds changed — absolute URLs, because
   * it is going to fetch them. The hook a site calls for a feed the CMS does
   * not know it has.
   *
   * Best effort: the pings are queued behind whatever is already going out, a
   * repeated URL is sent once, and a refusal is logged rather than thrown. A
   * site that names no notify server gets an empty report.
   */
  notifyFeeds(urls: readonly string[]): Promise<NotifyReport>;
  /**
   * Walk the content directory once and bring the index into line with it.
   * What `serve()` does on boot, and what the `geekity sync` command runs.
   */
  sync(): Promise<SyncResult>;
  /**
   * Scan the content directory, start watching it unless
   * {@link ResolvedConfig.watch} is off, and start listening. Resolves with
   * the address actually bound, which matters when the port is 0.
   */
  serve(): Promise<{ port: number }>;
  /**
   * Hand over to a new server (TASK-288): refuse every request but GET and
   * HEAD with a 503, let the writes already in flight finish, stop the
   * timers, the watcher and the plugins, send what the queues hold, and then
   * write nothing more to the database, `dataDir` or `contentDir`. What
   * `geekity serve` does to the old worker on a reload, before the new one
   * boots. `onWritesInFlight` hears how many writes are in flight when the drain has
   * to wait for them.
   */
  drain(onWritesInFlight?: (writes: number) => void): Promise<void>;
  /** Undo {@link Cms.drain}: the new server did not boot, so this one carries on. */
  resume(): Promise<void>;
  /**
   * Stop watching, stop listening and close the index. Safe to call when not
   * listening, and safe to call twice. After {@link Cms.drain}, each open
   * connection is left to finish on its own rather than closed under a client
   * that may be about to reuse it.
   */
  close(): Promise<void>;
}

/** What `geekity serve` hands the CMS it runs, beyond the site's config (TASK-288). */
export interface ServeContext {
  /** Plugins imported from the plugins folder, registered beside the config's. */
  readonly folderPlugins?: readonly InstalledPlugin[];
  /** The supervisor this CMS runs under, which Reload on the Plugins screen asks. */
  readonly supervision?: Supervision;
}

/**
 * Build a CMS around a site's config, or around one `resolveConfig` already
 * resolved, which is used as it is.
 *
 * The returned app is a plain Hono app: the public site, the admin UI and the
 * federation endpoints are all mounted on it. Booting opens the SQLite cache
 * under `dataDir` (creating the directory) and applies any migrations, so
 * `close()` has to be called to release it. A missing or outdated database is
 * built again from the files; one written by a newer `@geekity/cms`, or damaged
 * past opening, throws an `UnusableDatabaseError` naming the file.
 */
export function createCms(
  config: GeekityConfig | ResolvedConfig = {},
  context: ServeContext = {},
): Cms {
  const booted = boot(config, context.folderPlugins);
  const { resolved, store, admin } = booted;
  const services = createServices(booted);
  const { content, lifecycle } = services;
  const { app, writes } = createApp(booted, services, context.supervision);

  /**
   * Subscribe a site's hook to one event.
   *
   * The emitter already contains a hook that throws; this also contains one
   * that rejects, so an `async` hook whose delivery fails is reported rather
   * than surfacing as an unhandled rejection that would take the process down.
   */
  function subscribe(event: keyof ContentEventMap, hook: DocumentChangeHook): () => void {
    return content.events.on(event, (change) => {
      const result = hook(change);
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          const message = messageOf(error);
          console.warn(`A ${event} hook rejected: ${message}`);
        });
      }
    });
  }

  if (resolved.onDocumentChange !== undefined) subscribe('change', resolved.onDocumentChange);
  if (resolved.onPublish !== undefined) subscribe('published', resolved.onPublish);

  let server: HttpServer | undefined;
  let releaseFiles: (() => void) | undefined;

  return {
    app,
    config: resolved,
    store,
    admin,
    settings: booted.settings,
    dataFiles: () =>
      siteDataFiles({
        dataDir: resolved.dataDir,
        settings: booted.settings,
        plugins: booted.plugins,
      }),
    federation: services.federation,
    delivery: services.delivery,
    jobs: services.jobs,
    relays: services.relays,
    webmentions: services.webmentions,
    replyContexts: services.replyContexts,
    avatars: services.avatars,
    actorProfiles: services.actorProfiles,
    replyBackfill: services.replyBackfill,
    retention: services.retention,
    notifier: services.notifier,
    indexNow: services.indexNow,
    mail: services.mail,
    notifications: services.notifications,
    digests: services.digests,
    scheduler: services.scheduler,
    events: content.events,

    onDocumentChange(hook) {
      return subscribe('change', hook);
    },

    onPublish(hook) {
      return subscribe('published', hook);
    },

    onSettled(listener) {
      return content.onSettled(listener);
    },

    notifyFeeds(urls) {
      return services.notifier.notify(urls);
    },

    sync() {
      return content.sync();
    },

    async serve() {
      if (server !== undefined) {
        throw new Error('This CMS is already serving; call close() before serving again.');
      }

      await startServices(lifecycle);

      const stored = await booted.settings.get(SITE.base_url);
      if (resolved.baseUrlSource === 'default' && stored !== '' && stored !== resolved.baseUrl) {
        console.warn(
          `The settings give the base URL as ${stored}, but this CMS was built for ` +
            `${resolved.baseUrl}. Build it from \`await settleConfig(config)\` to serve the setting.`,
        );
      }

      // A syndication target the site declares badly is ignored everywhere,
      // and said so once here rather than on every page (TASK-155).
      for (const problem of syndicationTargetProblems(resolved.contentDir)) console.warn(problem);

      return new Promise((resolve) => {
        server = serveNode({ fetch: app.fetch, port: resolved.port }, (info) => {
          resolve({ port: info.port });
        }) as HttpServer;
      });
    },

    async drain(onWritesInFlight) {
      await writes.refuse(onWritesInFlight);
      await endServices(lifecycle, 'drain');
      store.setReadOnly(true);
      admin.setReadOnly(true);
      releaseFiles ??= refuseWritesUnder([resolved.dataDir, resolved.contentDir]);
    },

    async resume() {
      releaseFiles?.();
      releaseFiles = undefined;
      store.setReadOnly(false);
      admin.setReadOnly(false);
      await startServices(lifecycle);
      writes.reopen();
    },

    async close() {
      const running = server;
      server = undefined;
      const handingOver =
        running !== undefined && writes.refusing ? closeServer(running, true) : undefined;
      if (writes.refusing) writes.handOver();
      await endServices(lifecycle, 'close');
      releaseServices(lifecycle);

      if (running !== undefined) await (handingOver ?? closeServer(running, false));

      releaseFiles?.();
      releaseFiles = undefined;
      admin.close();
      store.close();
    },
  };
}

/** How long a drained server waits for its connections to end before it closes them. */
const GENTLE_CLOSE_MS = 30_000;

/**
 * Stop listening and resolve once every connection has ended.
 *
 * A drained server closes gently. `http.Server#close` closes idle keep-alive
 * connections at once, racing a client that is about to reuse one, which
 * then sees a reset. `net.Server#close` leaves them: each one either carries
 * `Connection: close` on its next response or ends on the keep-alive timeout
 * the client was told, which a client honours by closing first.
 */
function closeServer(running: HttpServer, gently: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (err?: Error) => {
      if (err) reject(err);
      else resolve();
    };
    if (!gently) {
      running.close(done);
      return;
    }
    const timer = setTimeout(() => running.closeAllConnections(), GENTLE_CLOSE_MS);
    NetServer.prototype.close.call(running, (err?: Error) => {
      clearTimeout(timer);
      // The http server's own close clears its connection-checking interval;
      // the listener is already gone, so the error it reports is expected.
      running.close(() => undefined);
      done(err);
    });
  });
}
