import { serve as serveNode } from '@hono/node-server';
import { Hono } from 'hono';

import {
  baselineSecurityHeaders,
  effectiveBaseUrl,
  mountAdmin,
  openAdminStore,
  readSiteSettings,
  seedSiteSettings,
  settingsSiteData,
} from './admin/index.ts';
import type { AdminStore } from './admin/index.ts';
import { resolveConfig } from './config.ts';
import type { DocumentChangeHook, GeekityConfig, ResolvedConfig } from './config.ts';
import { createContentSync, createScheduler, openContentStore } from './content/index.ts';
import type {
  ContentEvents,
  ContentEventMap,
  ContentStore,
  Scheduler,
  SyncResult,
} from './content/index.ts';
import type { GeekityEnv } from './env.ts';
import {
  createDeliveryService,
  createRelayService,
  createSiteFederation,
  mountFederation,
} from './federation/index.ts';
import type { DeliveryService, RelayService, SiteFederation } from './federation/index.ts';
import { createFeedNotifier } from './notify.ts';
import type { FeedNotifier, NotifyReport } from './notify.ts';
import { createRenderer, mountPublicSite } from './web/index.ts';

export { createFeedNotifier, NOTIFY_TIMEOUT_MS } from './notify.ts';
export type {
  CreateFeedNotifierOptions,
  FeedNotifier,
  NotifyLogger,
  NotifyPing,
  NotifyReport,
} from './notify.ts';

