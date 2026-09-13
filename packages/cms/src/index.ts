import { MemoryKvStore } from '@fedify/fedify';
import { serve as serveNode } from '@hono/node-server';
import { Hono } from 'hono';

import {
  baselineSecurityHeaders,
  effectiveBaseUrl,
  listUsers,
  migrateSettingsToFile,
  migrateUsersToFile,
  mountAdmin,
  openAdminStore,
  readSiteSettings,
} from './admin/index.ts';
import type { AdminStore } from './admin/index.ts';
import { withRebuiltDatabase } from './cache.ts';
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
import { createMailService } from './mail/index.ts';
import type { MailService } from './mail/index.ts';
import { createCommentDigest, createCommentNotifier } from './notifications/index.ts';
import type { CommentDigest, CommentNotifier } from './notifications/index.ts';
import {
  assertActorKeysUsable,
  createDeliveryService,
  createRelayService,
  createSiteFederation,
  createWordPressFederation,
  migrateActorKeysToFiles,
  migrateFederationToFiles,
  mountFederation,
  rebuildFederationIndexes,
} from './federation/index.ts';
import type { DeliveryService, RelayService, SiteFederation } from './federation/index.ts';
import { createFeedNotifier } from './notify.ts';
import type { FeedNotifier, NotifyReport } from './notify.ts';
import { commentFormFor, createAkismetChecker, rebuildCommentIndexes } from './comments/index.ts';
import { contactFormFor } from './contact/index.ts';
import {
  createConversation,
  createRenderer,
  createSiteDataSource,
  createThemeSource,
  mountPublicSite,
  recentPosts,
  themeName,
} from './web/index.ts';
import { createWebmentionService } from './webmention/index.ts';
import type { WebmentionService } from './webmention/index.ts';

export { createFeedNotifier, NOTIFY_TIMEOUT_MS } from './notify.ts';
export type {
  CreateFeedNotifierOptions,
  FeedNotifier,
  NotifyLogger,
  NotifyPing,
  NotifyReport,
} from './notify.ts';

