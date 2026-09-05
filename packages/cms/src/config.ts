import path from 'node:path';

import type { KvStore, MessageQueue } from '@fedify/fedify';

import type { CommentChecker } from './comments/submission.ts';
import { KNOWN_UPLOAD_TYPES, normalizeUploadType } from './content/media.ts';
import { systemClock } from './content/store.ts';
import type { Clock } from './content/store.ts';
import type { DocumentChange } from './content/sync.ts';
import type { MailProvider } from './mail/provider.ts';
import type { MailLogger } from './mail/service.ts';

/**
 * Something a site wants to happen when the index changes.
 *
 * Whatever a hook returns is ignored, which is what the `unknown` return says:
 * `void` would have a linter reject an `async` hook, and `void | Promise<void>`
 * would have the compiler reject a one-expression hook like
 * `(change) => queue.push(change)`. A hook may therefore be `async`, and a
 * promise that rejects is caught and reported rather than left unhandled. The
 * CMS never waits for a hook, so a slow or broken subscriber can neither delay
 * nor wedge the watcher.
 */
export type DocumentChangeHook = (change: DocumentChange) => unknown;

/**
 * The federation stores and guards a site may swap, which decision-5 promised
 * would be configuration rather than a redesign.
 *
 * Everything here has a default that is right for a single-process personal
 * blog; a site only names one when it has outgrown that, and a test names one
 * when it needs the federation to behave predictably.
 */
export interface FederationOverrides {
  /**
   * Fedify's cache and idempotence store. Defaults to an in-memory one, per
   * decision-5: nothing that has to survive a restart lives in it.
   */
  kv?: KvStore | undefined;
  /**
   * The delivery and inbox queue. Defaults to Fedify's in-process one.
   *
   * `null` means no queue at all: an inbound activity is handled, and an
   * outbound one delivered, before the request that carried it is answered.
   * That is slower under load and has no retry, which is why it is not the
   * default, but it is the only way to know from outside when the work is
   * done — so it is what a test asks for.
   */
  queue?: MessageQueue | null | undefined;
  /**
   * Whether Fedify's document loader may fetch private and loopback
   * addresses. Off, as it must be in production: turning it on removes the
   * guard that stops a hostile actor id from making the server fetch its own
   * network. Tests that federate two make-believe hosts turn it on.
   */
  allowPrivateAddress?: boolean | undefined;
}

/**
 * The mail pieces a site may swap (TASK-53).
 *
 * Everything here has a default that is right for a personal blog: the
 * provider comes from the settings screen and `data/mail.json`, a refused
 * message is tried three times with a growing wait, and attempts go to the
 * console. A site names one of these when it has outgrown that, and a test
 * names them to read back the mail and to not wait for the backoff.
 */
export interface MailOverrides {
  /**
   * What carries the site's email.
   *
   * Naming one wins outright over the provider the settings screen chose and
   * the credential in `data/mail.json`, exactly as
   * {@link GeekityConfig.commentChecker} wins over the Akismet key: a site
   * that wrote a provider meant it. `createMemoryMailProvider()` is what a
   * test names here to read back the mail a feature would have sent.
   */
  provider?: MailProvider | undefined;
  /** How many times one message is tried. Defaults to three. */
  attempts?: number | undefined;
  /**
   * How long to wait before attempt `n + 1`, in milliseconds. Defaults to two
   * seconds, then eight, then eighteen. A test hands in `() => 0`.
   */
  backoffMs?: ((attempt: number) => number) | undefined;
  /** Where attempts are logged. Defaults to `console`. */
  logger?: MailLogger | undefined;
}

/**
 * What a site writes in `geekity.config.ts`. Every field is optional; see
 * {@link DEFAULT_PORT} and friends for what each one falls back to.
 */