export {
  ACTOR_HANDLE_PATTERN,
  LANGUAGE_TAG_PATTERN,
  ACTOR_KEY_ALGORITHMS,
  ACTOR_TYPES,
  DELIVERY_STATUSES,
  RELAY_STATES,
  ADMIN_ASSET_MAX_AGE,
  ADMIN_ASSET_PREFIX,
  ADMIN_PREFIX,
  ADMIN_SECTIONS,
  ADMIN_STATIC_DIR,
  ADMIN_TEMPLATES,
  actorSummary,
  addUserProblems,
  adminAssetResponse,
  adminContentSecurityPolicy,
  adminSecurityHeaders,
  ARGON2_PARAMETERS,
  AVATAR_FIELDS,
  AVATAR_PATH,
  AVATAR_REMOVE,
  baselineSecurityHeaders,
  blankForm,
  CHANGE_PASSWORD_PATH,
  changePasswordProblems,
  clearSessionCookie,
  createAdminTemplateEnvironment,
  createLoginThrottle,
  createNonce,
  credentialProblem,
  clientAddress,
  CSRF_FIELD,
  csrfTokenMatches,
  DASHBOARD_RECENT_POSTS,
  describeWait,
  DEFAULT_SITE_SETTINGS,
  DELETE_USER_PATH,
  deleteUserRefusal,
  deliveryRows,
  DOCUMENT_FILTERS,
  documentFilter,
  DOCUMENTS_PER_PAGE,
  editorPath,
  effectiveBaseUrl,
  EXCLUDE_KEY,
  DuplicateUsernameError,
  FEDERATION_FIELDS,
  FEDERATION_PATH,
  FEDERATION_RECENT,
  findAdminAsset,
  findBySlug,
  followerRow,
  formatInTimezone,
  formFor,
  applyTermChange,
  CATEGORY_KIND,
  deletePath,
  formFromSettings,
  flash,
  GENERATED_PASSWORD_ALPHABET,
  GENERATED_PASSWORD_LENGTH,
  generatePassword,
  guard,
  hashPassword,
  HSTS_MAX_AGE,
  HSTS_VALUE,
  INBOX_INTERACTIONS,
  inboxRows,
  LOCKOUT_GROWTH_LIMIT,
  LOGIN_PATH,
  LOGOUT_PATH,
  listingUrl,
  listOptionsFor,
  localPosts,
  loginKeys,
  MAXIMUM_USERNAME_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  mountAdmin,
  mountDocumentScreens,
  mountFederationScreen,
  mountPreview,
  mountSettings,
  mountTaxonomyScreens,
  mountUploads,
  mountUsers,
  newEditorPath,
  NONCE_BYTES,
  openAdminStore,
  PAGE_KIND,
  PACKAGED_ADMIN_DIR,
  passwordProblem,
  postEditorPath,
  POST_KIND,
  PREVIEW_PATH,
  profileChanged,
  readSiteSettings,
  REDELIVER_PATH,
  redeliveryMessage,
  RELAY_RETRY_PATH,
  RELAY_STATE_LABELS,
  relayList,
  relayRow,
  renamePath,
  renameProblem,
  rewriteTerm,
  MEDIA_DELETE_PATH,
  MEDIA_FIELDS,
  MEDIA_PATH,
  MEDIA_PER_PAGE,
  MEDIA_SECTION,
  MEDIA_UPLOAD_PATH,
  mediaPageUrl,
  mentionsUpload,
  mountMediaScreen,
  deleteUpload,
  describeUpload,
  listUploads,
  referencesTo,
  resolveUpload,
  uploadMarkdown,
  normalizeRelayInbox,
  refusedUpload,
  refuseOversizedUpload,
  returnPath,
  seedSiteSettings,
  SESSION_COOKIE,
  SESSION_ID_BYTES,
  sessionIdFrom,
  setSessionCookie,
  SETTINGS_FIELDS,
  SETTINGS_PATH,
  settingsFromForm,
  settingsProblems,
  settingsSiteData,
  SETUP_PATH,
  siteDataPath,
  siteJsonFor,
  splitTags,
  storeSiteSettings,
  storeUpload,
  TAG_KIND,
  takeFlash,
  TAXONOMY_FIELDS,
  TAXONOMY_KINDS,
  tooLargeMessage,
  UPLOAD_ENVELOPE_BYTES,
  UPLOAD_FIELD,
  UPLOADS_PATH,
  USER_FIELDS,
  USERNAME_PATTERN,
  usernameProblem,
  USERS_PATH,
  usesSecureCookies,
  verifyPasswordHash,
  writeSiteJson,
  writeSiteSettings,
} from './admin/index.ts';
export type {
  ActorKey,
  ActorKeyAlgorithm,
  ActorSummary,
  AddUserProblems,
  AdminRender,
  AdminSection,
  ChangePasswordProblems,
  CreateAdminTemplateEnvironmentOptions,
  CreateSessionInput,
  CreateUserInput,
  Delivery,
  DeliveryRow,
  DeliveryRowsContext,
  DeliveryStatus,
  DocumentFilter,
  DocumentKind,
  DocumentRow,
  EditorForm,
  FlashKind,
  FlashMessage,
  Follower,
  FollowerRow,
  InboxActivity,
  InboxRow,
  InboxRowsContext,
  ListPageOptions,
  LocalPost,
  LoginThrottle,
  LoginThrottleOptions,
  MediaFile,
  MediaReference,
  DeleteUploadOptions,
  RemoveDerived,
  MountDocumentScreensOptions,
  MountFederationScreenOptions,
  MountMediaScreenOptions,
  RelayRow,
  MountSettingsOptions,
  MountTaxonomyScreensOptions,
  MountUsersOptions,
  NewActorKey,
  NewDelivery,
  NewFollower,
  NewInboxActivity,
  NewOutboundActivity,
  NewRelay,
  OpenAdminStoreOptions,
  OutboundActivity,
  Relay,
  RelayState,
  Session,
  SettingsField,
  SettingsForm,
  SettingsProblems,
  SiteSettings,
  StoredUpload,
  StoredUser,
  TaxonomyKind,
  TermRewriteReport,
  TermRow,
  StoreUploadOptions,
  UploadConfig,
  UploadMarkdownOptions,
  UploadRefusal,
  UploadResult,
  User,
} from './admin/index.ts';

export {
  DEFAULT_UPLOAD_MAX_BYTES,
  DEFAULT_UPLOAD_TYPES,
  defineConfig,
  resolveConfig,
} from './config.ts';
export type {
  DocumentChangeHook,
  FederationOverrides,
  GeekityConfig,
  ResolvedConfig,
  ResolveConfigContext,
} from './config.ts';

export { DirectoryNotEmptyError, initSite, SITE_TEMPLATE_DIR, siteManifest } from './init.ts';
export type { InitSiteOptions, InitSiteResult } from './init.ts';

