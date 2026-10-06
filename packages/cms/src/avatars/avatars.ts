import { createHash } from 'node:crypto';
import { readdir, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import type { AdminStore } from '../admin/store.ts';
import type { ResolvedConfig } from '../config.ts';
import { writeFileAtomically } from '../files/atomic.ts';
import type { NotificationTimers } from '../notifications/digest.ts';
import { systemNotificationTimers } from '../notifications/digest.ts';
import { findAsset } from '../web/assets.ts';
import type { StaticAsset } from '../web/assets.ts';
import { fetchPublic, webUrl } from '../webmention/fetch-public.ts';

/**
 * Remote avatars, served from this site (TASK-134).
 *
 * A face in a facepile is somebody else's picture on somebody else's server.
 * Hotlinked, every reader who opens a post sends that server their address
 * and their user agent. So a page never names the remote URL: it names
 * `/_geekity/avatars/<key>`, and this module fetches the picture, shrinks it to
 * the size the theme shows it at and keeps the result.
 *
 * The key is the source URL itself, base64url-encoded, and it is only a
 * spelling: a request is answered only when the index says the URL is an
 * avatar the site has recorded ({@link AdminStore.isAvatarSource}). Anything
 * else is a 404 that fetches nothing, so this is not an open proxy, and there
 * is no table or secret to lose.
 *
 * The files under `<dataDir>/avatars/` are a disposable cache (decision-9):
 * every one of them is named by the hash of a URL the index holds and can be
 * fetched again. A sweep on a timer fetches the ones that are missing or old
 * and removes the ones nobody shows any more, so a page is almost never the
 * thing that waits on a stranger's server.
 */

/** Where an avatar is served, followed by its key. */
export const AVATAR_PATH_PREFIX = '/_geekity/avatars/';

/** The directory under `dataDir` the cache lives in. */
export const AVATAR_DIRECTORY = 'avatars';

/**
 * The width and height of a cached avatar, in pixels: twice the 40 the
 * default theme shows a commenter at, so it is sharp on a high-density screen,
 * and the facepile's 32 is a downscale of it.
 */
export const AVATAR_SIZE = 80;

/** The largest picture that is read. A bigger one is the placeholder. */
export const AVATAR_MAX_BYTES = 2_000_000;

/** How long one fetch is given, body included. */
export const AVATAR_FETCH_TIMEOUT_MS = 10_000;

/**
 * How long the first request for a picture nobody has fetched yet waits for
 * it before it is answered with the placeholder. The fetch carries on and the
 * next request gets the picture.
 */
export const AVATAR_FIRST_VIEW_WAIT_MS = 2_000;

/** How old a cached picture gets before the sweep fetches it again. */
export const AVATAR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a URL that could not be fetched is left alone. */
export const AVATAR_RETRY_MS = 60 * 60 * 1000;

/** How often the sweep runs. */
export const AVATAR_SWEEP_MS = 6 * 60 * 60 * 1000;

/** How long a browser keeps a picture, in seconds. */
export const AVATAR_MAX_AGE_SECONDS = 86_400;

/** How long a browser keeps the placeholder, so the next view asks again. */
export const AVATAR_PLACEHOLDER_MAX_AGE_SECONDS = 300;

/** What a picture with no fetched face is: a grey head and shoulders. */
export const AVATAR_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><rect width="80" height="80" fill="#d7d7d7"/><circle cx="40" cy="31" r="15" fill="#f5f5f5"/><path d="M12 80c0-17 12.5-27 28-27s28 10 28 27z" fill="#f5f5f5"/></svg>\n`;

/** The content types a picture may arrive as. SVG is not one: it is a document. */
const ACCEPTED_TYPES = /^\s*image\/(jpeg|png|gif|webp|avif)\s*(;|$)/i;

/** What sharp must find the bytes to be, whatever the header said. AVIF reads as `heif`. */
const ACCEPTED_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'gif', 'webp', 'heif']);

/** The most pixels a picture may have before sharp will not decode it. */
const MAX_INPUT_PIXELS = 4096 * 4096;

/** The same-origin URL a theme is handed for an avatar at `source`. */
export function avatarHref(source: string): string {
  return `${AVATAR_PATH_PREFIX}${Buffer.from(source, 'utf8').toString('base64url')}`;
}

/** The source URL a key spells, or `undefined` when it spells no web URL. */
export function avatarSourceOf(key: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return undefined;
  const source = Buffer.from(key, 'base64url').toString('utf8');
  // The key has to be the one `avatarHref` would mint, so one URL has one key
  // and one cached file.
  if (avatarHref(source) !== `${AVATAR_PATH_PREFIX}${key}`) return undefined;
  return webUrl(source) === undefined ? undefined : source;
}

/** What a request for an avatar is answered with. */
export type AvatarAnswer =
  | { readonly kind: 'image'; readonly asset: StaticAsset }
  | { readonly kind: 'placeholder' }
  | { readonly kind: 'unknown' };

/** Where the service reports a picture it could not fetch. */
export interface AvatarLogger {
  warn(message: string): void;
}

/** What {@link createAvatarService} needs. */
export interface CreateAvatarServiceOptions {
  /** The index, asked which URLs are avatars the site shows. */
  readonly admin: Pick<AdminStore, 'isAvatarSource' | 'listAvatarSources'>;
  /** The data directory the cache lives in, the resolver and the clock. */
  readonly config: Pick<ResolvedConfig, 'dataDir' | 'hostLookup' | 'now'>;
  /** Defaults to the real interval timer. */
  readonly timers?: NotificationTimers | undefined;
  /** Defaults to {@link AVATAR_FIRST_VIEW_WAIT_MS}. */
  readonly firstViewWaitMs?: number | undefined;
  /** Defaults to `console`. */
  readonly logger?: AvatarLogger | undefined;
}

/** Fetches, shrinks, keeps and serves the avatars the site shows. */
export interface AvatarService {
  /**
   * The answer to a request for the avatar at `source`: the cached picture,
   * the placeholder when there is none to be had yet, or `unknown` for a URL
   * the site has not recorded. Fetches only for a recorded URL with nothing
   * cached, and waits for that fetch no longer than the first-view bound.
   */
  answer(source: string): Promise<AvatarAnswer>;
  /**
   * Fetch every recorded avatar that is missing or older than
   * {@link AVATAR_MAX_AGE_MS}, and delete every cached file no recorded URL
   * names. Queued behind any sweep already running.
   */
  sweep(): Promise<void>;
  /** Sweep now and then every {@link AVATAR_SWEEP_MS}. Safe twice. */
  start(): void;
  /** Stop the timer. Safe before starting and safe twice. */
  stop(): void;
  /** Resolve once every fetch and sweep in flight has finished. */
  settled(): Promise<void>;
}

/** Build the avatar service for one site. */
export function createAvatarService(options: CreateAvatarServiceOptions): AvatarService {
  const { admin, config } = options;
  const timers = options.timers ?? systemNotificationTimers;
  const firstViewWaitMs = options.firstViewWaitMs ?? AVATAR_FIRST_VIEW_WAIT_MS;
  const logger = options.logger ?? console;
  const directory = path.join(config.dataDir, AVATAR_DIRECTORY);

  const inFlight = new Map<string, Promise<boolean>>();
  let sweeping: Promise<void> = Promise.resolve();
  let handle: unknown;

  const imageName = (source: string): string => `${hashOf(source)}.webp`;
  const failedName = (source: string): string => `${hashOf(source)}.failed`;

  /** How long ago a cache file was written, or `undefined` when there is none. */
  async function ageOf(name: string): Promise<number | undefined> {
    try {
      return config.now().getTime() - (await stat(path.join(directory, name))).mtimeMs;
    } catch {
      return undefined;
    }
  }

  /** Fetch one picture into the cache, once at a time per URL. */
  function refresh(source: string): Promise<boolean> {
    const running = inFlight.get(source);
    if (running !== undefined) return running;

    const started = fetchInto(source).finally(() => inFlight.delete(source));
    inFlight.set(source, started);
    return started;
  }

  async function fetchInto(source: string): Promise<boolean> {
    const shrunk = await fetchAvatar(source, config);
    if (!shrunk.ok) {
      logger.warn(`Could not fetch the avatar at ${source}: ${shrunk.reason}`);
      await touch(path.join(directory, failedName(source)), config.now());
      return false;
    }
    await writeFileAtomically(path.join(directory, imageName(source)), shrunk.image);
    // The write is stamped with the site's clock rather than the machine's, so
    // the age the sweep reads is the one the rest of the site agrees on.
    const at = config.now();
    await utimes(path.join(directory, imageName(source)), at, at);
    await rm(path.join(directory, failedName(source)), { force: true });
    return true;
  }

  async function sweepOnce(): Promise<void> {
    const sources = admin.listAvatarSources();
    const keep = new Set<string>();

    for (const source of sources) {
      keep.add(imageName(source));
      keep.add(failedName(source));
      if (webUrl(source) === undefined) continue;

      const age = await ageOf(imageName(source));
      if (age !== undefined && age < AVATAR_MAX_AGE_MS) continue;
      const failedAge = await ageOf(failedName(source));
      if (age === undefined && failedAge !== undefined && failedAge < AVATAR_RETRY_MS) continue;
      await refresh(source);
    }

    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return;
    }
    for (const name of names) {
      if (!keep.has(name)) await rm(path.join(directory, name), { force: true });
    }
  }

  function cached(source: string): StaticAsset | undefined {
    return findAsset(imageName(source), [directory]);
  }

  return {
    async answer(source) {
      if (webUrl(source) === undefined || !admin.isAvatarSource(source)) {
        return { kind: 'unknown' };
      }

      const held = cached(source);
      if (held !== undefined) return { kind: 'image', asset: held };

      const failedAge = await ageOf(failedName(source));
      if (failedAge !== undefined && failedAge < AVATAR_RETRY_MS && !inFlight.has(source)) {
        return { kind: 'placeholder' };
      }

      const fetched = await within(refresh(source), firstViewWaitMs);
      const now = fetched === true ? cached(source) : undefined;
      return now === undefined ? { kind: 'placeholder' } : { kind: 'image', asset: now };
    },

    sweep() {
      const next = sweeping.then(sweepOnce).catch((thrown: unknown) => {
        logger.warn(`The avatar sweep failed: ${messageOf(thrown)}`);
      });
      sweeping = next;
      return next;
    },

    start() {
      if (handle !== undefined) return;
      void this.sweep();
      handle = timers.set(() => void this.sweep(), AVATAR_SWEEP_MS);
    },

    stop() {
      if (handle !== undefined) timers.clear(handle);
      handle = undefined;
    },

    async settled() {
      await sweeping;
      await Promise.all([...inFlight.values()]);
    },
  };
}

/** What fetching and shrinking one picture came to. */
type AvatarFetch =
  | { readonly ok: true; readonly image: Uint8Array }
  | { readonly ok: false; readonly reason: string };

/**
 * Fetch the picture at `source` and shrink it to {@link AVATAR_SIZE} square,
 * as WebP. Its bytes are decoded and encoded again, so nothing but pixels of
 * the stranger's file reaches a reader: no metadata, no second image, no
 * script.
 */
async function fetchAvatar(
  source: string,
  config: Pick<ResolvedConfig, 'hostLookup'>,
): Promise<AvatarFetch> {
  const fetched = await fetchPublic(source, {
    lookup: config.hostLookup,
    signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
    maxBytes: AVATAR_MAX_BYTES,
    accept: 'image/avif, image/webp, image/png, image/jpeg, image/gif;q=0.8',
    contentType: { pattern: ACCEPTED_TYPES, name: 'a JPEG, PNG, GIF, WebP or AVIF picture' },
  });
  if (!fetched.ok) return fetched;

  try {
    const decoder = sharp(fetched.body, { autoOrient: true, limitInputPixels: MAX_INPUT_PIXELS });
    const { format } = await decoder.metadata();
    if (format === undefined || !ACCEPTED_FORMATS.has(format)) {
      return { ok: false, reason: `a ${String(format)} file, not a picture this site shows` };
    }
    const image = await decoder
      .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, fit: 'cover', position: 'centre' })
      .webp({ quality: 80 })
      .toBuffer();
    return { ok: true, image };
  } catch (thrown) {
    return { ok: false, reason: `not a readable picture: ${messageOf(thrown)}` };
  }
}

/** The cache file name for one URL: nothing a request can choose. */
function hashOf(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

/** Create an empty file, or move its modification time to `at`. */
async function touch(file: string, at: Date): Promise<void> {
  await writeFileAtomically(file, '');
  await utimes(file, at, at);
}

/** What `promise` resolved to within `ms`, else `undefined`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      resolve(undefined);
    }, ms);
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}
