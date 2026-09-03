import { serve as serveNode } from '@hono/node-server';
import { Hono } from 'hono';

import {
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
import { createContentSync, openContentStore } from './content/index.ts';
import type { ContentEvents, ContentEventMap, ContentStore, SyncResult } from './content/index.ts';
import type { GeekityEnv } from './env.ts';
import {
  createDeliveryService,
  createSiteFederation,
  mountFederation,
} from './federation/index.ts';
import type { DeliveryService, SiteFederation } from './federation/index.ts';
import { createRenderer, mountPublicSite } from './web/index.ts';

export {
  ACTOR_HANDLE_PATTERN,
  ACTOR_KEY_ALGORITHMS,
  ACTOR_TYPES,
  DELIVERY_STATUSES,
  ADMIN_ASSET_MAX_AGE,
  ADMIN_ASSET_PREFIX,
  ADMIN_PREFIX,
  ADMIN_SECTIONS,
  ADMIN_STATIC_DIR,
  ADMIN_TEMPLATES,
  addUserProblems,
  adminAssetResponse,
  ARGON2_PARAMETERS,
  blankForm,
  CHANGE_PASSWORD_PATH,
  changePasswordProblems,
  clearSessionCookie,
  createAdminTemplateEnvironment,
  credentialProblem,
  CSRF_FIELD,
  csrfTokenMatches,
  DASHBOARD_RECENT_POSTS,
  DEFAULT_SITE_SETTINGS,
  DELETE_USER_PATH,
  deleteUserRefusal,
  DOCUMENT_FILTERS,
  documentFilter,
  DOCUMENTS_PER_PAGE,
  editorPath,
  effectiveBaseUrl,
  EXCLUDE_KEY,
  DuplicateUsernameError,
  findAdminAsset,
  findBySlug,
  formFor,
  formFromSettings,
  flash,
  GENERATED_PASSWORD_ALPHABET,
  GENERATED_PASSWORD_LENGTH,
  generatePassword,
  guard,
  hashPassword,
  LOGIN_PATH,
  LOGOUT_PATH,
  listingUrl,
  listOptionsFor,
  MAXIMUM_USERNAME_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  mountAdmin,
  mountDocumentScreens,
  mountPreview,
  mountSettings,
  mountUploads,
  mountUsers,
  newEditorPath,
  openAdminStore,
  PAGE_KIND,
  PACKAGED_ADMIN_DIR,
  passwordProblem,
  postEditorPath,
  POST_KIND,
  PREVIEW_PATH,
  QUICK_DRAFT_PATH,
  readSiteSettings,
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
  takeFlash,
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
  AddUserProblems,
  AdminRender,
  AdminSection,
  AdminStore,
  ChangePasswordProblems,
  CreateAdminTemplateEnvironmentOptions,
  CreateSessionInput,
  CreateUserInput,
  Delivery,
  DeliveryStatus,
  DocumentFilter,
  DocumentKind,
  DocumentRow,
  EditorForm,
  FlashKind,
  FlashMessage,
  Follower,
  InboxActivity,
  ListPageOptions,
  MountDocumentScreensOptions,
  MountSettingsOptions,
  MountUsersOptions,
  NewActorKey,
  NewDelivery,
  NewFollower,
  NewInboxActivity,
  NewOutboundActivity,
  OpenAdminStoreOptions,
  OutboundActivity,
  Session,
  SettingsForm,
  SettingsProblems,
  SiteSettings,
  StoredUser,
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
  contentFilePath,
  createContentSync,
  DATABASE_FILE,
  dateSortKey,
  DEFAULT_DEBOUNCE_MS,
  defaultPermalink,
  documentContent,
  documentFrontMatter,
  freeSlug,
  DuplicatePermalinkError,
  hashDocument,
  isTrashedPath,
  KNOWN_FRONT_MATTER_KEYS,
  KNOWN_UPLOAD_TYPES,
  matchesSignature,
  normalizeBody,
  normalizeUploadType,
  openContentStore,
  parseDocument,
  renderMarkdown,
  saveDocument,
  serializeDocument,
  slugify,
  TRASH_DIRECTORY,
  typeForPath,
  UPLOAD_MEDIA_TYPES,
} from './content/index.ts';
export type {
  ActivityPubMetadata,
  ChangeOrigin,
  ContentCounts,
  ContentFilePathInput,
  ContentEventListener,
  ContentEventMap,
  ContentEvents,
  ContentStore,
  ContentSync,
  CreateContentSyncOptions,
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
  SyncLogger,
  SyncResult,
  TagCount,
  UploadMediaType,
  UploadSignature,
} from './content/index.ts';

export type { GeekityEnv } from './env.ts';

export {
  ACTOR_CLASSES,
  ACTOR_PATH,
  actorClassFor,
  articleObjectId,
  AVATAR_SETTING,
  createActivityId,
  createDeliveryService,
  createSiteFederation,
  deleteActivityId,
  federatedObject,
  federatedPost,
  FEDERATION_PREFIX,
  federationOrigin,
  followerFrom,
  followerRecipient,
  FOLLOWERS_PAGE_SIZE,
  FOLLOWERS_PATH,
  followersPage,
  FOLLOWING_PATH,
  groupByInbox,
  handleDelete,
  handleFollow,
  handleLoggedActivity,
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
  CreateSiteFederationOptions,
  DeliveryLogger,
  DeliveryReport,
  DeliveryService,
  FederationContextData,
  SiteActorOptions,
  SiteFederation,
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
  contentEtag,
  createRenderer,
  createSiteDataSource,
  createTemplateEnvironment,
  DEFAULT_FEED_SIZE,
  DEFAULT_POSTS_PER_PAGE,
  DOCUMENT_REPRESENTATIONS,
  documentContext,
  documentJson,
  escapeXml,
  FEED_CONTENT_TYPES,
  FEED_FILES,
  FEED_GENERATOR,
  FEED_GENERATOR_URI,
  feedHref,
  feedResponse,
  feedSize,
  findAsset,
  findThemeAsset,
  findUpload,
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
  notAcceptableResponse,
  offsetForPage,
  PACKAGED_THEME_DIR,
  PAGE_SEGMENT,
  paginate,
  parseAccept,
  postsPerPage,
  prefersActivityStreams,
  publicDocumentAt,
  REPRESENTATION_EXTENSIONS,
  representationEtag,
  representationHref,
  representationResponse,
  selectRepresentation,
  SITE_DATA_FILE,
  splitRepresentationExtension,
  TAG_SEGMENT,
  tagHref,
  TEMPLATES,
  themeAssetNotModified,
  themeAssetResponse,
  THEME_ASSET_MAX_AGE,
  THEME_ASSET_PREFIX,
  THEME_STATIC_DIR,
  themeSearchPath,
  UPLOAD_ASSET_MAX_AGE,
  UPLOAD_ASSET_PREFIX,
  UPLOAD_DIRECTORY,
} from './web/index.ts';
export type {
  AcceptRange,
  AssetResponseOptions,
  ConditionalHeaders,
  CreateRendererOptions,
  CreateSiteDataSourceOptions,
  CreateTemplateEnvironmentOptions,
  DateFormat,
  DocumentContext,
  DocumentJson,
  DocumentJsonOptions,
  FeedFormat,
  FeedResponseOptions,
  FeedSource,
  JsonFeed,
  JsonFeedAuthor,
  JsonFeedItem,
  Listing,
  PageContext,
  PaginateOptions,
  Pagination,
  Renderer,
  Representation,
  RepresentationExtension,
  RepresentationResponseOptions,
  SiteData,
  SiteDataSource,
  SiteSettingsSource,
  StaticAsset,
  ThemeAsset,
} from './web/index.ts';

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
  const store = openContentStore({ dataDir: resolved.dataDir });
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
  });
  const app = new Hono<GeekityEnv>();

  app.use('*', async (c, next) => {
    c.set('store', store);
    c.set('admin', admin);
    c.set('config', resolved);
    c.set('renderer', renderer);
    c.set('announce', (change) => content.announce(change));
    await next();
  });

  app.get('/_geekity/health', (c) => c.json({ status: 'ok' }));

  // Federation goes on first. It answers its own paths and falls through on
  // every other, so putting it in front costs the rest of the app nothing and
  // is the only place it can go: the public site claims every unmatched path
  // in its not-found handler.
  const federation = createSiteFederation({ baseUrl: resolved.baseUrl, ...resolved.federation });
  mountFederation(app, federation);

  // Federation listens to the index rather than to the admin, so a post edited
  // on disk federates exactly as one saved through the editor does (doc-4).
  const delivery = createDeliveryService({ federation, admin, store, config: resolved });
  content.events.on('change', (change) => delivery.handle(change));

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
    events: content.events,

    onDocumentChange(hook) {
      return subscribe('change', hook);
    },

    onPublish(hook) {
      return subscribe('published', hook);
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

      return new Promise((resolve) => {
        server = serveNode({ fetch: app.fetch, port: resolved.port }, (info) => {
          resolve({ port: info.port });
        });
      });
    },

    async close() {
      const running = server;
      server = undefined;
      await content.stop();
      // Anything already on its way out is allowed to finish, so closing never
      // leaves a delivery half recorded.
      await delivery.settled();

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