export {
  LANGUAGE_TAG_PATTERN,
  COMMENT_ACTIONS,
  COMMENT_ADMIN_FIELDS,
  COMMENT_KINDS,
  COMMENT_SOURCES,
  COMMENT_STATUSES,
  COMMENT_TABS,
  COMMENTS_MODERATE_PATH,
  COMMENTS_PATH,
  COMMENTS_PER_PAGE,
  COMMENTS_REPLY_PATH,
  COMMENTS_SECTION,
  commentListUrl,
  mountCommentsScreen,
  pendingComments,
  MESSAGE_FIELDS,
  MESSAGE_TABS,
  MESSAGES_DELETE_PATH,
  MESSAGES_PATH,
  MESSAGES_PER_PAGE,
  MESSAGES_READ_PATH,
  MESSAGES_SECTION,
  messageListUrl,
  mountMessagesScreen,
  unreadMessages,
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
  akismetPanel,
  AKISMET_FIELDS,
  AKISMET_PATH,
  AKISMET_REMOVE,
  EMAIL_PATTERN,
  MAIL_FIELDS,
  MAIL_PATH,
  MAIL_REMOVE,
  MAIL_TEST_FIELDS,
  MAIL_TEST_PATH,
  MAIL_TEST_TEMPLATE,
  mailPanel,
  ARGON2_PARAMETERS,
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
  countUsers,
  createUser,
  CSRF_FIELD,
  csrfTokenMatches,
  DASHBOARD_RECENT_POSTS,
  describeWait,
  DEFAULT_SITE_SETTINGS,
  DELETE_USER_PATH,
  deleteUser,
  deleteUserRefusal,
  deliveryRows,
  DOCUMENT_FILTERS,
  documentFilter,
  DOCUMENTS_PER_PAGE,
  editorPath,
  effectiveBaseUrl,
  EXCLUDE_KEY,
  DuplicateUsernameError,
  emailProblem,
  FEDERATION_FIELDS,
  FEDERATION_PATH,
  FEDERATION_RECENT,
  findAdminAsset,
  findBySlug,
  findUser,
  findUserById,
  findUserByIdentifier,
  followerRow,
  FORGOT_PATH,
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
  listUsers,
  localPosts,
  loginKeys,
  MAXIMUM_USERNAME_LENGTH,
  migrateSettingsToFile,
  migrateUsersToFile,
  MINIMUM_PASSWORD_LENGTH,
  mountAdmin,
  mountDocumentScreens,
  mountFederationScreen,
  mountPreview,
  mountRecovery,
  mountSettings,
  mountTaxonomyScreens,
  mountUploads,
  mountUsers,
  newEditorPath,
  newPasswordProblem,
  NONCE_BYTES,
  openAdminStore,
  PAGE_KIND,
  PACKAGED_ADMIN_DIR,
  PASSWORD_CHANGED_TEMPLATE,
  passwordProblem,
  postEditorPath,
  POST_KIND,
  primaryUser,
  PREVIEW_PATH,
  readSiteSettings,
  RECOVERY_ANSWER,
  RECOVERY_FIELDS,
  RELAY_RETRY_PATH,
  RELAY_STATE_LABELS,
  relayList,
  relayRow,
  renamePath,
  renameProblem,
  RESEND_PATH,
  resendMessage,
  RESET_PATH,
  RESET_TEMPLATE,
  RESET_TOKEN_LIFETIME_SECONDS,
  resetLink,
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
  SESSION_COOKIE,
  SESSION_ID_BYTES,
  sessionIdFrom,
  setSessionCookie,
  SETTINGS_FIELDS,
  SETTINGS_PATH,
  settingsFromForm,
  settingsFromSiteJson,
  settingsProblems,
  SETUP_PATH,
  siteDataPath,
  siteJsonFor,
  splitTags,
  storeUpload,
  TAG_KIND,
  takeFlash,
  TAXONOMY_FIELDS,
  TAXONOMY_KINDS,
  tooLargeMessage,
  updateSiteSettings,
  UPLOAD_ENVELOPE_BYTES,
  UPLOAD_FIELD,
  UPLOADS_PATH,
  setUserEmail,
  setUserPassword,
  setUserProfile,
  setUserWordPressActor,
  ConflictingActorIdError,
  UnknownUserError,
  USER_EMAIL_PATH,
  USER_FIELDS,
  USERNAME_PATTERN,
  usernameProblem,
  USERS_FILE,
  USERS_FILE_MODE,
  usersFile,
  USERS_PATH,
  usesSecureCookies,
  verifyPasswordHash,
  verifyUserPassword,
  writeSiteJson,
} from './admin/index.ts';
export type {
  ActorSummary,
  AddUserProblems,
  AdminRender,
  AdminSection,
  CommentAction,
  CommentAuthor,
  CommentContent,
  CommentKind,
  CommentRecord,
  CommentRow,
  CommentSource,
  CommentStatus,
  CreatePasswordResetInput,
  ListCommentsOptions,
  MountCommentsScreenOptions,
  MessageRow,
  MountMessagesScreenOptions,
  PostComment,
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
  IssuedPasswordReset,
  LegacyActorKey,
  LegacySetting,
  LegacyUser,
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
  MountRecoveryOptions,
  MountSettingsOptions,
  MountTaxonomyScreensOptions,
  MountUsersOptions,
  NewDelivery,
  NewFollower,
  NewInboxActivity,
  NewRelay,
  OpenAdminStoreOptions,
  PasswordReset,
  Relay,
  RelayState,
  Session,
  SettingsField,
  SettingsForm,
  SettingsProblems,
  SiteSettings,
  ProfileLink,
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
  UserProfile,
} from './admin/index.ts';

// The database as a file a site may act on: where it is, how to throw it away,
// and the two refusals a boot can raise over one. The migration machinery
// behind them stays inside the package, because a site has no business running
// somebody else's ledger.
export {
  databaseFile,
  databaseFiles,
  DATABASE_SUFFIXES,
  discardDatabase,
  OutdatedDatabaseError,
  UnusableDatabaseError,
} from './cache.ts';

export {
  DEFAULT_IMAGE_FORMATS,
  DEFAULT_IMAGE_WIDTHS,
  DEFAULT_UPLOAD_MAX_BYTES,
  DEFAULT_UPLOAD_TYPES,
  defineConfig,
  KNOWN_IMAGE_FORMATS,
  resolveConfig,
} from './config.ts';
export type {
  DocumentChangeHook,
  FederationOverrides,
  GeekityConfig,
  MailOverrides,
  ResolvedConfig,
  ResolveConfigContext,
} from './config.ts';