export {
  calendarDayIn,
  contentFilePath,
  createContentSync,
  createScheduler,
  DATABASE_FILE,
  dateSortKey,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_TIMEZONE,
  defaultPermalink,
  documentContent,
  documentFrontMatter,
  freeSlug,
  DuplicatePermalinkError,
  hashDocument,
  isScheduled,
  isTrashedPath,
  KNOWN_FRONT_MATTER_KEYS,
  KNOWN_UPLOAD_TYPES,
  matchesSignature,
  MAXIMUM_DELAY_MS,
  normalizeBody,
  normalizeUploadType,
  openContentStore,
  parseDocument,
  renderMarkdown,
  saveDocument,
  SCHEDULE_ORIGIN,
  scheduledFor,
  serializeDocument,
  slugify,
  systemClock,
  systemTimers,
  toUtcInstant,
  TRASH_DIRECTORY,
  typeForPath,
  UPLOAD_MEDIA_TYPES,
  wallClockIn,
  zoneLabel,
} from './content/index.ts';
export type {
  ActivityPubMetadata,
  CategoryCount,
  ChangeOrigin,
  Clock,
  ContentCounts,
  ContentFilePathInput,
  ContentEventListener,
  ContentEventMap,
  ContentEvents,
  ContentStore,
  ContentSync,
  CreateContentSyncOptions,
  CreateSchedulerOptions,
  DefaultPermalinkInput,
  Document,
  DocumentChange,
  DocumentChangeType,
  DocumentContent,
  DocumentType,
  FreeSlugOptions,
  ListAllOptions,
  ListByTagOptions,
  ListOptions,
  OpenContentStoreOptions,
  ParseDocumentOptions,
  SaveDocumentOptions,
  ScheduleLogger,
  Scheduler,
  ScheduleTimers,
  ScheduleWatermark,
  SyncLogger,
  SyncResult,
  TagCount,
  UploadMediaType,
  UploadSignature,
} from './content/index.ts';

export type { GeekityEnv } from './env.ts';

export {
  acceptedRelays,
  acceptRelay,
  ACTOR_CLASSES,
  ACTOR_PATH,
  actorClassFor,
  articleObjectId,
  avatarUrl,
  createActivityId,
  createDeliveryService,
  createRelayService,
  createSiteFederation,
  deleteActivityId,
  deliveryTargets,
  federatedObject,
  federatedPost,
  FEDERATION_PREFIX,
  federationOrigin,
  followerFrom,
  followerRecipient,
  FOLLOWERS_PAGE_SIZE,
  FOLLOWERS_PATH,
  actorHandle,
  followersPage,
  FOLLOWING_PATH,
  groupByInbox,
  handleAccept,
  handleDelete,
  handleFollow,
  handleLoggedActivity,
  handleReject,
  handleUndo,
  INBOX_PATH,
  isFederatedDocument,
  lastFollowersCursor,
  loadActorKeyPairs,
  logActivity,
  mountFederation,
  NODEINFO_PATH,
  OUTBOX_PAGE_SIZE,
  OUTBOX_PATH,
  POST_OBJECT_PATH,
  postArticle,
  postCreateActivity,
  postDeleteActivity,
  postObjectId,
  postObjectPath,
  postUpdateActivity,
  rejectRelay,
  relayAnswering,
  relayRecipient,
  REPLY_ACTIVITY_TYPE,
  replyFrom,
  replyTargetOf,
  SHARED_INBOX_PATH,
  SITE_ACTOR_IDENTIFIER,
  siteActor,
  SOFTWARE_NAME,
  SOURCE_MEDIA_TYPE,
  toInstant,
  updateActivityId,
} from './federation/index.ts';
export type {
  CreateDeliveryServiceOptions,
  CreateRelayServiceOptions,
  CreateSiteFederationOptions,
  DeliveryLogger,
  DeliveryReport,
  DeliveryService,
  DeliveryTarget,
  FederationContextData,
  RelayLogger,
  RelayService,
  RelaySyncReport,
  SiteActorOptions,
  SiteFederation,
  Reply,
  SiteInboxContext,
} from './federation/index.ts';