export interface GeekityConfig {
  /** Port the HTTP server listens on. Default 3000. Overridden by `GEEKITY_PORT`, then `PORT`. */
  port?: number;
  /** Markdown content directory. Default `<cwd>/content`. Overridden by `GEEKITY_CONTENT_DIR`. */
  contentDir?: string;
  /** Directory for derived state such as the SQLite index. Default `<cwd>/data`. Overridden by `GEEKITY_DATA_DIR`. */
  dataDir?: string;
  /** Site template overrides, resolved before the packaged default theme. Default `<cwd>/theme`. Overridden by `GEEKITY_THEME_DIR`. */
  themeDir?: string;
  /** Public origin, used for canonical URLs, feeds and ActivityPub ids. Default `http://localhost:<port>`. Overridden by `GEEKITY_BASE_URL`. */
  baseUrl?: string;
  /**
   * Watch the content directory and keep the index in step with it while the
   * server runs. Default `true`. Turn it off for a one-shot sync or a host
   * whose content cannot change under the process. Overridden by `GEEKITY_WATCH`.
   */
  watch?: boolean;
  /**
   * How long an admin login lasts, in seconds. Default 14 days. Overridden by
   * `GEEKITY_SESSION_LIFETIME`. The clock starts when the session is created,
   * and an expired session is deleted rather than merely ignored.
   */
  sessionLifetime?: number;
  /**
   * Largest file the editor's upload endpoint accepts, in bytes. Default 10
   * MiB. Overridden by `GEEKITY_UPLOAD_MAX_BYTES`.
   */
  uploadMaxBytes?: number;
  /**
   * File extensions the upload endpoint accepts, with or without the leading
   * dot and in any case. Default: PNG, JPEG, GIF, WebP, AVIF, PDF, plain text
   * and Markdown. Overridden by `GEEKITY_UPLOAD_TYPES`, a comma-separated
   * list. Every entry has to be one the CMS knows a media type for; see
   * `KNOWN_UPLOAD_TYPES`.
   */
  uploadTypes?: string[];
  /**
   * Derive smaller and more modern copies of an uploaded raster image, and
   * serve the site's pages a `<picture>` that offers them. Default `true`.
   * Overridden by `GEEKITY_IMAGE_OPTIMIZATION`.
   *
   * Turning it off changes nothing on disk under `content/uploads/` — the
   * original was always the only source of truth (decision-10) — and nothing
   * about the feeds. The pages go back to the plain `<img>` the Markdown
   * asked for, and no encoding happens on upload.
   */
  imageOptimization?: boolean;
  /**
   * The widths variants are made at, in pixels. Default 320, 640, 960, 1280
   * and 1920, which is 11ty/image's own set. Overridden by
   * `GEEKITY_IMAGE_WIDTHS`, a comma-separated list.
   *
   * Nothing is ever upscaled: a width wider than the original is skipped, and
   * the original's own width is always added, so the `srcset` has a full-size
   * entry whatever the list says.
   */
  imageWidths?: number[];
  /**
   * The formats variants are made in, besides the original's own. Default
   * `['webp']`. Overridden by `GEEKITY_IMAGE_FORMATS`, a comma-separated list.
   *
   * The original's format is always generated too, because it is what the
   * `<img>` inside the `<picture>` falls back to; these are the `<source>`
   * elements in front of it, in the order they are given. AVIF is opt-in —
   * `['avif', 'webp']` — because its encoder is an order of magnitude slower
   * than WebP's and the encoding happens in the request that uploads the file.
   */
  imageFormats?: string[];
  /**
   * How many failed sign-ins a username or a client address may make before
   * the admin locks it out. Default 5. Overridden by `GEEKITY_LOGIN_ATTEMPTS`.
   */
  loginAttempts?: number;
  /**
   * How long the first lockout lasts, in seconds. Default 15 minutes. Each
   * further failure doubles the wait, up to sixteen times the first one.
   * Overridden by `GEEKITY_LOGIN_LOCKOUT`.
   */
  loginLockout?: number;
  /**
   * Whether an `X-Forwarded-For` header may be believed when the admin decides
   * which client address a failed login belongs to. Default `false`.
   * Overridden by `GEEKITY_TRUST_PROXY`.
   *
   * Off by default because anyone may send that header: believing it on a site
   * reached directly would let an attacker put every guess on a different
   * make-believe address and never be locked out at all. Turn it on only when
   * a reverse proxy in front of the site sets it.
   */
  trustProxy?: boolean;
  /**
   * Called for every `created`, `updated` and `deleted` the index records.
   *
   * The boot scan reports a cold index as a directory full of creations, so a
   * hook that must not re-fire on a rebuilt index should check
   * `change.origin !== 'scan'`.
   */
  onDocumentChange?: DocumentChangeHook;
  /**
   * Called when a document becomes visible on the public site: created live, a
   * draft published, or a document restored from the trash. Subject to the
   * same `origin` caveat as {@link GeekityConfig.onDocumentChange}.
   */
  onPublish?: DocumentChangeHook;
  /**
   * A third-party opinion on native comments: Akismet, or anything else that
   * answers the same three questions (TASK-50).
   *
   * The whole of the CMS's knowledge of such a service. It is asked about
   * every comment that gets past the honeypot, the form's age and the rate
   * limit, and its `spam`, `discard` and `ham` are the three things it can
   * say; a checker that throws is treated as having no opinion, so a service
   * that is down never stops a site taking comments. The moderation screen
   * tells it when a human disagrees.
   *
   * Naming one here wins outright over the Akismet checker the package ships
   * (TASK-52): `createCms` builds that only when this is not set, so a site
   * that wrote a checker gets the checker it wrote whether or not there is a
   * key in `data/akismet.json`.
   */
  commentChecker?: CommentChecker;
  /**
   * How the site sends email (TASK-53). Every field has a default; see
   * {@link MailOverrides}.
   */
  mail?: MailOverrides;
  /**
   * What the CMS reads the time from.
   *
   * A post's date decides whether it is public yet (TASK-44), so the index and
   * the scheduler both need a clock, and it is one clock so they cannot
   * disagree. Defaults to {@link systemClock}. A site has no reason to name
   * one; a test that wants to be somewhere else in time does.
   */
  now?: Clock;
  /**
   * Federation stores and guards. Every field has a default; see
   * {@link FederationOverrides}.
   */
  federation?: FederationOverrides;
}