// Native comments: the files they live in, the restricted Markdown they are
// rendered with, the rules that decide whether a post is still taking them, the
// one seam a spam checker plugs into, and the Akismet checker that plugs into
// it when the site has a key.
export {
  addComment,
  AKISMET_ENDPOINT,
  AKISMET_KEY_FILE,
  AKISMET_TIMEOUT_MS,
  AKISMET_USER_AGENT,
  akismetKeyPath,
  blankValues,
  COMMENT_FIELDS,
  COMMENT_NOTICE_PARAM,
  COMMENT_NOTICES,
  COMMENT_POST_PATH,
  COMMENT_RATE_LIMIT,
  COMMENT_RATE_WINDOW_SECONDS,
  COMMENT_REPLY_PARAM,
  COMMENT_SALT_FILE,
  COMMENTS_DATA_DIRECTORY,
  COMMENTS_FRONT_MATTER_KEY,
  commentForm,
  commentFormFor,
  commentKeys,
  commentNoticeFor,
  commentPolicyOf,
  commentProblems,
  commentsDirectory,
  commentsFile,
  commentsOpen,
  createAkismetChecker,
  DEFAULT_COMMENTS_CLOSE_AFTER_DAYS,
  deleteComment,
  hashClientAddress,
  heldWebmention,
  intakeComment,
  isModerationAction,
  MAXIMUM_BODY_LENGTH,
  MAXIMUM_FORM_AGE_SECONDS,
  MAXIMUM_NAME_LENGTH,
  MAXIMUM_URL_LENGTH,
  MINIMUM_SUBMIT_SECONDS,
  moderateComment,
  MODERATION_ACTIONS,
  mountComments,
  normalizeWebsite,
  readAkismetKey,
  readComments,
  rebuildCommentIndexes,
  refilledCommentForm,
  removeAkismetKey,
  renderCommentMarkdown,
  submitComment,
  updateComment,
  valuesOf,
  verifyAkismetKey,
  writeAkismetKey,
} from './comments/index.ts';
export type {
  AkismetCheckerOptions,
  AkismetKeyRecord,
  AkismetKeyStatus,
  CommentChecker,
  CommentForm,
  CommentFormContext,
  CommentIndexReport,
  CommentIntakeOutcome,
  CommentNotices,
  CommentOrigin,
  CommentOutcome,
  CommentPolicy,
  CommentProblems,
  CommentRecords,
  CommentRefusal,
  CommentReport,
  CommentSubmission,
  CommentThrottle,
  CommentVerdict,
  IntakeCommentOptions,
  ModerateCommentOptions,
  ModerationAction,
  ModerationOutcome,
  NewComment,
  ProposedComment,
  SubmissionType,
  SubmitCommentOptions,
  VerifyAkismetKeyOptions,
} from './comments/index.ts';

// The contact form (TASK-56): the front matter key a page opts in with, the
// endpoint the form posts to, the files under `data/contact/` that hold what
// it collected, and the message that carries one on to the site's address.
export {
  addContactMessage,
  blankContactValues,
  CONTACT_ANCHOR,
  CONTACT_DATA_DIRECTORY,
  CONTACT_FIELDS,
  CONTACT_FRONT_MATTER_KEY,
  CONTACT_MESSAGE_TEMPLATE,
  CONTACT_NOTICE_PARAM,
  CONTACT_NOTICES,
  CONTACT_POST_PATH,
  CONTACT_RATE_LIMIT,
  CONTACT_RATE_WINDOW_SECONDS,
  contactDirectory,
  contactForm,
  contactFormFor,
  contactKeys,
  contactMessageFile,
  contactMessageId,
  contactNoticeFor,
  contactOpen,
  contactProblems,
  contactRecipient,
  contactValuesOf,
  countContactMessagesByStatus,
  countUnreadContactMessages,
  deleteContactMessage,
  listContactMessages,
  MAXIMUM_CONTACT_EMAIL_LENGTH,
  MAXIMUM_CONTACT_MESSAGE_LENGTH,
  MAXIMUM_CONTACT_NAME_LENGTH,
  MAXIMUM_CONTACT_SUBJECT_LENGTH,
  mountContact,
  readContactMessage,
  refilledContactForm,
  sendContactMessage,
  setContactMessageRead,
  submitContactMessage,
} from './contact/index.ts';
export type {
  ContactForm,
  ContactFormContext,
  ContactMessage,
  ContactOutcome,
  ContactProblems,
  ContactRecipientOptions,
  ContactRefusal,
  ContactStatus,
  ContactThrottle,
  NewContactMessage,
  SendContactMessageOptions,
  SubmitContactMessageOptions,
} from './contact/index.ts';

// The defences every public form here shares (TASK-56): the honeypot, the age
// of a rendered form, and the salted hash of where a submission came from.
export {
  ADDRESS_SALT_FILE,
  FORM_LOADED_FIELD,
  FORM_TRAP_FIELD,
  formAgeSeconds,
  formTimingRefusal,
  trapped,
} from './forms/protection.ts';
export type { FormTimingRefusal } from './forms/protection.ts';

