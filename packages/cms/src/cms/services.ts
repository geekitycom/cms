import { MemoryKvStore } from '@fedify/fedify';
import type { KvStore } from '@fedify/fedify';

import { listUsers, readSiteSettings } from '../admin/index.ts';
import type { ConversationWrite } from '../admin/store.ts';
import { createAvatarService } from '../avatars/index.ts';
import type { AvatarService } from '../avatars/index.ts';
import { commentFormFor, followAllMovedComments, followMovedComments } from '../comments/index.ts';
import { createReplyNotices } from '../comments/reply-notices.ts';
import { contactFormFor } from '../contact/index.ts';
import { createContentSync, createScheduler } from '../content/index.ts';
import type { ContentEventListener, ContentSync, Scheduler } from '../content/index.ts';
import { shareLocation } from '../content/location.ts';
import { postLocations } from '../content/locations.ts';
import { createReplyBackfill, signedRepliesLoader } from '../federation/backfill.ts';
import type { ReplyBackfill } from '../federation/backfill.ts';
import { citedPostReader } from '../federation/cited-post.ts';
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
import { createIndexNowNotifier } from '../indexnow.ts';
import type { IndexNowNotifier } from '../indexnow.ts';
import { activityLogSettled } from '../indieauth/activity-log.ts';
import { createIndieAuthState } from '../indieauth/grants.ts';
import type { IndieAuthState } from '../indieauth/grants.ts';
import { createMailService } from '../mail/index.ts';
import type { MailService } from '../mail/index.ts';
import { createMaintenanceSwitch } from '../maintenance.ts';
import type { MaintenanceSwitch } from '../maintenance.ts';
import { createCommentDigest, createCommentNotifier } from '../notifications/index.ts';
import type { CommentDigest, CommentNotifier } from '../notifications/index.ts';
import { createFeedNotifier } from '../notify.ts';
import type { FeedNotifier } from '../notify.ts';
import { readEnabledPlugins } from '../plugins/enabled.ts';
import { createRetentionService } from '../privacy/retention.ts';
import type { RetentionService } from '../privacy/retention.ts';
import type { ConversationReader } from '../web/conversation.ts';
import {
  createConversation,
  createRedirectSource,
  createRenderer,
  createSiteDataSource,
  createThemeSource,
  frontPageSlugs,
  themeName,
} from '../web/index.ts';
import type { RedirectSource } from '../web/redirects.ts';
import type { Renderer } from '../web/render.ts';
import {
  createReplyContextService,
  createWebmentionService,
  followMovedWebmentions,
} from '../webmention/index.ts';
import type { ReplyContextService, WebmentionService } from '../webmention/index.ts';
import { heldReplyContext } from '../webmention/reply-context.ts';
import {
  selectedTargets,
  syndicationCopies,
  syndicationTargetsReader,
} from '../webmention/syndication.ts';
import type { Booted } from './boot.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import type { Ending, Service } from './lifecycle.ts';

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
  readonly maintenance: MaintenanceSwitch;
  readonly indieauth: IndieAuthState;
  readonly lifecycle: readonly Service[];
}

