import path from 'node:path';

import { MemoryKvStore } from '@fedify/fedify';
import type { KvStore } from '@fedify/fedify';

import { listUsers } from '../admin/index.ts';
import type { ConversationWrite } from '../store/admin-store.ts';
import { createAvatarService } from '../avatars/index.ts';
import type { AvatarService } from '../avatars/index.ts';
import { followAllMovedComments, followMovedComments } from '../comments/index.ts';
import { createReplyNotices } from '../comments/reply-notices.ts';
import { createContentSync, createScheduler } from '../content/index.ts';
import type { ContentEventListener, ContentSync, Scheduler } from '../content/index.ts';
import { createReplyBackfill, signedRepliesLoader } from '../federation/backfill.ts';
import type { ReplyBackfill } from '../federation/backfill.ts';
import type { ConversationSite } from '../comments/conversation.ts';
import type { CitedPageReader } from '../content/citation.ts';
import { citedPostReader } from '../federation/cited-post.ts';
import { mintMissingIndexNowKey, SITE } from '../site/namespace.ts';
import { messageOf } from '../util/errors.ts';
import { handleLearner } from '../federation/handles.ts';
import type { HandleLearner } from '../federation/handles.ts';
import {
  createActorProfileService,
  createDeliveryService,
  createRelayService,
  createSiteFederation,
  signedProfileLoader,
} from '../federation/index.ts';
import type {
  ActorProfileService,
  DeliveryService,
  RelayService,
  SiteFederation,
} from '../federation/index.ts';
import { createSettlingQueue } from '../federation/queue.ts';
import { settleImageVariants } from '../images/variants.ts';
import { createFileRecords } from '../jobs/file-records.ts';
import { createInProcessTransport } from '../jobs/in-process.ts';
import { createJobQueue } from '../jobs/queue.ts';
import type { JobQueue } from '../jobs/types.ts';
import { createIndexNowNotifier } from '../indexnow.ts';
import type { IndexNowNotifier } from '../indexnow.ts';
import { activityLogSettled } from '../web/indieauth-activity-log.ts';
import { createIndieAuthState } from '../indieauth/grants.ts';
import type { IndieAuthState } from '../indieauth/grants.ts';
import {
  createMailService,
  createCommentDigest,
  createCommentNotifier,
} from '../notifications/index.ts';
import type { MailService, CommentDigest, CommentNotifier } from '../notifications/index.ts';
import { createMaintenanceSwitch } from '../maintenance.ts';
import type { MaintenanceSwitch } from '../maintenance.ts';
import { createFeedNotifier } from '../notify.ts';
import type { FeedNotifier } from '../notify.ts';
import { readEnabledPlugins } from '../plugins/enabled.ts';
import { createRetentionService } from '../privacy/retention.ts';
import type { RetentionService } from '../privacy/retention.ts';
import type { ConversationReader } from '../comments/conversation.ts';
import {
  createConversation,
  createRedirectSource,
  createRenderer,
  createSiteDataSource,
  createThemeSource,
  themeName,
} from '../web/index.ts';
import { pageSources } from '../web/page-sources.ts';
import type { RedirectSource } from '../content/redirects.ts';
import type { SiteRecords } from '../content/write.ts';
import type { Renderer } from '../web/render.ts';
import {
  createReplyContextService,
  createWebmentionService,
  followMovedWebmentions,
} from '../webmention/index.ts';
import type { ReplyContextService, WebmentionService } from '../webmention/index.ts';
import { heldReplyContext } from '../webmention/reply-context.ts';
import type { Booted } from './boot.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import type { Ending, Service } from './lifecycle.ts';
import { siteRecords } from './site-records.ts';

/**
 * Where the scheduler's watermark lives in {@link AdminStore.getState}: the
 * instant up to which scheduled documents have been announced.
 */
export const SCHEDULE_WATERMARK_KEY = 'schedule.watermark';

/** Where the instant the scheduler first ran on this site lives in {@link AdminStore.getState}. */
export const SCHEDULE_FIRST_RUN_KEY = 'schedule.firstRun';