export {
  absoluteUrl,
  ACTIVITY_STREAMS_MEDIA_TYPES,
  activityStreamsId,
  alternateLinks,
  assetNotModified,
  assetResponse,
  atomFeed,
  categoryHref,
  commentCounts,
  commentsFeedHref,
  commentsFeedPath,
  commentsFeedResponse,
  commentsRssFeed,
  COMMENTS_ROOT,
  COMMENTS_TITLE_PREFIX,
  contentEtag,
  createRenderer,
  createSiteDataSource,
  createTemplateEnvironment,
  DEFAULT_FEED_SIZE,
  DEFAULT_TAXONOMY_BASES,
  DEFAULT_POSTS_PER_PAGE,
  DOCUMENT_REPRESENTATIONS,
  documentContext,
  cdata,
  contentTypeOf,
  DC_NAMESPACE,
  DEFAULT_FEED_LANGUAGE,
  DEFAULT_NOTIFY_SERVER,
  documentJson,
  escapeXml,
  excerptFromHtml,
  EXCERPT_WORDS,
  FEED_ALIASES,
  FEED_CONTENT_TYPES,
  FEED_FORMATS,
  FEED_GENERATOR,
  FEED_GENERATOR_URI,
  FEED_SEGMENT,
  FEED_SEGMENTS,
  feedExcerpt,
  feedHref,
  feedLanguage,
  feedLinkHeader,
  feedPathUnder,
  feedResponse,
  feedSize,
  findAsset,
  findThemeAsset,
  findUpload,
  forgetTerm,
  formatDate,
  homeHref,
  isNotModified,
  isPublicDocument,
  JSON_FEED_VERSION,
  JSON_SCHEMA_VERSION,
  jsonFeed,
  lastModifiedOf,
  latestModified,
  LISTING_REPRESENTATIONS,
  matchesEtag,
  MEDIA_TYPES,
  mountPublicSite,
  navigationItems,
  navigationItemsOf,
  navigationMenu,
  navigationOrder,
  navigationPages,
  NAVIGATION_KEY,
  NAVIGATION_ORDER_KEY,
  notAcceptableResponse,
  NOTIFY_CLOUD_PORT,
  NOTIFY_CLOUD_PROTOCOL,
  NOTIFY_PATHS,
  notifyEndpoints,
  notifyServerOf,
  offsetForPage,
  PACKAGED_THEME_DIR,
  PAGE_SEGMENT,
  paginate,
  parseAccept,
  postComments,
  postsPerPage,
  prefersActivityStreams,
  publicDocumentAt,
  recordTermRename,
  redirectedTerm,
  REPRESENTATION_EXTENSIONS,
  representationEtag,
  representationHref,
  representationResponse,
  RESERVED_TOP_LEVEL_PATHS,
  rfc822,
  robotsResponse,
  robotsTxt,
  ROBOTS_CONTENT_TYPE,
  ROBOTS_PATH,
  rssFeed,
  sanitizeCommentHtml,
  selectRepresentation,
  siteComments,
  SITE_DATA_FILE,
  sitemapChildPath,
  sitemapDate,
  sitemapIndexXml,
  sitemapResponse,
  sitemapXml,
  SITEMAP_CHILD_ROUTE,
  SITEMAP_CONTENT_TYPE,
  SITEMAP_MAX_URLS,
  SITEMAP_NAMESPACE,
  SITEMAP_PATH,
  SOURCE_NAMESPACE,
  splitFeedPath,
  splitRepresentationExtension,
  tagHref,
  TAXONOMIES,
  TAXONOMY_BASE_PATTERN,
  TAXONOMY_LABELS,
  taxonomyBaseProblems,
  taxonomyBases,
  taxonomyBasesOrDefault,
  taxonomyForSegment,
  taxonomyRedirectsOf,
  TEMPLATES,
  termHref,
  termRedirects,
  themeAssetNotModified,
  themeAssetResponse,
  THEME_ASSET_MAX_AGE,
  THEME_ASSET_PREFIX,
  THEME_STATIC_DIR,
  themeSearchPath,
  UPLOAD_ASSET_MAX_AGE,
  UPLOAD_ASSET_PREFIX,
  UPLOAD_DIRECTORY,
  WFW_NAMESPACE,
} from './web/index.ts';
export type {
  AcceptRange,
  AssetResponseOptions,
  ConditionalHeaders,
  CreateRendererOptions,
  CreateSiteDataSourceOptions,
  Comment,
  CommentContext,
  CommentFeedSource,
  CreateTemplateEnvironmentOptions,
  DateFormat,
  DocumentContext,
  DocumentJson,
  DocumentJsonOptions,
  FeedComment,
  FeedFormat,
  FeedIdentity,
  FeedPath,
  FeedResponseOptions,
  FeedSource,
  JsonFeed,
  JsonFeedAuthor,
  JsonFeedHub,
  JsonFeedItem,
  NotifyServer,
  Listing,
  MenuItem,
  NavigationItem,
  NavigationMenuOptions,
  PageContext,
  PaginateOptions,
  Pagination,
  Renderer,
  Representation,
  RepresentationExtension,
  RepresentationResponseOptions,
  SiteData,
  SiteDataSource,
  SitemapResponseOptions,
  SitemapUrl,
  SiteSettingsSource,
  StaticAsset,
  Taxonomy,
  TaxonomyBaseProblems,
  TaxonomyBases,
  TaxonomyRedirect,
  TaxonomyTerm,
  ThemeAsset,
} from './web/index.ts';

