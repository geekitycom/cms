import type { Server as HttpServer } from 'node:http';
import { Server as NetServer } from 'node:net';

import { MemoryKvStore } from '@fedify/fedify';
import { serve as serveNode } from '@hono/node-server';
import { Hono } from 'hono';

import { createAccessLog } from './access-log.ts';
import { PLUGINS_RELOAD_PATH } from './admin/plugins.ts';
import { createWriteGate } from './drain.ts';
import { createSettlingQueue } from './federation/queue.ts';
import type { InstalledPlugin } from './plugins/registry.ts';
import type { Supervision } from './supervisor/supervision.ts';
import { refuseWritesUnder } from './files/atomic.ts';
import { compression } from './web/compression.ts';
import { createAvatarService } from './avatars/index.ts';
import type { AvatarService } from './avatars/index.ts';
import { createRetentionService } from './privacy/retention.ts';
import type { RetentionService } from './privacy/retention.ts';
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
import { shareLocation } from './content/location.ts';
import { postLocations } from './content/locations.ts';
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
import { readEnabledPlugins } from './plugins/enabled.ts';
import { mountPluginRoutes, pluginLifecycle } from './plugins/mount.ts';
import { pluginFederation } from './plugins/federation.ts';
import { sitePluginRegistry } from './plugins/site.ts';
import { createCommentDigest, createCommentNotifier } from './notifications/index.ts';
import type { CommentDigest, CommentNotifier } from './notifications/index.ts';
import {
  assertActorKeysUsable,
  createActorProfileService,
  createDeliveryService,
  createRelayService,
  createSiteFederation,
  migrateActorKeysToFiles,
  migrateFederationToFiles,
  mountFederation,
  rebuildFederationIndexes,
  signedProfileLoader,
} from './federation/index.ts';
import { citedPostReader } from './federation/cited-post.ts';
import { handleLearner } from './federation/handles.ts';
import type {
  ActorProfileService,
  DeliveryService,
  RelayService,
  SiteFederation,
} from './federation/index.ts';
import { createFeedNotifier } from './notify.ts';
import type { FeedNotifier, NotifyReport } from './notify.ts';
import { createIndexNowNotifier } from './indexnow.ts';
import type { IndexNowNotifier } from './indexnow.ts';
import {
  commentFormFor,
  createAkismetChecker,
  migrateCommentEmails,
  rebuildCommentIndexes,
} from './comments/index.ts';
import { contactFormFor } from './contact/index.ts';
import { settleImageVariants } from './images/variants.ts';
import { createMaintenanceSwitch } from './maintenance.ts';
import {
  createConversation,
  createRedirectSource,
  createRenderer,
  createSiteDataSource,
  createThemeSource,
  maintenanceGate,
  mountHealth,
  mountPublicSite,
  mountWellKnown,
  recentPosts,
  redirectBy,
  serverError,
  themeName,
} from './web/index.ts';
import { activityLogSettled } from './indieauth/activity-log.ts';
import { mountAuthorizationEndpoint } from './indieauth/consent.ts';
import { mountIndieAuthDiscovery } from './indieauth/discovery.ts';
import { createIndieAuthState } from './indieauth/grants.ts';
import { mountTokenEndpoint, mountTokenInfoEndpoints } from './indieauth/token.ts';
import { mountMicropub } from './micropub/endpoint.ts';
import { mountMicropubMedia } from './micropub/media.ts';
import { createReplyContextService, createWebmentionService } from './webmention/index.ts';
import {
  selectedTargets,
  syndicationCopies,
  syndicationTargetProblems,
  syndicationTargetsReader,
} from './webmention/syndication.ts';
import type { ReplyContextService, WebmentionService } from './webmention/index.ts';