/**
 * A {@link GeekityConfig} with every field filled in and every path absolute.
 *
 * The two hooks are the exception to "filled in": they have no default, so
 * they are present and `undefined` when the site named neither.
 */
export interface ResolvedConfig {
  port: number;
  contentDir: string;
  dataDir: string;
  themeDir: string;
  baseUrl: string;
  /**
   * Where {@link ResolvedConfig.baseUrl} came from.
   *
   * `default` means nobody named one and it is the `http://localhost:<port>`
   * fallback, which is what lets the admin's settings screen offer a base URL
   * of its own: an `environment` or `config` value is a deployment fact and
   * wins over the `url` in `content/_data/site.json`.
   */
  baseUrlSource: 'environment' | 'config' | 'default';
  watch: boolean;
  sessionLifetime: number;
  uploadMaxBytes: number;
  /** Normalised: lower case, each with its leading dot. */
  uploadTypes: string[];
  imageOptimization: boolean;
  /** Ascending and without repeats. */
  imageWidths: number[];
  /** Normalised: lower case, in the order the `<source>` elements go. */
  imageFormats: string[];
  loginAttempts: number;
  loginLockout: number;
  trustProxy: boolean;
  onDocumentChange: DocumentChangeHook | undefined;
  onPublish: DocumentChangeHook | undefined;
  /**
   * The comment checker, when the site named one.
   *
   * `undefined` as this leaves {@link resolveConfig}. `createCms` fills it in
   * with the Akismet checker (TASK-52) when the site named none, so by the
   * time a request reads it off the context there is one — and with no key in
   * `data/akismet.json` that one sends nothing anywhere.
   */
  commentChecker: CommentChecker | undefined;
  /** Mail overrides, empty when the site named none. */
  mail: MailOverrides;
  /** The clock the index and the scheduler read. */
  now: Clock;
  /** Federation stores and guards, empty when the site named none. */
  federation: FederationOverrides;
}

