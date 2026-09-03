import path from 'node:path';

import { KNOWN_UPLOAD_TYPES, normalizeUploadType } from './content/media.ts';
import type { DocumentChange } from './content/sync.ts';

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
   * Called for every `created`, `updated` and `deleted` the index records.
   *
   * The boot scan reports a cold index as a directory full of creations, so a
   * hook that must not re-fire on a rebuilt index should check
   * `change.origin === 'watch'`.
   */
  onDocumentChange?: DocumentChangeHook;
  /**
   * Called when a document becomes visible on the public site: created live, a
   * draft published, or a document restored from the trash. Subject to the
   * same `origin` caveat as {@link GeekityConfig.onDocumentChange}.
   */
  onPublish?: DocumentChangeHook;
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
   * wins over anything stored in SQLite.
   */
  baseUrlSource: 'environment' | 'config' | 'default';
  watch: boolean;
  sessionLifetime: number;
  uploadMaxBytes: number;
  /** Normalised: lower case, each with its leading dot. */
  uploadTypes: string[];
  onDocumentChange: DocumentChangeHook | undefined;
  onPublish: DocumentChangeHook | undefined;
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
    watch: resolveWatch(env['GEEKITY_WATCH'], config.watch),
    sessionLifetime: resolveSessionLifetime(
      env['GEEKITY_SESSION_LIFETIME'],
      config.sessionLifetime,
    ),
    uploadMaxBytes: resolveUploadMaxBytes(env['GEEKITY_UPLOAD_MAX_BYTES'], config.uploadMaxBytes),
    uploadTypes: resolveUploadTypes(env['GEEKITY_UPLOAD_TYPES'], config.uploadTypes),
    onDocumentChange: config.onDocumentChange,
    onPublish: config.onPublish,
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

/** `true`, `1`, `yes` and `on` mean yes; `false`, `0`, `no` and `off` mean no. */
function resolveWatch(fromEnv: string | undefined, configured: boolean | undefined): boolean {
  if (fromEnv !== undefined && fromEnv !== '') {
    const normalized = fromEnv.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    throw new TypeError(
      `GEEKITY_WATCH must be a boolean such as true or false, received ${JSON.stringify(fromEnv)}`,
    );
  }
  return configured ?? true;
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