/**
 * Where the scheduler's watermark lives in {@link AdminStore.getState}: the
 * instant up to which scheduled documents have been announced.
 */
export const SCHEDULE_WATERMARK_KEY = 'schedule.watermark';

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
   * Users and sessions, in the same database file as the index. This is the
   * half of it that is not derived from the content directory, so it is the
   * half a site has to back up.
   */
  readonly admin: AdminStore;
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
   * a recorded activity again.
   *
   * It is already subscribed to the index; a site only reaches for it to
   * redeliver, or to wait for the deliveries in flight.
   */
  readonly delivery: DeliveryService;
  /**
   * The site's relay subscriptions (FEP-ae0c): what follows a relay when one
   * is added to the settings, what an `Accept` marks accepted, and what every
   * public activity is delivered to alongside the followers.
   */
  readonly relays: RelayService;
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
   * Stop watching, stop listening and close the index. Safe to call when not
   * listening, and safe to call twice.
   */
  close(): Promise<void>;
}

/**
 * Build a CMS around a site's config.
 *
 * The returned app is a plain Hono app: the public site, the admin UI and the
 * federation endpoints are all mounted on it as later milestones land. Booting
 * opens the SQLite index under `dataDir` (creating the directory) and applies
 * any migrations, so `close()` has to be called to release it.
 */