export function createServices({
  resolved,
  plugins,
  store,
  admin,
  commentRecords,
}: Booted): Services {
  const site = { admin, store, config: resolved };

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
  const mail = createMailService({ config: resolved, themes, ...resolved.mail });

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

  // The syndication targets the site declares and the copies they answered
  // with, both files in the content directory (TASK-155, decision-26).
  const syndicationTargets = syndicationTargetsReader(resolved.contentDir);
  const copies = syndicationCopies(resolved.contentDir);
  const locations = postLocations(resolved.dataDir);

  const replyContexts = createReplyContextService({
    store,
    config: resolved,
    lookup: resolved.hostLookup,
    fediverse: citedPostReader(() => federationContext()),
    held: (target) => {
      const found = conversation.heldAt(target);
      return found === undefined ? undefined : heldReplyContext(target, found);
    },
    onStored: (target, previous) => {
      delivery.citedPageStored(target, previous);
      const original = replyContexts.read(target)?.original;
      if (original !== undefined && original !== previous?.original) {
        webmentions.originalFound(target, original);
      }
    },
  });
  const cited = (url: string) => replyContexts.read(url);

  // The faces in a conversation, fetched here and served from here so a
  // reader's address never reaches the servers they live on (TASK-134).
  const avatars = createAvatarService({ admin, config: resolved });

  // What keeps a site from holding its readers' personal data for longer than
  // its settings say (TASK-135).
  const retention = createRetentionService({ admin, config: resolved });

  const renderer = createRenderer({
    config: resolved,
    themes,
    // The stored context of a reply's target: a file read, never a fetch, so
    // a page is drawn without waiting on anybody's server (TASK-123).
    replyContext: cited,
    // The targets a post links to and the copies they made of it (TASK-155),
    // read from the site's files like the reply contexts.
    syndication: (document) => ({
      targets: selectedTargets(
        document,
        syndicationTargets(),
        readSiteSettings(resolved.contentDir).language,
      ),
      copies: Object.values(copies.read(document.permalink)),
    }),
    location: (document) =>
      shareLocation(
        locations.read(document.permalink),
        readSiteSettings(resolved.contentDir).locationSharing,
      ),
    // The pages that put themselves in the site menu are found by asking for
    // every public page and reading their front matter, rather than by an
    // index of their own: a site has a handful of pages, the query is the
    // same one the listing index already serves, and doing it per render is
    // what makes a page flagged in the editor appear in the menu at once.
    pages: () => store.listAll({ type: 'page', draft: false, trashed: false, scheduled: false }),
    // Who may sign in, for the byline under a post and the heading of an
    // author archive (TASK-67). Read per render for the reason the pages are:
    // `data/users.json` is the truth about who exists (decision-9), and a
    // display name saved on the users screen a second ago belongs on the very
    // next page drawn.
    users: () => listUsers(resolved.dataDir),
    // What has been said about a post, from every source at once and read per
    // render for the same reason: a reply logged or a comment approved a
    // second ago is on the page the next request draws (TASK-49, TASK-50).
    // One dependency, and the very reader the comments feeds are published
    // from, so the page and the feed cannot disagree.
    conversation: conversation.thread,
    // And the form under it, when the post is still taking comments. Asked per
    // render because whether it is depends on the clock: a post that closed an
    // hour ago stops offering one on the very next request.
    commentForm: (document, viewer) =>
      commentFormFor({
        document,
        site: renderer.site(),
        now: resolved.now(),
        // And who is reading it, when a session says: the short form for
        // somebody signed in to this site, the stranger's form for everybody
        // else (TASK-103). The route reads the session and hands it down, so
        // one render of one request cannot disagree with itself.
        viewer,
        // Whether "tell me about replies" is worth offering, asked per render
        // for the same reason: a credential pasted into the settings screen
        // puts the box on the next page drawn (TASK-55).
        notifiable: mail.configured(),
      }),
    // And the contact form, for a page whose front matter asks for one. Asked
    // per render for the same reason: a `contact: true` saved in the editor a
    // moment ago puts a form on the page the next request draws (TASK-56).
    contactForm: (document) => contactFormFor({ document, now: resolved.now() }),
    // The posts either side of one, for the links under an entry (TASK-79).
    // Two indexed lookups per post rather than a walk of the archive, and
    // asked per render for the reason the conversation is: a post published a
    // minute ago is already the neighbour of the one before it.
    neighbours: (document) => store.neighbours(document),
    // And the site's own posts and pages that link to it (TASK-322), asked per
    // render for the same reason: a post published a minute ago that cites
    // this one is already one of its backlinks, and so does one whose link
    // reaches it through a redirect declared a minute ago (TASK-330). A link
    // to `/` lands on the page the Reading setting puts there, which is the
    // page its slug names, as the routes resolve it.
    backlinks: (document) => {
      const { homepage } = frontPageSlugs(siteData.read());
      return store.listBacklinks(document, {
        redirects: redirects.current(),
        home:
          document.type === 'page' &&
          homepage !== '' &&
          store.getBySlug(homepage)?.path === document.path,
      });
    },
    newestPosts: (count) => store.listPosts({ limit: count }),
    // And every published post, for a page that says `archive: true`. The one
    // listing with no paging, so it is asked for only by the page that prints
    // it (TASK-85).
    archivePosts: () => store.listPosts(),
  });

  const federationKv = resolved.federation.kv ?? new MemoryKvStore();
  const federationQueue =
    resolved.federation.queue === undefined ? createSettlingQueue() : undefined;
  const federation = createSiteFederation({
    baseUrl: resolved.baseUrl,
    ...resolved.federation,
    ...(federationQueue === undefined ? {} : { queue: federationQueue }),
    kv: federationKv,
  });

  // The names and faces of the actors who are not followers (TASK-184),
  // fetched in the background when one is heard from and on a sweep.
  const actorProfiles = createActorProfileService({
    admin,
    config: resolved,
    load: signedProfileLoader(() => federationContext()),
  });

  const federated = { ...site, actorProfiles, cited };
  const federationContext = () => federation.createContext(new URL(resolved.baseUrl), federated);

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
    originalOf: (url) => replyContexts.read(url)?.original,
    conversation,
  });

  // The notify server listens to the index for the same reason: a post edited
  // on disk changed the same feeds as one saved through the editor.
  const notifier = createFeedNotifier({ config: resolved });

  // IndexNow listens for the same reason, and wants the pages as well as the
  // posts: a search engine indexes both (TASK-151).
  const indexNow = createIndexNowNotifier({ config: resolved });

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
  relays.sync();

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
      replyNotices.heard(written);
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
    maintenance: createMaintenanceSwitch({
      dataDir: resolved.dataDir,
      forced: resolved.maintenance,
      now: resolved.now,
    }),
    indieauth: createIndieAuthState(resolved.now),
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