export {
  readFileIfPresentSync,
  updateFileAtomically,
  withFileLock,
  writeFileAtomically,
  writeFileAtomicallySync,
} from './files/index.ts';
export type {
  FileContents,
  ProduceFileContents,
  WriteFileAtomicallyOptions,
} from './files/index.ts';

export { DirectoryNotEmptyError, initSite, SITE_TEMPLATE_DIR, siteManifest } from './init.ts';
export type { InitSiteOptions, InitSiteResult } from './init.ts';

export {
  describeImage,
  findImageVariant,
  generateImageVariants,
  imageMediaType,
  IMAGE_DIRECTORY,
  IMAGE_RECORD_NAME,
  IMAGE_SIZES,
  removeImageVariants,
  responsiveImages,
  siteIcons,
  siteImageMarkup,
  variantUrl,
  VARIANT_ASSET_PREFIX,
} from './images/index.ts';
export type {
  DescribeImage,
  ImageConfig,
  ImageRecord,
  ImageVariant,
  SiteIcon,
} from './images/index.ts';

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

// Notifications: who is told about a comment, the switchboard that decides,
// and the signed one-click links the messages carry (TASK-55).
export {
  addCommentOptOut,
  COMMENT_DIGEST_TEMPLATE,
  COMMENT_OPTOUTS_FILE,
  COMMENT_PENDING_TEMPLATE,
  COMMENT_REPLY_TEMPLATE,
  commentOptOutsFile,
  COMMENTS_NOTIFICATION,
  createCommentDigest,
  createCommentNotifier,
  DEFAULT_DELIVERY_MODE,
  DELIVERY_MODE_LABELS,
  DELIVERY_WINDOW_MS,
  deliveryMode,
  DIGEST_MAX_ITEMS,
  DIGEST_TICK_MS,
  DIGEST_TIMES_FILE,
  digestTimesFile,
  hasOptedOut,
  isBatchedMode,
  MODERATE_PATH,
  MODERATION_TOKEN_LIFETIME_SECONDS,
  moderationLink,
  mountNotificationLinks,
  NOTIFICATION_DELIVERY_MODES,
  NOTIFICATION_EVENTS,
  NOTIFICATION_FIELDS,
  NOTIFICATION_SECRET_FILE,
  notificationEvent,
  notificationMode,
  notificationRecipients,
  notificationSwitches,
  notificationTokenExpiry,
  notificationWanted,
  readCommentOptOuts,
  readDigestTimes,
  readNotificationToken,
  recordDigestTimes,
  signNotificationToken,
  systemNotificationTimers,
  UNSUBSCRIBE_ACTION,
  UNSUBSCRIBE_PATH,
  UNSUBSCRIBE_TOKEN_LIFETIME_SECONDS,
  unsubscribeLink,
  withNotification,
  withNotificationMode,
} from './notifications/index.ts';
export type {
  CommentDigest,
  CommentNotifier,
  CreateCommentDigestOptions,
  CreateCommentNotifierOptions,
  DigestLogger,
  LinkContext,
  NewNotificationToken,
  NotificationClaim,
  NotificationDeliveryMode,
  NotificationEvent,
  NotificationSwitch,
  NotificationTimers,
} from './notifications/index.ts';

// Email: the one seam a mail service plugs into, the two providers the package
// ships, the in-memory one a test observes, and the service every feature that
// emails goes through.
export {
  BREVO_ENDPOINT,
  BREVO_TIMEOUT_MS,
  createBrevoProvider,
  createMailService,
  createMailTemplates,
  createMemoryMailProvider,
  createSmtpProvider,
  DEFAULT_MAIL_ATTEMPTS,
  defaultMailBackoffMs,
  MAIL_CREDENTIALS_FILE,
  MAIL_PROVIDERS,
  mailCredentialsPath,
  mailTemplateFiles,
  readMailCredentials,
  removeMailCredentials,
  SMTP_TIMEOUT_MS,
  writeMailCredentials,
} from './mail/index.ts';
export type {
  BrevoCredential,
  BrevoProviderOptions,
  CreateMailServiceOptions,
  CreateMailTemplatesOptions,
  MailAddress,
  MailCredentials,
  MailDelivery,
  MailLogger,
  MailProvider,
  MailProviderName,
  MailRecipient,
  MailResult,
  MailService,
  MailTemplateFiles,
  MailTemplates,
  MemoryMailProvider,
  OutgoingMail,
  RawMail,
  RenderedMail,
  SmtpCredential,
  SmtpProviderOptions,
  TemplateMail,
} from './mail/index.ts';

