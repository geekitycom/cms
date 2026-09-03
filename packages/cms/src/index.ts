import { serve as serveNode } from '@hono/node-server';
import { Hono } from 'hono';

import { mountAdmin, openAdminStore } from './admin/index.ts';
import type { AdminStore } from './admin/index.ts';
import { resolveConfig } from './config.ts';
import type { DocumentChangeHook, GeekityConfig, ResolvedConfig } from './config.ts';
import { createContentSync, openContentStore } from './content/index.ts';
import type { ContentEvents, ContentEventMap, ContentStore, SyncResult } from './content/index.ts';
import type { GeekityEnv } from './env.ts';
import { createRenderer, mountPublicSite } from './web/index.ts';

export {
  ADMIN_ASSET_MAX_AGE,
  ADMIN_ASSET_PREFIX,
  ADMIN_PREFIX,
  ADMIN_SECTIONS,
  ADMIN_STATIC_DIR,
  ADMIN_TEMPLATES,
  adminAssetResponse,
  ARGON2_PARAMETERS,
  clearSessionCookie,
  createAdminTemplateEnvironment,
  credentialProblem,
  CSRF_FIELD,
  csrfTokenMatches,
  DASHBOARD_RECENT_POSTS,
  DuplicateUsernameError,
  findAdminAsset,
  flash,
  guard,
  hashPassword,
  LOGIN_PATH,
  LOGOUT_PATH,
  MAXIMUM_USERNAME_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  mountAdmin,
  openAdminStore,
  PACKAGED_ADMIN_DIR,
  passwordProblem,
  postEditorPath,
  QUICK_DRAFT_PATH,
  SESSION_COOKIE,
  SESSION_ID_BYTES,
  sessionIdFrom,
  setSessionCookie,
  SETUP_PATH,
  takeFlash,
  USERNAME_PATTERN,
  usernameProblem,
  usesSecureCookies,
  verifyPasswordHash,
} from './admin/index.ts';
export type {
  AdminSection,
  AdminStore,
  CreateAdminTemplateEnvironmentOptions,
  CreateSessionInput,
  CreateUserInput,
  FlashKind,
  FlashMessage,
  OpenAdminStoreOptions,
  Session,
  StoredUser,
  User,
} from './admin/index.ts';

export { defineConfig, resolveConfig } from './config.ts';
export type {
  DocumentChangeHook,
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
  documentFrontMatter,
  freeSlug,
  DuplicatePermalinkError,
  hashDocument,
  isTrashedPath,
  KNOWN_FRONT_MATTER_KEYS,
  normalizeBody,
  openContentStore,
  parseDocument,
  renderMarkdown,
  saveDocument,
  serializeDocument,
  slugify,
  TRASH_DIRECTORY,
  typeForPath,
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
} from './content/index.ts';

export type { GeekityEnv } from './env.ts';

export {
  absoluteUrl,
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
} from './web/index.ts';
export type {
  AcceptRange,
  AssetResponseOptions,
  ConditionalHeaders,
  CreateRendererOptions,
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
   * `change.origin === 'watch'`.
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
  const content = createContentSync({
    store,
    contentDir: resolved.contentDir,
    watch: resolved.watch,
  });
  const renderer = createRenderer({ config: resolved });
  const app = new Hono<GeekityEnv>();

  app.use('*', async (c, next) => {
    c.set('store', store);
    c.set('admin', admin);
    c.set('config', resolved);
    c.set('renderer', renderer);
    await next();
  });

  app.get('/_geekity/health', (c) => c.json({ status: 'ok' }));

  // The admin goes on before the public site, because the public site claims
  // every unmatched path in its not-found handler.
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