export function createCms(config: GeekityConfig = {}): Cms {
  const resolved = resolveConfig(config);
  const store = openContentStore({ dataDir: resolved.dataDir, now: resolved.now });
  const admin = openAdminStore({ dataDir: resolved.dataDir });

  // An empty settings table is filled from content/_data/site.json, so a site
  // that predates the settings screen — or one `geekity init` just wrote —
  // comes up with the values it already had. After this, SQLite is the source
  // and the file is the mirror.
  const seeded = seedSiteSettings({ store: admin, config: resolved });

  // The one thing the settings decide before a request arrives. It is settled
  // here, at boot, rather than on every save: `baseUrl` also decides whether
  // the session cookie is `Secure`, and flipping that under a signed-in admin
  // would log them out of the form they just submitted.
  resolved.baseUrl = effectiveBaseUrl(resolved, seeded);

  const content = createContentSync({
    store,
    contentDir: resolved.contentDir,
    watch: resolved.watch,
  });
  const renderer = createRenderer({
    config: resolved,
    settings: { read: () => settingsSiteData(readSiteSettings(admin)) },
    // The pages that put themselves in the site menu are found by asking for
    // every public page and reading their front matter, rather than by an
    // index of their own: a site has a handful of pages, the query is the
    // same one the listing index already serves, and doing it per render is
    // what makes a page flagged in the editor appear in the menu at once.
    pages: () => store.listAll({ type: 'page', draft: false, trashed: false, scheduled: false }),
  });
  const federation = createSiteFederation({ baseUrl: resolved.baseUrl, ...resolved.federation });

  // Federation listens to the index rather than to the admin, so a post edited
  // on disk federates exactly as one saved through the editor does (doc-4).
  // It is built before the app because a handler reads it off the context: the
  // admin's Redeliver button is a request that sends an activity again.
  const delivery = createDeliveryService({ federation, admin, store, config: resolved });
  content.events.on('change', (change) => delivery.handle(change));

  // The notify server listens to the index for the same reason: a post edited
  // on disk changed the same feeds as one saved through the editor.
  const notifier = createFeedNotifier({ admin, config: resolved });
  content.events.on('change', (change) => notifier.handle(change));

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
    },
  });
  content.events.on('change', (change) => {
    scheduler.handle(change);
  });

  // Relay subscriptions (FEP-ae0c). The list is a setting and the handshake is
  // a record, so booting reconciles the two: a relay the file names and the
  // database has never heard of is followed here, which is what makes a
  // rebuilt database catch up rather than silently stop federating to it.
  const relays = createRelayService({ federation, admin, store, config: resolved });
  relays.sync();

  const app = new Hono<GeekityEnv>();

  app.use('*', async (c, next) => {
    c.set('store', store);
    c.set('admin', admin);
    c.set('config', resolved);
    c.set('renderer', renderer);
    c.set('announce', (change) => content.announce(change));
    c.set('delivery', delivery);
    c.set('relays', relays);
    await next();
  });

  // Two headers on everything the CMS answers, admin and public alike. The
  // admin adds a policy of its own on top; the public site does not, so a
  // theme is free to reference whatever it likes.
  app.use('*', baselineSecurityHeaders);

  app.get('/_geekity/health', (c) => c.json({ status: 'ok' }));

  // Federation goes on first. It answers its own paths and falls through on
  // every other, so putting it in front costs the rest of the app nothing and
  // is the only place it can go: the public site claims every unmatched path
  // in its not-found handler.
  mountFederation(app, federation);

  // The admin goes on before the public site, for the same reason.
  mountAdmin(app);
  mountPublicSite(app);

  /**
   * Subscribe a site's hook to one event.
   *
   * The emitter already contains a hook that throws; this also contains one
   * that rejects, so an `async` hook whose delivery fails is reported rather
   * than surfacing as an unhandled rejection that would take the process down.
   */
  function subscribe(event: keyof ContentEventMap, hook: DocumentChangeHook): () => void {
    return content.events.on(event, (change) => {
      // A hook's return is ignored, but an `async` one hands back a promise
      // whose unhandled rejection would take the whole process down.
      const result = hook(change);
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`A ${event} hook rejected: ${message}`);
        });
      }
    });
  }

  if (resolved.onDocumentChange !== undefined) subscribe('change', resolved.onDocumentChange);
  if (resolved.onPublish !== undefined) subscribe('published', resolved.onPublish);

  let server: { close(cb: (err?: Error) => void): void } | undefined;

  return {
    app,
    config: resolved,
    store,
    admin,
    federation,
    delivery,
    relays,
    notifier,
    scheduler,
    events: content.events,

    onDocumentChange(hook) {
      return subscribe('change', hook);
    },

    onPublish(hook) {
      return subscribe('published', hook);
    },

    notifyFeeds(urls) {
      return notifier.notify(urls);
    },

    sync() {
      return content.sync();
    },

    async serve() {
      if (server !== undefined) {
        throw new Error('This CMS is already serving; call close() before serving again.');
      }

      // The index is brought up to date before the first request, so a site
      // never serves a stale document, and the watcher takes over from there.
      await content.start();

      // After the scan, because the catch-up reads the index: a post whose
      // date passed while nothing was running is published here, once.
      await scheduler.start();

      return new Promise((resolve) => {
        server = serveNode({ fetch: app.fetch, port: resolved.port }, (info) => {
          resolve({ port: info.port });
        });
      });
    },

    async close() {
      const running = server;
      server = undefined;
      scheduler.stop();
      await content.stop();
      await scheduler.settled();
      // Anything already on its way out is allowed to finish, so closing never
      // leaves a delivery half recorded.
      await delivery.settled();
      await relays.settled();
      await notifier.settled();

      if (running !== undefined) {
        await new Promise<void>((resolve, reject) => {
          running.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      admin.close();
      store.close();
    },
  };
}