/** Ambient inputs {@link resolveConfig} reads, injectable so the resolution is testable. */
export interface ResolveConfigContext {
  /** Directory relative paths resolve against. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Environment to read overrides from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

export const DEFAULT_PORT = 3000;
export const DEFAULT_CONTENT_DIR = 'content';
export const DEFAULT_DATA_DIR = 'data';
export const DEFAULT_THEME_DIR = 'theme';
/** How long an admin login lasts by default: fourteen days, in seconds. */
export const DEFAULT_SESSION_LIFETIME = 14 * 24 * 60 * 60;
/** Largest upload a site accepts by default: ten mebibytes. */
export const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/**
 * What the editor may upload by default: the raster image formats a browser
 * displays, PDFs, and the two text formats. Everything the CMS knows about
 * except SVG, which is script-bearing markup served from the site's own origin
 * and so is opt-in.
 */
export const DEFAULT_UPLOAD_TYPES: readonly string[] = KNOWN_UPLOAD_TYPES;
/**
 * The widths an image is offered at by default.
 *
 * These are 11ty/image's own defaults, and deliberately so: decision-10 makes
 * that plugin the reference for the markup and the width set, so a site that
 * builds the same `content/` with Eleventy and runs the plugin over the same
 * originals gets an equivalent `srcset` rather than a different one.
 */
export const DEFAULT_IMAGE_WIDTHS: readonly number[] = [320, 640, 960, 1280, 1920];
/** The derived formats a site gets without asking. AVIF is not one; see {@link GeekityConfig.imageFormats}. */
export const DEFAULT_IMAGE_FORMATS: readonly string[] = ['webp'];
/**
 * The formats a site may ask for.
 *
 * Every one of them is something sharp can write and every browser that
 * matters can read. There is no `gif` and no `svg`: an animated GIF cannot
 * survive being resized frame by frame into a still, and an SVG has no
 * intrinsic pixels to resize at all, so neither is ever varianted.
 */
export const KNOWN_IMAGE_FORMATS: readonly string[] = ['avif', 'jpeg', 'png', 'webp'];
/** Failed sign-ins allowed before the admin locks a username or an address out. */
export const DEFAULT_LOGIN_ATTEMPTS = 5;
/** How long the first lockout lasts by default: a quarter of an hour, in seconds. */
export const DEFAULT_LOGIN_LOCKOUT = 15 * 60;

/**
 * Identity helper that gives a `geekity.config.ts` file type checking and
 * completion without the site importing the type by hand.
 */
export function defineConfig(config: GeekityConfig): GeekityConfig {
  return config;
}

/**
 * Merge a site's config with environment overrides and defaults.
 *
 * Precedence is environment variable, then config file, then default. Relative
 * directories resolve against `cwd`; absolute ones are left alone.
 */
export function resolveConfig(
  config: GeekityConfig = {},
  context: ResolveConfigContext = {},
): ResolvedConfig {
  const cwd = context.cwd ?? process.cwd();
  const env = context.env ?? process.env;

  const port = resolvePort(config.port, env);

  return {
    port,
    contentDir: resolveDir(cwd, env['GEEKITY_CONTENT_DIR'], config.contentDir, DEFAULT_CONTENT_DIR),
    dataDir: resolveDir(cwd, env['GEEKITY_DATA_DIR'], config.dataDir, DEFAULT_DATA_DIR),
    themeDir: resolveDir(cwd, env['GEEKITY_THEME_DIR'], config.themeDir, DEFAULT_THEME_DIR),
    baseUrl: resolveBaseUrl(env['GEEKITY_BASE_URL'], config.baseUrl, port),
    baseUrlSource: baseUrlSource(env['GEEKITY_BASE_URL'], config.baseUrl),
    watch: resolveBoolean('GEEKITY_WATCH', env['GEEKITY_WATCH'], config.watch, true),
    sessionLifetime: resolveSessionLifetime(
      env['GEEKITY_SESSION_LIFETIME'],
      config.sessionLifetime,
    ),
    uploadMaxBytes: resolveUploadMaxBytes(env['GEEKITY_UPLOAD_MAX_BYTES'], config.uploadMaxBytes),
    uploadTypes: resolveUploadTypes(env['GEEKITY_UPLOAD_TYPES'], config.uploadTypes),
    imageOptimization: resolveBoolean(
      'GEEKITY_IMAGE_OPTIMIZATION',
      env['GEEKITY_IMAGE_OPTIMIZATION'],
      config.imageOptimization,
      true,
    ),
    imageWidths: resolveImageWidths(env['GEEKITY_IMAGE_WIDTHS'], config.imageWidths),
    imageFormats: resolveImageFormats(env['GEEKITY_IMAGE_FORMATS'], config.imageFormats),
    loginAttempts: resolveCount(
      'GEEKITY_LOGIN_ATTEMPTS',
      'loginAttempts',
      env['GEEKITY_LOGIN_ATTEMPTS'],
      config.loginAttempts,
      DEFAULT_LOGIN_ATTEMPTS,
    ),
    loginLockout: resolveCount(
      'GEEKITY_LOGIN_LOCKOUT',
      'loginLockout',
      env['GEEKITY_LOGIN_LOCKOUT'],
      config.loginLockout,
      DEFAULT_LOGIN_LOCKOUT,
    ),
    trustProxy: resolveBoolean(
      'GEEKITY_TRUST_PROXY',
      env['GEEKITY_TRUST_PROXY'],
      config.trustProxy,
      false,
    ),
    onDocumentChange: config.onDocumentChange,
    onPublish: config.onPublish,
    commentChecker: config.commentChecker,
    mail: config.mail ?? {},
    now: config.now ?? systemClock,
    federation: config.federation ?? {},
  };
}

/** Bytes, a positive whole number of them. */
function resolveUploadMaxBytes(
  fromEnv: string | undefined,
  configured: number | undefined,
): number {
  if (fromEnv !== undefined && fromEnv !== '') {
    const parsed = Number(fromEnv);
    if (!isValidByteCount(parsed)) {
      throw new TypeError(
        `GEEKITY_UPLOAD_MAX_BYTES must be a positive whole number of bytes, received ${JSON.stringify(fromEnv)}`,
      );
    }
    return parsed;
  }

  if (configured === undefined) return DEFAULT_UPLOAD_MAX_BYTES;
  if (!isValidByteCount(configured)) {
    throw new TypeError(
      `config.uploadMaxBytes must be a positive whole number of bytes, received ${JSON.stringify(configured)}`,
    );
  }
  return configured;
}

function isValidByteCount(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * An upload allowlist, normalised and checked.
 *
 * A name the CMS has no media type for is refused rather than ignored: a
 * config that says `.svg` and silently gets nothing would be a config that
 * lies, and a typo in an allowlist is worth hearing about at boot.
 */
function resolveUploadTypes(
  fromEnv: string | undefined,
  configured: string[] | undefined,
): string[] {
  if (fromEnv !== undefined && fromEnv !== '') {
    return checkedUploadTypes(fromEnv.split(','), 'GEEKITY_UPLOAD_TYPES');
  }
  if (configured === undefined) return [...DEFAULT_UPLOAD_TYPES];
  return checkedUploadTypes(configured, 'config.uploadTypes');
}

function checkedUploadTypes(values: string[], source: string): string[] {
  const types: string[] = [];
  for (const value of values) {
    const normalized = normalizeUploadType(value);
    if (normalized === '') continue;
    if (!KNOWN_UPLOAD_TYPES.includes(normalized)) {
      throw new TypeError(
        `${source} names ${JSON.stringify(normalized)}, which the CMS has no media type for. It knows ${KNOWN_UPLOAD_TYPES.join(', ')}.`,
      );
    }
    if (!types.includes(normalized)) types.push(normalized);
  }
  return types;
}

/**
 * A width set, checked and put in order.
 *
 * Ascending and deduplicated because the `srcset` it becomes is read by a
 * browser picking the first entry wide enough, and because two identical
 * widths would be two encodes of the same picture.
 */
function resolveImageWidths(
  fromEnv: string | undefined,
  configured: number[] | undefined,
): number[] {
  if (fromEnv !== undefined && fromEnv !== '') {
    return checkedImageWidths(
      fromEnv
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== '')
        .map(Number),
      'GEEKITY_IMAGE_WIDTHS',
    );
  }
  if (configured === undefined) return [...DEFAULT_IMAGE_WIDTHS];
  return checkedImageWidths(configured, 'config.imageWidths');
}

function checkedImageWidths(values: number[], source: string): number[] {
  const widths = new Set<number>();
  for (const value of values) {
    if (!isValidCount(value)) {
      throw new TypeError(
        `${source} must be positive whole numbers of pixels, received ${JSON.stringify(value)}`,
      );
    }
    widths.add(value);
  }
  return [...widths].sort((a, b) => a - b);
}

/**
 * A format set, checked and normalised.
 *
 * A name sharp cannot write is refused rather than dropped, for the reason an
 * unknown upload type is: a config that silently produced nothing would be a
 * config that lies about what the site is serving.
 */
function resolveImageFormats(
  fromEnv: string | undefined,
  configured: string[] | undefined,
): string[] {
  if (fromEnv !== undefined && fromEnv !== '') {
    return checkedImageFormats(fromEnv.split(','), 'GEEKITY_IMAGE_FORMATS');
  }
  if (configured === undefined) return [...DEFAULT_IMAGE_FORMATS];
  return checkedImageFormats(configured, 'config.imageFormats');
}

function checkedImageFormats(values: string[], source: string): string[] {
  const formats: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (normalized === '') continue;
    if (!KNOWN_IMAGE_FORMATS.includes(normalized)) {
      throw new TypeError(
        `${source} names ${JSON.stringify(normalized)}, which is not a format the CMS writes. It knows ${KNOWN_IMAGE_FORMATS.join(', ')}.`,
      );
    }
    if (!formats.includes(normalized)) formats.push(normalized);
  }
  return formats;
}