export {
  acceptedRelays,
  acceptRelay,
  addFollower,
  appendInboxActivity,
  ACTOR_KEY_ALGORITHMS,
  ACTOR_PATH,
  assertActorKeysUsable,
  actorKeyFile,
  actorKeysDir,
  articleObjectId,
  actorAliases,
  actorId,
  avatarUrl,
  keyIdFor,
  mainKeyId,
  multikeyId,
  senderKeyPairs,
  userActor,
  userByUsername,
  createActivityId,
  createDeliveryService,
  createRelayService,
  createSiteFederation,
  deleteActivityId,
  deliveryTargets,
  documentAuthor,
  federatedPost,
  federatedUsernames,
  FEDERATION_DATA_DIRECTORY,
  federationOrigin,
  acctOf,
  handleHref,
  userDirectory,
  webFingerSubject,
  WEBFINGER_PATH,
  followerFrom,
  followerRecipient,
  FOLLOWERS_FILE,
  FOLLOWERS_PAGE_SIZE,
  FOLLOWERS_PATH,
  actorHandle,
  followersFile,
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
  inboxDirectory,
  inboxFile,
  inboxMonth,
  INBOX_DIRECTORY,
  inboxRowFrom,
  loadActorKeyPairs,
  logActivity,
  migrateActorKeysToFiles,
  migrateFederationToFiles,
  mountFederation,
  NODEINFO_PATH,
  OUTBOX_PAGE_SIZE,
  OUTBOX_PATH,
  postArticle,
  postCreateActivity,
  postDeleteActivity,
  postUpdateActivity,
  readFollowers,
  readInboxLog,
  rebuildFederationIndexes,
  rejectRelay,
  relayAnswering,
  relayRecipient,
  REPLY_ACTIVITY_TYPE,
  replyFrom,
  replyTargetOf,
  SHARED_INBOX_PATH,
  SOFTWARE_NAME,
  SOURCE_MEDIA_TYPE,
  toInstant,
  updateActivityId,
} from './federation/index.ts';
export type {
  ActorKeyAlgorithm,
  CreateDeliveryServiceOptions,
  FederationIndexReport,
  FederationRecords,
  UserActorOptions,
  InboxLine,
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
  SiteFederation,
  Reply,
  SiteInboxContext,
} from './federation/index.ts';

