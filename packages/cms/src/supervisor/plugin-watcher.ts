/**
 * The supervisor's watch on the plugins folder. It polls the
 * folder's signature, waits for it to stand still, since a copy into the
 * folder changes it many times, and then asks for a reload when what the
 * folder holds differs from what the serving worker loaded.
 *
 * It remembers what the last failed reload tried to load, so a folder left
 * broken is not reloaded over and over; a change to it is tried again.
 */

export interface PluginWatch {
  signature(): string;
  fingerprint(): string;
}

export const PLUGIN_POLL_MS = 1_000;
export const PLUGIN_SETTLE_MS = 5_000;

export interface PluginWatcherOptions {
  watch: PluginWatch | undefined;
  schedule(task: () => void, ms: number): { cancel(): void };
  now(): number;
  log(line: string): void;
  /** Whether a worker serves with no reload under way, so one may begin. */
  isServing(): boolean;
  /** Begin a reload to load `folder`. Called only while {@link isServing}. */
  reload(folder: string): void;
}

export interface PluginWatcher {
  start(): void;
  stop(): void;
  /** What the folder holds now: what a reload beginning now loads. */
  fingerprint(): string | undefined;
  /** A reload began that loads `folder`. */
  reloading(folder: string | undefined): void;
  /** A worker serves what it loaded. */
  loaded(plugins: string): void;
  /** The reload under way failed; its folder is left alone until it changes. */
  failed(): void;
}

export function createPluginWatcher(options: PluginWatcherOptions): PluginWatcher {
  const { watch } = options;
  let loaded: string | undefined;
  let reloading: string | undefined;
  let failed: string | undefined;
  /** The settled signature last checked against what is loaded, so a settled folder is read once. */
  let compared: string | undefined;
  /** The signature last read, and when it first read so. */
  let seen: { signature: string | undefined; since: number } = { signature: undefined, since: 0 };
  /** Whether the folder has been said to be changing since it last settled. */
  let changing = false;
  let polling: { cancel(): void } | undefined;

  function fingerprint(): string | undefined {
    return watch === undefined ? undefined : attempt(() => watch.fingerprint());
  }

  function poll(watch: PluginWatch): void {
    polling = options.schedule(() => {
      look(watch);
      poll(watch);
    }, PLUGIN_POLL_MS);
  }

  function look(watch: PluginWatch): void {
    const signature = attempt(() => watch.signature());
    if (hasSettled(signature)) considerReload(signature);
  }

  /** Whether the folder exists and has stood still, as `signature`, for the settle time. */
  function hasSettled(signature: string | undefined): signature is string {
    const now = options.now();
    if (signature !== seen.signature) {
      if (!changing) {
        changing = true;
        options.log(
          `The plugins folder is changing; it loads once it has stood still for ${String(PLUGIN_SETTLE_MS / 1000)} s.`,
        );
      }
      seen = { signature, since: now };
      return false;
    }
    if (signature === undefined) return false;
    if (now - seen.since < PLUGIN_SETTLE_MS) return false;
    changing = false;
    return true;
  }

  function considerReload(signature: string): void {
    if (!options.isServing() || signature === compared) return;
    const folder = fingerprint();
    if (folder === undefined) return;
    compared = signature;
    if (folder === loaded) return;
    if (folder === failed) {
      options.log(
        'The plugins folder is as it was when its reload failed, so it is left alone until it changes.',
      );
      return;
    }
    options.log('The plugins folder changed and has settled.');
    options.reload(folder);
  }

  return {
    start() {
      if (watch === undefined) return;
      seen = { signature: attempt(() => watch.signature()), since: options.now() };
      poll(watch);
    },
    stop() {
      polling?.cancel();
    },
    fingerprint,
    reloading(folder) {
      reloading = folder;
    },
    loaded(plugins) {
      loaded = plugins;
    },
    failed() {
      failed = reloading;
      compared = undefined;
    },
  };
}

function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