export { createFeedNotifier, NOTIFY_TIMEOUT_MS } from './notify.ts';
export { createIndexNowNotifier, defaultIndexNowBackoffMs, INDEXNOW_ENDPOINT } from './indexnow.ts';
export type { CreateIndexNowNotifierOptions, IndexNowNotifier } from './indexnow.ts';
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
  FEDERATION_SETTINGS_PATH,
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
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  sessionCookieName,
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
  setUserActorId,
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
  ActorProfile,
  StoredActorProfile,
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
  DEFAULT_SECURITY_HEADERS,
  DEFAULT_UPLOAD_MAX_BYTES,
  DEFAULT_UPLOAD_MEDIA_MAX_BYTES,
  DEFAULT_UPLOAD_TYPES,
  defineConfig,
  KNOWN_IMAGE_FORMATS,
  resolveConfig,
} from './config.ts';
export type {
  DocumentChangeHook,
  FederationOverrides,
  GeekityConfig,
  IndexNowOverrides,
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
  COMMENT_EMAILS_DIRECTORY,
  COMMENT_EMAILS_FILE_MODE,
  COMMENT_SALT_FILE,
  COMMENTS_DATA_DIRECTORY,
  COMMENTS_FRONT_MATTER_KEY,
  commentForm,
  commentFormFor,
  commentKeys,
  commentNoticeFor,
  commentPolicyOf,
  commentProblems,
  commentEmailsFile,
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
  migrateCommentEmails,
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
  signedInCommenter,
  signedInCommentForm,
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
  CommentEmailMigrationReport,
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
  CommentViewer,
  IntakeCommentOptions,
  ModerateCommentOptions,
  ModerationAction,
  ModerationOutcome,
  NewComment,
  ProposedComment,
  SignedInAuthor,
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
export { definePlugin, HOST_API_VERSION } from './plugin.ts';
export type {
  JsonLdDocument,
  Plugin,
  PluginActorKey,
  PluginCollection,
  PluginCollectionPage,
  PluginCommand,
  PluginCommandContext,
  PluginCommandOption,
  PluginDataFolder,
  PluginFederationContext,
  PluginFederationMiddleware,
  PluginFollower,
  PluginHost,
  PluginKeyAlgorithm,
  PluginRecipient,
  PluginRequestContext,
  PluginRequirements,
  PluginRouteHandler,
  PluginScreen,
  PluginScreenBlock,
  PluginScreenCard,
  PluginScreenCell,
  PluginScreenContext,
  PluginScreenText,
  PluginSite,
  PluginUser,
} from './plugin.ts';
export { DuplicatePluginError, pluginDataFolder } from './plugins/registry.ts';
export { pluginSite } from './plugins/site.ts';
export { PLUGINS_PATH } from './admin/plugins.ts';
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
  iconSetting,
  manifestIcons,
  siteIcons,
  siteImageMarkup,
  variantUrl,
  VARIANT_ASSET_PREFIX,
} from './images/index.ts';
export type {
  DescribedImage,
  DescribeImage,
  ImageConfig,
  ImageLoading,
  ImageRecord,
  ImageVariant,
  ManifestIcon,
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
  ENCLOSURE_FRONT_MATTER_KEY,
  enclosureOf,
  freeSlug,
  DuplicatePermalinkError,
  hashDocument,
  htmlToText,
  isCaptions,
  isScheduled,
  isTrashedPath,
  KNOWN_FRONT_MATTER_KEYS,
  KNOWN_UPLOAD_TYPES,
  matchesSignature,
  MAXIMUM_DELAY_MS,
  MAXIMUM_QUERY_TERMS,
  normalizeBody,
  normalizeUploadType,
  openContentStore,
  parseDocument,
  PHOTO_FRONT_MATTER_KEY,
  photoAlt,
  photosOf,
  playsAsVideo,
  renderMarkdown,
  saveDocument,
  SCHEDULE_ORIGIN,
  scheduledFor,
  searchExpression,
  searchText,
  serializeDocument,
  slugify,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  systemClock,
  systemTimers,
  toUtcInstant,
  TRANSCRIPT_TYPES,
  TRASH_DIRECTORY,
  typeForPath,
  UPLOAD_MEDIA_TYPES,
  wallClockIn,
  zoneLabel,
} from './content/index.ts';
export type {
  ActivityPubMetadata,
  AlternateEnclosure,
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
  Enclosure,
  FreeSlugOptions,
  ListAllOptions,
  ListByTagOptions,
  ListOptions,
  OpenContentStoreOptions,
  ParseDocumentOptions,
  Photo,
  SaveDocumentOptions,
  ScheduleLogger,
  Scheduler,
  ScheduleTimers,
  ScheduleWatermark,
  SearchHit,
  SearchText,
  SyncLogger,
  SyncResult,
  TagCount,
  Transcript,
  TranscriptType,
  UploadKind,
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
  postCreateActivity,
  postDeleteActivity,
  postObject,
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
  authorName,
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
  CREATIVE_COMMONS_LICENSES,
  CREATIVE_COMMONS_NAMESPACE,
  DEFAULT_FEED_SIZE,
  DEFAULT_MENU_NAME,
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
  isLinkUrl,
  isNotModified,
  isListed,
  isServed,
  ITUNES_NAMESPACE,
  JSON_FEED_VERSION,
  JSON_SCHEMA_VERSION,
  jsonFeed,
  jsonFeedItem,
  lastModifiedOf,
  latestModified,
  LINK_REL_RULE,
  LINK_URL_RULE,
  listingPageHref,
  LISTING_REPRESENTATIONS,
  matchesEtag,
  MAXIMUM_QUERY_LENGTH,
  MEDIA_TYPES,
  MENU_NAME_MAX_LENGTH,
  MENU_NAME_PATTERN,
  menuItemLineProblem,
  menuItemOf,
  menuItemsFromText,
  menuItemsText,
  menuNameProblem,
  menusOf,
  mountPublicSite,
  navigationItems,
  navigationItemsOf,
  navigationMenu,
  navigationMenus,
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
  PODCAST_NAMESPACE,
  postObjectId,
  postsPerPage,
  prefersActivityStreams,
  profileContext,
  publicDocumentAt,
  recentPosts,
  resolveLicense,
  RECENT_POSTS,
  recordTermRename,
  redirectedTerm,
  REPRESENTATION_EXTENSIONS,
  representationEtag,
  REL_VALUE_PATTERN,
  relText,
  relValuesOf,
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
  searchHref,
  searchJson,
  searchPageIndex,
  searchQuery,
  SEARCH_PAGE_PARAM,
  SEARCH_PATH,
  SEARCH_QUERY_PARAM,
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
  snippetHtml,
  SOURCE_NAMESPACE,
  siteAuthorContext,
  siteAuthorName,
  siteMenus,
  siteTimezone,
  splitFeedPath,
  splitLinkRel,
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
  LinkLine,
  PublishedProfileLink,
  AuthorRequest,
  ConditionalHeaders,
  CreateRendererOptions,
  CommentFeedSource,
  ContentLicense,
  Conversation,
  ConversationContext,
  CreativeCommonsKey,
  LicenseSource,
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
  JsonFeedAttachment,
  JsonFeedAuthor,
  JsonFeedGeekity,
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
  MenuList,
  NavigationItem,
  NavigationMenuOptions,
  NavigationMenus,
  NavigationMenusOptions,
  NeighbourContext,
  PageContext,
  PaginateOptions,
  Pagination,
  RecentPostsSource,
  Renderer,
  Representation,
  RepresentationExtension,
  RepresentationResponseOptions,
  RobotsPolicy,
  SearchJson,
  SearchJsonOptions,
  SearchPage,
  SearchResultJson,
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
  ThemeArea,
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
  createReplyContextService,
  fetchReplyContext,
  readReplyContext,
  REPLY_CONTEXTS_FILE,
  systemHostLookup,
  parseSyndicationTargets,
  selectedTargets,
  SYNDICATE_TO_FRONT_MATTER_KEY,
  SYNDICATION_FILE,
  SYNDICATION_FRONT_MATTER_KEY,
  SYNDICATION_TARGETS_FILE,
  syndicationTargetsReader,
} from './webmention/index.ts';
export type {
  ParsedSyndicationTargets,
  SyndicationTarget,
  SyndicationTargetsReader,
  CreateReplyContextServiceOptions,
  HostLookup,
  ReplyContext,
  ReplyContextService,
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
export {
  AVATAR_PATH_PREFIX,
  AVATAR_SIZE,
  avatarHref,
  avatarSourceOf,
  createAvatarService,
  mountAvatars,
} from './avatars/index.ts';
export type { AvatarAnswer, AvatarService, CreateAvatarServiceOptions } from './avatars/index.ts';
export {
  RECOMMENDED_ADDRESS_HASH_RETENTION_DAYS,
  RECOMMENDED_COMMENT_EMAIL_RETENTION_DAYS,
  RECOMMENDED_CONTACT_MESSAGE_RETENTION_DAYS,
} from './privacy/policy.ts';
export type { RetentionPolicy } from './privacy/policy.ts';
export { createRetentionService, RETENTION_SWEEP_MS } from './privacy/retention.ts';
export type {
  CreateRetentionServiceOptions,
  RetentionReport,
  RetentionService,
} from './privacy/retention.ts';

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
   * boots.
   */
  drain(): Promise<void>;
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
export function createCms(config: GeekityConfig = {}, context: ServeContext = {}): Cms {
  const resolved = resolveConfig(config);

  const plugins = sitePluginRegistry(resolved, context.folderPlugins);

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

  // And the comments, which are files under content/_data/comments/ with
  // their authors' emails under data/comments/ (TASK-50, TASK-182). A comment
  // file that still holds an email, from before they moved or from a hand
  // edit, has it moved first; then the index is rebuilt, on every boot for the
  // same reason the federation one is.
  const commentRecords = { admin, contentDir: resolved.contentDir, dataDir: resolved.dataDir };
  migrateCommentEmails(commentRecords);
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
  });

  // What a reply shows of the post it answers. Built before the renderer,
  // which reads the stored contexts, and subscribed to the index below with
  // the other services that reach out to the web.
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
    onStored: (target, previous) => {
      delivery.citedPageStored(target, previous);
      const original = replyContexts.read(target)?.original;
      if (original !== undefined && original !== previous?.original) {
        webmentions.originalFound(target, original);
      }
    },
  });

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
    replyContext: (target) => replyContexts.read(target),
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
    // And the newest posts for the front page, by the current-month-or-five
    // rule. Only the front page asks, so a site whose `/` is its listing never
    // runs the query at all.
    recentPosts: () => recentPosts(store),
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

  // Federation listens to the index rather than to the admin, so a post edited
  // on disk federates exactly as one saved through the editor does (doc-4).
  // It is built before the app because a handler reads it off the context: the
  // admin's Resend button is a request that sends a post out again.
  // The names and faces of the actors who are not followers (TASK-184),
  // fetched in the background when one is heard from and on a sweep.
  const actorProfiles = createActorProfileService({
    admin,
    config: resolved,
    load: signedProfileLoader(() =>
      federation.createContext(new URL(resolved.baseUrl), {
        admin,
        store,
        config: resolved,
        actorProfiles,
        cited: (url) => replyContexts.read(url),
      }),
    ),
  });

  const federationContext = () =>
    federation.createContext(new URL(resolved.baseUrl), {
      admin,
      store,
      config: resolved,
      actorProfiles,
      cited: (url) => replyContexts.read(url),
    });

  const learnHandles = handleLearner(federationContext);

  const delivery = createDeliveryService({
    federation,
    admin,
    store,
    config: resolved,
    actorProfiles,
    cited: (url) => replyContexts.read(url),
  });
  content.events.on('change', (change) => delivery.handle(change));

  // Who hears about a comment (TASK-55). It reads the users file and the mail
  // settings per message rather than at boot, so an address added on the users
  // screen is written to by the very next comment.
  const notifications = createCommentNotifier({
    admin,
    store,
    mail,
    config: resolved,
    cited: (url) => replyContexts.read(url),
  });

  // And the other half of it (TASK-60): a user who asked for an hourly or a
  // daily digest hears nothing above and one message per window from here,
  // listing whatever is still pending when their window comes up. It reads the
  // users file and the record of what it has sent per run, for the same
  // reason: a mode chosen on the users screen takes effect at the next tick.
  const digests = createCommentDigest({
    admin,
    store,
    mail,
    config: resolved,
    cited: (url) => replyContexts.read(url),
  });

  // And so does the webmention sender: telling the pages a post links to is
  // the same news as telling the followers, and it should not matter which
  // door the post came in by (TASK-51).
  const webmentions = createWebmentionService({
    admin,
    store,
    config: resolved,
    notifications,
    originalOf: (url) => replyContexts.read(url)?.original,
  });
  content.events.on('change', (change) => {
    webmentions.handle(change);
  });
  content.events.on('change', (change) => {
    replyContexts.handle(change);
  });

  // The notify server listens to the index for the same reason: a post edited
  // on disk changed the same feeds as one saved through the editor.
  const notifier = createFeedNotifier({ config: resolved });
  content.events.on('change', (change) => notifier.handle(change));

  // IndexNow listens for the same reason, and wants the pages as well as the
  // posts: a search engine indexes both (TASK-151).
  const indexNow = createIndexNowNotifier({ config: resolved });
  content.events.on('change', (change) => {
    indexNow.handle(change);
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
    },
  });
  content.events.on('change', (change) => {
    scheduler.handle(change);
  });

  // Relay subscriptions (FEP-ae0c). The list is a setting and the handshake is
  // a record, so booting reconciles the two: a relay the file names and the
  // database has never heard of is followed here, which is what makes a
  // rebuilt database catch up rather than silently stop federating to it.
  const relays = createRelayService({
    federation,
    admin,
    store,
    config: resolved,
    actorProfiles,
    cited: (url) => replyContexts.read(url),
  });
  relays.sync();

  const maintenance = createMaintenanceSwitch({
    dataDir: resolved.dataDir,
    forced: resolved.maintenance,
    now: resolved.now,
  });

  const indieauth = createIndieAuthState(resolved.now);

  const app = new Hono<GeekityEnv>();

  // A handler that throws is answered here rather than with Hono's plain-text
  // 500. The middleware above the handler still runs on the way out, so the
  // baseline and admin headers land on this response like any other.
  app.onError(serverError);

  // One line per request, before anything else is registered so that every
  // route is on it: /healthz, the federation endpoints, the admin and the
  // public site alike, and a request whose handler threw as well. Off unless
  // the site asked for it; `geekity serve` asks.
  if (resolved.accessLog) {
    app.use(
      '*',
      createAccessLog({
        config: resolved,
        ...(resolved.accessLogWriter === undefined ? {} : { write: resolved.accessLogWriter }),
      }),
    );
  }

  // Outside everything after it, so it compresses the body the client is
  // about to get, the error pages and the 503 included (TASK-139).
  if (resolved.compression) app.use('*', compression());

  const writes = createWriteGate({ exempt: (pathname) => pathname === PLUGINS_RELOAD_PATH });
  app.use('*', writes.middleware);

  app.use('*', async (c, next) => {
    c.set('store', store);
    c.set('admin', admin);
    c.set('config', resolved);
    c.set('renderer', renderer);
    c.set('conversation', conversation);
    c.set('avatars', avatars);
    c.set('actorProfiles', actorProfiles);
    c.set('announce', (change) => content.announce(change));
    c.set('rescan', () => content.sync());
    c.set('delivery', delivery);
    c.set('relays', relays);
    c.set('webmentions', webmentions);
    c.set('replyContexts', replyContexts);
    c.set('learnHandles', learnHandles);
    c.set('mail', mail);
    c.set('notifications', notifications);
    c.set('redirects', redirects);
    c.set('maintenance', maintenance);
    c.set('indieauth', indieauth);
    c.set('supervision', context.supervision);
    await next();
  });

  app.use(
    '*',
    pluginLifecycle(plugins, () => writes.refusing),
  );

  // The baseline on everything the CMS answers, admin and public alike, and
  // outside everything below so redirects, the 503, 404s and the onError 500
  // carry it too. The admin sets stricter values of its own inside it; none of
  // it restricts what a theme may reference.
  app.use('*', baselineSecurityHeaders);

  // And one on every redirect, whichever part of the CMS sent it.
  app.use('*', redirectBy);

  // Maintenance mode (TASK-130) turns away everything after it but the health
  // checks, the admin and the theme's files, so it goes in front of all of
  // them: federation's inboxes included.
  app.use('*', maintenanceGate);

  app.get('/_geekity/health', (c) => c.json({ status: 'ok' }));

  // The health check a container orchestrator or an uptime monitor probes
  // (TASK-87). It goes on before federation, the admin and the public site,
  // so no permalink can ever shadow it.
  mountHealth(app);

  // The two well-known files a site answers for itself (TASK-133), before the
  // public site can claim either path as a permalink.
  mountWellKnown(app);

  // IndieAuth's authorization server metadata (TASK-157), the endpoint that
  // starts a sign-in (TASK-158), the one that issues tokens (TASK-160) and
  // the ones that answer for a token once issued (TASK-161), here for the
  // reason the well-known files are.
  mountIndieAuthDiscovery(app);
  mountAuthorizationEndpoint(app);
  mountTokenEndpoint(app);
  mountTokenInfoEndpoints(app);
  // Micropub (TASK-163) and its media endpoint (TASK-165), which stand on
  // those tokens.
  mountMicropub(app);
  mountMicropubMedia(app);

  // Federation goes on first. It answers its own paths and falls through on
  // every other, so putting it in front costs the rest of the app nothing and
  // is the only place it can go: the public site claims every unmatched path
  // in its not-found handler.
  mountFederation(app, federation, {
    plugins: pluginFederation({
      registry: plugins,
      canonical: federation,
      kv: federationKv,
      allowPrivateAddress: resolved.federation.allowPrivateAddress ?? false,
    }),
  });

  // The admin goes on before the public site, for the same reason.
  mountAdmin(app);
  mountPluginRoutes(app, plugins);
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

  let server: HttpServer | undefined;
  let releaseFiles: (() => void) | undefined;

  /** Everything that runs on its own once the site serves, after the scan. */
  async function startServices(): Promise<void> {
    // The index is brought up to date before the first request, so a site
    // never serves a stale document, and the watcher takes over from there.
    await content.start();

    // After the scan, because the catch-up reads the index: a post whose
    // date passed while nothing was running is published here, once.
    await scheduler.start();

    // And a reply whose target the contexts file holds nothing for is
    // fetched now, in the background, for the same reason (TASK-123).
    replyContexts.catchUp();

    // And the avatars the conversations show are fetched or refreshed in the
    // background now and on a timer from here on, so a reader almost never
    // waits on a stranger's server for one (TASK-134).
    avatars.start();

    // And the profiles of whoever is in the inbox log without being a
    // follower: missing ones are fetched now, which is the backfill of a log
    // written before profiles were kept, and stale ones on a timer (TASK-184).
    actorProfiles.start();

    // And whatever personal data has outlived its period is removed now and
    // every few hours from here on (TASK-135).
    retention.start();

    // The digests tick from here on. Nothing is caught up first: a digest is
    // whatever is pending when a window comes up, so a site that was down
    // over one simply sends the next one, with everything still waiting in it.
    digests.start();

    await plugins.reconcile(readEnabledPlugins(resolved.contentDir));
  }

  function stopTimers(): void {
    scheduler.stop();
    digests.stop();
    avatars.stop();
    actorProfiles.stop();
    retention.stop();
  }

  /**
   * Anything already on its way out is allowed to finish, so stopping never
   * leaves a delivery half recorded or a queued one unsent.
   */
  async function settleQueues(): Promise<void> {
    await scheduler.settled();
    await digests.settled();
    await delivery.settled();
    await relays.settled();
    await federationQueue?.settled();
    await webmentions.settled();
    await replyContexts.settled();
    await avatars.settled();
    await actorProfiles.settled();
    await retention.settled();
    await notifier.settled();
  }

  /** What is left once the queues are empty: the mail, the image encodes, the activity log. */
  async function settleWrites(): Promise<void> {
    await mail.settled();
    // A page render derives an upload's variants in the background; the
    // encode finishes before the directories it writes into can be removed.
    await settleImageVariants(resolved);
    await activityLogSettled(resolved.dataDir);
  }

  return {
    app,
    config: resolved,
    store,
    admin,
    federation,
    delivery,
    relays,
    webmentions,
    replyContexts,
    avatars,
    actorProfiles,
    retention,
    notifier,
    indexNow,
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

      await startServices();

      // A syndication target the site declares badly is ignored everywhere,
      // and said so once here rather than on every page (TASK-155).
      for (const problem of syndicationTargetProblems(resolved.contentDir)) console.warn(problem);

      return new Promise((resolve) => {
        server = serveNode({ fetch: app.fetch, port: resolved.port }, (info) => {
          resolve({ port: info.port });
        }) as HttpServer;
      });
    },

    async drain() {
      await writes.refuse();
      await plugins.reconcile(new Set());
      stopTimers();
      await content.stop();
      await settleQueues();
      await indexNow.settled();
      await settleWrites();
      store.setReadOnly(true);
      admin.setReadOnly(true);
      releaseFiles ??= refuseWritesUnder([resolved.dataDir, resolved.contentDir]);
    },

    async resume() {
      releaseFiles?.();
      releaseFiles = undefined;
      store.setReadOnly(false);
      admin.setReadOnly(false);
      await startServices();
      writes.reopen();
    },

    async close() {
      const running = server;
      server = undefined;
      await plugins.close();
      stopTimers();
      await content.stop();
      await settleQueues();
      // What was gathered and not yet sent is dropped rather than sent on the
      // way down; a batch already going out finishes.
      indexNow.close();
      await indexNow.settled();
      await settleWrites();
      federationQueue?.close();

      if (running !== undefined) await closeServer(running, writes.refusing);

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