/** `true`, `1`, `yes` and `on` mean yes; `false`, `0`, `no` and `off` mean no. */
function resolveBoolean(
  variable: string,
  fromEnv: string | undefined,
  configured: boolean | undefined,
  fallback: boolean,
): boolean {
  if (fromEnv !== undefined && fromEnv !== '') {
    const normalized = fromEnv.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    throw new TypeError(
      `${variable} must be a boolean such as true or false, received ${JSON.stringify(fromEnv)}`,
    );
  }
  return configured ?? fallback;
}

/** A positive whole number, from the environment, the config or the default. */
function resolveCount(
  variable: string,
  field: string,
  fromEnv: string | undefined,
  configured: number | undefined,
  fallback: number,
): number {
  if (fromEnv !== undefined && fromEnv !== '') {
    const parsed = Number(fromEnv);
    if (!isValidCount(parsed)) {
      throw new TypeError(
        `${variable} must be a positive whole number, received ${JSON.stringify(fromEnv)}`,
      );
    }
    return parsed;
  }

  if (configured === undefined) return fallback;
  if (!isValidCount(configured)) {
    throw new TypeError(
      `config.${field} must be a positive whole number, received ${JSON.stringify(configured)}`,
    );
  }
  return configured;
}

function isValidCount(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** Seconds, positive and finite. Fractions are allowed; zero and below are not. */
function resolveSessionLifetime(
  fromEnv: string | undefined,
  configured: number | undefined,
): number {
  if (fromEnv !== undefined && fromEnv !== '') {
    const parsed = Number(fromEnv);
    if (!isValidLifetime(parsed)) {
      throw new TypeError(
        `GEEKITY_SESSION_LIFETIME must be a positive number of seconds, received ${JSON.stringify(fromEnv)}`,
      );
    }
    return parsed;
  }

  if (configured === undefined) return DEFAULT_SESSION_LIFETIME;
  if (!isValidLifetime(configured)) {
    throw new TypeError(
      `config.sessionLifetime must be a positive number of seconds, received ${JSON.stringify(configured)}`,
    );
  }
  return configured;
}

function isValidLifetime(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function resolvePort(
  configured: number | undefined,
  env: Record<string, string | undefined>,
): number {
  const fromEnv = env['GEEKITY_PORT'] ?? env['PORT'];
  if (fromEnv !== undefined && fromEnv !== '') {
    const parsed = Number(fromEnv);
    if (!isValidPort(parsed)) {
      throw new TypeError(
        `GEEKITY_PORT/PORT must be an integer between 0 and 65535, received ${JSON.stringify(fromEnv)}`,
      );
    }
    return parsed;
  }

  if (configured === undefined) return DEFAULT_PORT;
  if (!isValidPort(configured)) {
    throw new TypeError(
      `config.port must be an integer between 0 and 65535, received ${JSON.stringify(configured)}`,
    );
  }
  return configured;
}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 65535;
}

function resolveDir(
  cwd: string,
  fromEnv: string | undefined,
  configured: string | undefined,
  fallback: string,
): string {
  const chosen = firstNonEmpty(fromEnv, configured) ?? fallback;
  return path.resolve(cwd, chosen);
}

/** Which of the two doors named the base URL, if either did. */
function baseUrlSource(
  fromEnv: string | undefined,
  configured: string | undefined,
): 'environment' | 'config' | 'default' {
  if (fromEnv !== undefined && fromEnv !== '') return 'environment';
  if (configured !== undefined && configured !== '') return 'config';
  return 'default';
}

function resolveBaseUrl(
  fromEnv: string | undefined,
  configured: string | undefined,
  port: number,
): string {
  const chosen = firstNonEmpty(fromEnv, configured);
  if (chosen === undefined) return `http://localhost:${port}`;

  let parsed: URL;
  try {
    parsed = new URL(chosen);
  } catch {
    throw new TypeError(
      `config.baseUrl must be an absolute URL, received ${JSON.stringify(chosen)}`,
    );
  }
  return parsed.origin + stripTrailingSlash(parsed.pathname);
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}