export {
  absoluteUrl,
  ACTIVITY_STREAMS_MEDIA_TYPES,
  activityStreamsId,
  alternateLinks,
  archiveMonths,
  ARCHIVE_FRONT_MATTER_KEY,
  archiveOpen,
  assetNotModified,
  assetResponse,
  atomEntry,
  atomFeed,
  AUTHOR_BASE,
  authorContext,
  authorFeedHref,
  authorHref,
  authorNames,
  categoryHref,
  commentAnchor,
  commentsFeedHref,
  commentsFeedPath,
  commentsFeedResponse,
  commentsRssFeed,
  COMMENTS_ROOT,
  COMMENTS_TITLE_PREFIX,
  contentEtag,
  createConversation,
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
  FEED_ITEM_REVISION,
  FEED_SEGMENT,
  FEED_SEGMENTS,
  feedComments,
  feedExcerpt,
  feedHref,
  feedItem,
  feedItems,
  feedLanguage,
  feedLinkHeader,
  feedPathUnder,
  feedResponse,
  feedSize,
  findAsset,
  findThemeAsset,
  findThemeFile,
  findUpload,
  forgetTerm,
  formatDate,
  frontPageSlugs,
  homeHref,
  INBOX_BASE,
  isNotModified,
  isPublicDocument,
  JSON_FEED_VERSION,
  JSON_SCHEMA_VERSION,
  jsonFeed,
  jsonFeedItem,
  lastModifiedOf,
  latestModified,
  listingPageHref,
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
  parseAuthorPath,
  postObjectId,
  postsPerPage,
  prefersActivityStreams,
  profileContext,
  publicDocumentAt,
  recentPosts,
  RECENT_POSTS,
  recordTermRename,
  redirectedTerm,
  REPRESENTATION_EXTENSIONS,
  representationEtag,
  representationHref,
  representationResponse,
  RESERVED_TOP_LEVEL_PATHS,
  rfc822,
  spokenIn,
  robotsResponse,
  robotsTxt,
  ROBOTS_CONTENT_TYPE,
  ROBOTS_PATH,
  rssFeed,
  rssItem,
  readTheme,
  sanitizeCommentHtml,
  selectRepresentation,
  SITE_DATA_FILE,
  SITE_THEME_KIND,
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
  siteAuthorContext,
  siteTimezone,
  splitFeedPath,
  splitRepresentationExtension,
  startOfMonth,
  tagHref,
  TAXONOMIES,
  userForAuthor,
  TAXONOMY_BASE_PATTERN,
  TAXONOMY_LABELS,
  taxonomyBaseProblems,
  taxonomyBases,
  taxonomyBasesOrDefault,
  taxonomyForSegment,
  taxonomyRedirectsOf,
  OPTIONAL_TEMPLATES,
  TEMPLATES,
  termHref,
  termRedirects,
  themeAssetNotModified,
  themeAssetResponse,
  THEME_ASSET_MAX_AGE,
  THEME_ASSET_PREFIX,
  THEME_STATIC_DIR,
  THEME_MANIFEST_FILE,
  themeSearchPath,
  UPLOAD_ASSET_MAX_AGE,
  UPLOAD_ASSET_PREFIX,
  UPLOAD_DIRECTORY,
  WFW_NAMESPACE,
} from './web/index.ts';
export type {
  AcceptRange,
  AssetResponseOptions,
  AuthorContext,
  AuthorRequest,
  ConditionalHeaders,
  CreateRendererOptions,
  CommentFeedSource,
  Conversation,
  ConversationContext,
  ConversationReader,
  CreateTemplateEnvironmentOptions,
  DateFormat,
  DocumentContext,
  DocumentJson,
  DocumentJsonOptions,
  FeedComment,
  FeedFormat,
  FeedIdentity,
  FeedItem,
  FeedItemComments,
  FeedItemContext,
  FeedPath,
  FeedResponseOptions,
  FeedSource,
  FrontPageSlugs,
  JsonFeed,
  JsonFeedAuthor,
  JsonFeedHub,
  Interaction,
  InteractionAuthor,
  InteractionCounts,
  InteractionKind,
  InteractionSource,
  InteractionStatus,
  JsonFeedItem,
  SiteInteraction,
  NotifyServer,
  Listing,
  MenuItem,
  NavigationItem,
  NavigationMenuOptions,
  NeighbourContext,
  PageContext,
  PaginateOptions,
  Pagination,
  RecentPostsSource,
  Renderer,
  Representation,
  RepresentationExtension,
  RepresentationResponseOptions,
  SiteData,
  SiteDataSource,
  SitemapResponseOptions,
  SitemapUrl,
  StaticAsset,
  Taxonomy,
  TaxonomyBaseProblems,
  TaxonomyBases,
  TaxonomyRedirect,
  TaxonomyTerm,
  Theme,
  ThemeAsset,
  ThemeKind,
  ThemeRead,
} from './web/index.ts';
export {
  classesOf,
  createWebmentionService,
  discoverEndpoint,
  DISCOVERY_MAX_BYTES,
  DISCOVERY_TIMEOUT_MS,
  elementsIn,
  endpointInHeader,
  endpointInHtml,
  externalLinks,
  innerHtmlOf,
  isElement,
  itemsIn,
  linksTo,
  parseHtml,
  rawTextOf,
  readCapped,
  SEND_TIMEOUT_MS,
  sourceEntry,
  textOf,
  WEBMENTION_USER_AGENT,
} from './webmention/index.ts';
export type {
  CreateWebmentionServiceOptions,
  HtmlElement,
  HtmlNode,
  HtmlText,
  MicroformatItem,
  MicroformatValue,
  SourceEntry,
  WebmentionKind,
  WebmentionLogger,
  WebmentionReport,
} from './webmention/index.ts';

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
   * Everything in the database that is not the content index: the sessions,
   * the followers and inbox indexes, the delivery outcomes, the relay
   * handshake and the scheduler's watermark. In the same file as the index.
   *
   * All of it is derived or disposable (decision-9); the accounts and the
   * actor's keys, which are not, are files under `dataDir`.
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
   * one of them as it now reads.
   *
   * It is already subscribed to the index; a site only reaches for it to
   * resend a post, or to wait for the deliveries in flight.
   */
  readonly delivery: DeliveryService;
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
 * The two connections a boot takes on the one database, opened together so
 * that either both of them survive it or neither does.
 *
 * The database is a cache (decision-9), so a version of it this package cannot
 * carry forward is thrown away and read back from the files rather than being
 * a thing anybody has to do something about. That is what
 * {@link withRebuiltDatabase} does with an {@link OutdatedDatabaseError} — and
 * why the content store is closed before the admin store's failure is allowed
 * to leave here: the file cannot be deleted while a connection holds it.
 *
 * The failure it does not recover from is a database written by a newer
 * `@geekity/cms`, or one damaged past opening. Both refuse the boot naming the
 * file, because a downgrade is usually a mistake and because a database from
 * before decision-9 still carries the settings, key and account rows the
 * migrations below write out as files — deleting one of those to get past an
 * error would destroy an actor's private keys. `geekity rebuild` is the door
 * for a person who has looked and decided.
 */