export interface Services {
  readonly content: ContentSync;
  readonly conversation: ConversationReader;
  readonly renderer: Renderer;
  readonly redirects: RedirectSource;
  readonly mail: MailService;
  readonly federation: SiteFederation;
  readonly federationKv: KvStore;
  readonly delivery: DeliveryService;
  readonly relays: RelayService;
  readonly webmentions: WebmentionService;
  readonly replyContexts: ReplyContextService;
  readonly avatars: AvatarService;
  readonly actorProfiles: ActorProfileService;
  readonly replyBackfill: ReplyBackfill;
  readonly retention: RetentionService;
  readonly notifier: FeedNotifier;
  readonly indexNow: IndexNowNotifier;
  readonly notifications: CommentNotifier;
  readonly digests: CommentDigest;
  readonly scheduler: Scheduler;
  readonly learnHandles: HandleLearner;
  readonly siteRecords: SiteRecords;
  readonly maintenance: MaintenanceSwitch;
  readonly indieauth: IndieAuthState;
  readonly jobs: JobQueue;
  readonly lifecycle: readonly Service[];
}

export function createServices({
  resolved,
  plugins,
  store,
  admin,
  commentRecords,
  settings,
}: Booted): Services {
  const site = { admin, store, config: resolved, settings };

  // Which theme this site renders through (decision-15). One source for the
  // whole CMS: the pages, the `/theme/` assets and the site's email all read
  // it, so they cannot disagree about which theme is in use and a choice that
  // cannot be honoured is reported once rather than three times. It reads the
  // site data rather than holding a directory, so a theme chosen on the
  // Appearance screen — or written into `site.json` by hand — is the one the
  // next request renders through, with no restart and with the watcher off.
  const siteData = createSiteDataSource(resolved);
  const themes = createThemeSource({
    themesDir: resolved.themesDir,
    chosen: () => themeName(siteData.read()),
  });
  // Asked once here so a site whose chosen theme is missing says so at boot,
  // rather than at whatever moment the first request happens to arrive.
  themes.current();

  // The site's declared redirects (TASK-128), read per request for the reason
  // the site data is. Asked once here for the reason the theme is: an entry
  // that cannot be served, or a loop, is reported at boot.
  const redirects = createRedirectSource({ contentDir: resolved.contentDir });
  redirects.current();

  const content = createContentSync({
    store,
    contentDir: resolved.contentDir,
    watch: resolved.watch,
    debounce: resolved.watchDebounce,
  });
  content.onSettled(async () => {
    await followAllMovedComments(commentRecords, store);
    followMovedWebmentions(admin, store, resolved.baseUrl);
  });

  // Email. Built whether or not the site has a provider or a credential, for
  // the reason the Akismet checker is: the settings and `data/mail.json` are
  // read per send, so a key pasted into the settings screen sends the next
  // message and one removed stops the message after it, neither needing a
  // restart. With nothing configured, sending is a line in the log.
  const mail = createMailService({ config: resolved, settings, themes, ...resolved.mail });

  // The one reader of the two indexes a conversation is made of. The page, the
  // per-post comments feed, `/comments/feed/` and the `source:comments` count
  // on a post feed are all drawn from it, so a reader cannot be shown one
  // thing on the page and another in the feed (TASK-62).
  const conversation = createConversation({
    admin,
    store,
    contentDir: resolved.contentDir,
    baseUrl: resolved.baseUrl,
    users: () => listUsers(resolved.dataDir),
  });

  const replyContexts = createReplyContextService({
    store,
    config: resolved,
    lookup: resolved.hostLookup,
    fediverse: citedPostReader(() => federationContext()),
    held: {
      settings,
      at: (target, site) => {
        const found = conversation.heldAt(target, site);
        return found === undefined ? undefined : heldReplyContext(target, found);
      },
    },
    onStored: (target, previous) => {
      delivery.citedPageStored(target, previous);
      const original = replyContexts.stored(target)?.original;
      if (original !== undefined && original !== previous?.original) {
        webmentions.originalFound(target, original);
      }
    },
  });
  const citedWith =
    (site: ConversationSite): CitedPageReader =>
    (url) =>
      replyContexts.read(url, site);
  const cited = async (): Promise<CitedPageReader> => citedWith(await settings.values(SITE));

  // The faces in a conversation, fetched here and served from here so a
  // reader's address never reaches the servers they live on (TASK-134).
  const avatars = createAvatarService({ admin, config: resolved });

  // What keeps a site from holding its readers' personal data for longer than
  // its settings say (TASK-135).
  const retention = createRetentionService({ admin, config: resolved, settings });

  const renderer = createRenderer({
    config: resolved,
    themes,
    // The stored context of a reply's target: a file read, never a fetch, so
    // a page is drawn without waiting on anybody's server (TASK-123).
    replyContext: (target, site) => replyContexts.read(target, site),
    // What has been said about a post, from the very reader the comments
    // feeds are published from, so the page and the feed cannot disagree.
    conversation: conversation.thread,
    ...pageSources({
      config: resolved,
      store,
      redirects,
      siteData,
    }),
  });

  const federationKv = resolved.federation.kv ?? new MemoryKvStore();
  const federationQueue =
    resolved.federation.queue === null ? undefined : createSettlingQueue(resolved.federation.queue);
  const federation = createSiteFederation({
    baseUrl: resolved.baseUrl,
    ...resolved.federation,
    queue: federationQueue ?? null,
    kv: federationKv,
  });

  // The names and faces of the actors who are not followers (TASK-184),
  // fetched in the background when one is heard from and on a sweep.
  const actorProfiles = createActorProfileService({
    admin,
    config: resolved,
    load: signedProfileLoader(() => federationContext()),
  });

  const federated = { ...site, actorProfiles, cited: citedWith };
  const federationContext = async () => {
    const settled = await settings.values(SITE);
    return federation.createContext(new URL(resolved.baseUrl), {
      ...federated,
      site: settled,
      cited: citedWith(settled),
    });
  };

  const learnHandles = handleLearner(federationContext);

  const replyBackfill = createReplyBackfill({
    ...site,
    conversation,
    load: signedRepliesLoader(federationContext),
    heard: (actorId) => {
      actorProfiles.capture(actorId);
    },
  });

  // Federation listens to the index rather than to the admin, so a post edited
  // on disk federates exactly as one saved through the editor does (doc-4).
  const delivery = createDeliveryService({ ...federated, federation });

  // Who hears about a comment (TASK-55). It reads the users file and the mail
  // settings per message rather than at boot, so an address added on the users
  // screen is written to by the very next comment.
  const notifications = createCommentNotifier({ ...site, mail, cited });

  const replyNotices = createReplyNotices({
    ...site,
    conversation,
    notices: notifications,
  });

  // And the other half of it (TASK-60): a user who asked for an hourly or a
  // daily digest hears nothing above and one message per window from here,
  // listing whatever is still pending when their window comes up. It reads the
  // users file and the record of what it has sent per run, for the same
  // reason: a mode chosen on the users screen takes effect at the next tick.
  const digests = createCommentDigest({ ...site, mail, cited });

  // And so does the webmention sender: telling the pages a post links to is
  // the same news as telling the followers, and it should not matter which
  // door the post came in by (TASK-51).
  const webmentions = createWebmentionService({
    ...site,
    notifications,
    originalOf: (url) => replyContexts.stored(url)?.original,
    conversation,
  });

  // The notify server listens to the index for the same reason: a post edited
  // on disk changed the same feeds as one saved through the editor.
  const notifier = createFeedNotifier({ config: resolved, settings });

  // IndexNow listens for the same reason, and wants the pages as well as the
  // posts: a search engine indexes both (TASK-151).
  const indexNow = createIndexNowNotifier({ config: resolved, settings });
  mintMissingIndexNowKey(settings, 'boot').catch((thrown: unknown) => {
    console.error(`No IndexNow key was minted: ${messageOf(thrown)}`);
  });

  // A post whose date is in the future is held back (TASK-44), and nothing
  // watches a clock: this is what notices that one has come due and reports it
  // as the publish it is, so delivery, the notifier and a site's `onPublish`
  // all run without knowing a timer was involved. Subscribed to every change
  // so a save that moves a date moves the timer with it.
  const scheduler = createScheduler({
    store,
    announce: (change) => content.announce(change),
    watermark: {
      read: () => admin.getState(SCHEDULE_WATERMARK_KEY),
      write: (instant) => {
        admin.setState(SCHEDULE_WATERMARK_KEY, instant);
      },
      readFirstRun: () => admin.getState(SCHEDULE_FIRST_RUN_KEY),
      writeFirstRun: (instant) => {
        admin.setState(SCHEDULE_FIRST_RUN_KEY, instant);
      },
    },
  });

  // Relay subscriptions (FEP-ae0c). The list is a setting and the handshake is
  // a record, so booting reconciles the two: a relay the file names and the
  // database has never heard of is followed here, which is what makes a
  // rebuilt database catch up rather than silently stop federating to it.
  const relays = createRelayService({ ...federated, federation });
  relays.sync().catch((thrown: unknown) => {
    console.warn(`The relays could not be read: ${messageOf(thrown)}`);
  });
  settings.watch(SITE.relays, async () => {
    await relays.sync();
  });

  const jobs = createJobQueue({
    transport: resolved.jobs.transport ?? createInProcessTransport(),
    records: resolved.jobs.records ?? createFileRecords(path.join(resolved.dataDir, 'jobs.json')),
    jobs: resolved.jobs.definitions ?? [],
    now: resolved.now,
  });

  const changeSubscribers: readonly ContentEventListener[] = [
    // A watched change waits for its burst to settle, as a scan does: a git
    // pull that moves a post and adds another at its old URL must not hand the
    // new post's comments to the moved one before the new one is indexed.
    async (change) => {
      if (change.origin === 'scan' || change.origin === 'watch' || change.next === undefined) {
        return;
      }
      await followMovedComments(commentRecords, store, change.next);
      followMovedWebmentions(admin, store, resolved.baseUrl);
    },
    (change) => delivery.handle(change),
    (change) => {
      replyNotices.handle(change);
    },
    (change) => {
      webmentions.handle(change);
    },
    (change) => {
      replyContexts.handle(change);
    },
    (change) => {
      notifier.handle(change);
    },
    (change) => {
      indexNow.handle(change);
    },
    (change) => {
      scheduler.handle(change);
    },
  ];
  for (const listener of changeSubscribers) content.events.on('change', listener);

  // A reply under a reply post or a comment's page changes what its page
  // says, whichever door it came in by, and the page tells what it answers
  // (a salmention, TASK-320).
  const conversationWriteSubscribers: readonly ((written: ConversationWrite) => void)[] = [
    (written) => {
      replyNotices.queueNoticesFor(written);
    },
    (written) => {
      webmentions.heard(written);
    },
  ];
  for (const listener of conversationWriteSubscribers) admin.onConversationWrite(listener);

  const lifecycle: readonly Service[] = [
    // The index is brought up to date before the first request, so a site
    // never serves a stale document, and the watcher takes over from there.
    {
      start: async () => {
        await content.start();
      },
      stop: () => content.stop(),
    },
    // After the scan, because the catch-up reads the index: a post whose
    // date passed while nothing was running is published here, once.
    {
      start: () => scheduler.start(),
      stop: () => {
        scheduler.stop();
      },
      settled: () => scheduler.settled(),
    },
    // After the scan, so a job reads an index that is up to date. Settled
    // before delivery, so what a job queued there is waited for after it.
    {
      start: () => jobs.start(),
      stop: () => {
        jobs.stop();
      },
      settled: () => jobs.close(),
    },
    { settled: () => delivery.settled() },
    { settled: () => relays.settled() },
    {
      settled: async () => {
        await federationQueue?.settled();
      },
      release: () => {
        federationQueue?.close();
      },
    },
    { settled: () => webmentions.settled() },
    {
      start: () => {
        replyContexts.catchUp();
      },
      settled: () => replyContexts.settled(),
    },
    avatars,
    actorProfiles,
    replyBackfill,
    retention,
    digests,
    { settled: () => notifier.settled() },
    {
      // What was gathered and not yet sent is dropped rather than sent on the
      // way down; a batch already going out finishes.
      settled: (ending) => {
        if (ending === 'close') indexNow.close();
        return indexNow.settled();
      },
    },
    {
      start: () => plugins.reconcile(readEnabledPlugins(resolved.contentDir)),
      stop: (ending) => stopPlugins(plugins, ending),
    },
    { settled: () => replyNotices.settled() },
    { settled: () => notifications.settled() },
    { settled: () => mail.settled() },
    // A page render derives an upload's variants in the background; the
    // encode finishes before the directories it writes into can be removed.
    { settled: () => settleImageVariants(resolved) },
    { settled: () => activityLogSettled(resolved.dataDir) },
  ];

  return {
    content,
    conversation,
    renderer,
    redirects,
    mail,
    federation,
    federationKv,
    delivery,
    relays,
    webmentions,
    replyContexts,
    avatars,
    actorProfiles,
    replyBackfill,
    retention,
    notifier,
    indexNow,
    notifications,
    digests,
    scheduler,
    learnHandles,
    siteRecords: siteRecords(resolved),
    maintenance: createMaintenanceSwitch({ settings, now: resolved.now }),
    indieauth: createIndieAuthState(resolved.now),
    jobs,
    lifecycle,
  };
}

function stopPlugins(plugins: PluginRegistry, ending: Ending): Promise<void> {
  switch (ending) {
    case 'drain':
      return plugins.reconcile(new Set());
    case 'close':
      return plugins.close();
  }
}