function openCache(resolved: ResolvedConfig): { store: ContentStore; admin: AdminStore } {
  return withRebuiltDatabase(resolved.dataDir, () => {
    const store = openContentStore({ dataDir: resolved.dataDir, now: resolved.now });
    try {
      return { store, admin: openAdminStore({ dataDir: resolved.dataDir }) };
    } catch (error) {
      store.close();
      throw error;
    }
  });
}

/**
 * Build a CMS around a site's config.
 *
 * The returned app is a plain Hono app: the public site, the admin UI and the
 * federation endpoints are all mounted on it as later milestones land. Booting
 * opens the SQLite cache under `dataDir` (creating the directory) and applies
 * any migrations, so `close()` has to be called to release it. A missing
 * database is built and read back out of the files; see {@link openCache} for
 * what happens to one this version cannot use.
 */
export function createCms(config: GeekityConfig = {}): Cms {
  const resolved = resolveConfig(config);
  const { store, admin } = openCache(resolved);

  // A site upgrading from the version that kept its settings in SQLite has
  // rows nothing would read again: they become content/_data/site.json here,
  // once, and the table goes (decision-9). A site that has already been
  // through it does nothing but check.
  migrateSettingsToFile({ admin, contentDir: resolved.contentDir });

  // And the same for its actor's key pairs, which become JWK files under
  // data/keys. This is the migration that must not fail: an actor whose
  // private key is lost is one every follower stops being able to verify, so
  // the rows are written out before the table is dropped, and a file that is
  // already there always wins.
  migrateActorKeysToFiles({ admin, dataDir: resolved.dataDir });

  // And the accounts, which become data/users.json. The ids come with them, so
  // a session the database already holds still names the person it was made
  // for, and the file wins where there already is one.
  migrateUsersToFile({ admin, dataDir: resolved.dataDir });

  // And the log of what the inbox was told, which becomes
  // content/_data/federation/inbox/{yyyy}-{mm}.jsonl. Unlike the three above,
  // no table is dropped: `ap_inbox` and `followers` stay as indexes of the
  // files, which is why the rebuild is next and runs on every boot rather than
  // once. The site actor's followers are not migrated: decision-14 replaced it
  // with one actor per user, and nobody inherits a follow made with somebody
  // who no longer exists.
  migrateFederationToFiles({ admin, contentDir: resolved.contentDir });
  rebuildFederationIndexes({ admin, contentDir: resolved.contentDir });

  // And the comments, which are files under content/_data/comments/ and
  // nothing else (TASK-50). No migration goes with this one, because no
  // earlier version of this CMS stored a comment anywhere: the rebuild is the
  // whole of it, and it runs on every boot for the same reason the federation
  // one does.
  rebuildCommentIndexes({ admin, contentDir: resolved.contentDir });

  // And, once the files are the whole story, that every user's keys are
  // readable. This is the one thing here that can stop a boot: an actor that
  // publishes no key is one no follower can verify, and Fedify would serve
  // exactly that rather than complain. A minute of downtime with the file
  // named is the better failure. A user who has never federated has no key
  // files at all, which is not damage and does not stop anything.
  for (const user of listUsers(resolved.dataDir)) {
    assertActorKeysUsable(resolved.dataDir, user.username);
  }

  // The one thing the settings decide before a request arrives. It is settled
  // here, at boot, rather than per request: `baseUrl` also decides whether the
  // session cookie is `Secure`, and flipping that under a signed-in admin
  // would log them out of the form they just submitted.
  resolved.baseUrl = effectiveBaseUrl(resolved, readSiteSettings(resolved.contentDir));

  // Akismet, when the site has not named a checker of its own (TASK-52). A
  // config that names one wins outright, because a site that has written a
  // checker meant it; this is the one the settings screen turns on with a key
  // rather than a deployment.
  //
  // Built whether or not there is a key in `data/akismet.json`: it reads that
  // file on every call, so a key pasted into the settings screen filters the
  // next comment and a key removed stops filtering at once, neither of them
  // needing a restart. With no key it sends nothing anywhere.
  resolved.commentChecker ??= createAkismetChecker({
    dataDir: resolved.dataDir,
    // Read when a comment arrives rather than now, so a change of language on
    // the settings screen reaches Akismet without a restart either.
    language: () => readSiteSettings(resolved.contentDir).language,
  });

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

  const content = createContentSync({
    store,
    contentDir: resolved.contentDir,
    watch: resolved.watch,
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
  const conversation = createConversation({ admin, store, baseUrl: resolved.baseUrl });

  const renderer = createRenderer({
    config: resolved,
    themes,
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
    commentForm: (document) =>
      commentFormFor({
        document,
        site: renderer.site(),
        now: resolved.now(),
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
    // And the newest posts for the front page, by the current-month-or-five
    // rule. Only the front page asks, so a site whose `/` is its listing never
    // runs the query at all.
    recentPosts: () => recentPosts(store),
    // And every published post, for a page that says `archive: true`. The one
    // listing with no paging, so it is asked for only by the page that prints
    // it (TASK-85).
    archivePosts: () => store.listPosts(),
  });
  // One KV store for both federations. The compatibility one (TASK-70) shares
  // it so that the same `Follow` redelivered to a user's own inbox and to the
  // WordPress path it used to have is recognised as one activity rather than
  // handled twice; both sets of inbox listeners are `per-origin` for the same
  // reason (doc-8).
  const federationKv = resolved.federation.kv ?? new MemoryKvStore();
  const federation = createSiteFederation({
    baseUrl: resolved.baseUrl,
    ...resolved.federation,
    kv: federationKv,
  });

  /**
   * The WordPress compatibility federation, built the first time a request
   * actually reaches one of the plugin's paths with the switch on.
   *
   * Lazy because almost no site will ever turn the switch on, and a second set
   * of dispatchers built at every boot for a setting nobody uses is work for
   * nothing. `mountFederation` keeps whatever this hands back.
   */
  const wordpressFederation = (): SiteFederation =>
    createWordPressFederation({
      baseUrl: resolved.baseUrl,
      ...resolved.federation,
      kv: federationKv,
      canonical: federation,
    });

  // Federation listens to the index rather than to the admin, so a post edited
  // on disk federates exactly as one saved through the editor does (doc-4).
  // It is built before the app because a handler reads it off the context: the
  // admin's Resend button is a request that sends a post out again.
  const delivery = createDeliveryService({ federation, admin, store, config: resolved });
  content.events.on('change', (change) => delivery.handle(change));

  // Who hears about a comment (TASK-55). It reads the users file and the mail
  // settings per message rather than at boot, so an address added on the users
  // screen is written to by the very next comment.
  const notifications = createCommentNotifier({ admin, store, mail, config: resolved });

  // And the other half of it (TASK-60): a user who asked for an hourly or a
  // daily digest hears nothing above and one message per window from here,
  // listing whatever is still pending when their window comes up. It reads the
  // users file and the record of what it has sent per run, for the same
  // reason: a mode chosen on the users screen takes effect at the next tick.
  const digests = createCommentDigest({ admin, store, mail, config: resolved });

  // And so does the webmention sender: telling the pages a post links to is
  // the same news as telling the followers, and it should not matter which
  // door the post came in by (TASK-51).
  const webmentions = createWebmentionService({ admin, store, config: resolved, notifications });
  content.events.on('change', (change) => {
    webmentions.handle(change);
  });

  // The notify server listens to the index for the same reason: a post edited
  // on disk changed the same feeds as one saved through the editor.
  const notifier = createFeedNotifier({ config: resolved });
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
    c.set('conversation', conversation);
    c.set('announce', (change) => content.announce(change));
    c.set('delivery', delivery);
    c.set('relays', relays);
    c.set('webmentions', webmentions);
    c.set('mail', mail);
    c.set('notifications', notifications);
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
  mountFederation(app, federation, { wordpress: wordpressFederation });

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
    webmentions,
    notifier,
    mail,
    notifications,
    digests,
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

      // The digests tick from here on. Nothing is caught up first: a digest is
      // whatever is pending when a window comes up, so a site that was down
      // over one simply sends the next one, with everything still waiting in it.
      digests.start();

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
      digests.stop();
      await content.stop();
      await scheduler.settled();
      await digests.settled();
      // Anything already on its way out is allowed to finish, so closing never
      // leaves a delivery half recorded.
      await delivery.settled();
      await relays.settled();
      await webmentions.settled();
      await notifier.settled();
      await mail.settled();

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
