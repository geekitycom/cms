export interface PluginWatch {
  signature(): string;
  fingerprint(): string;
}

export const PLUGIN_POLL_MS = 1_000;
export const PLUGIN_SETTLE_MS = 5_000;

export interface PluginWatcherOptions {
  watch: PluginWatch | undefined;
  settleMs?: number | undefined;
  schedule(task: () => void, ms: number): { cancel(): void };
  now(): number;
  log(line: string): void;
  isServing(): boolean;
  reload(folder: string): void;
}

export interface PluginWatcher {
  start(): void;
  stop(): void;
  fingerprint(): string | undefined;
  reloading(folder: string | undefined): void;
  loaded(plugins: string): void;
  failed(): void;
}

export function createPluginWatcher(options: PluginWatcherOptions): PluginWatcher {
  const { watch, settleMs = PLUGIN_SETTLE_MS } = options;
  let loaded: string | undefined;
  let reloading: string | undefined;
  let failed: string | undefined;
  let compared: string | undefined;
  let seen: { signature: string | undefined; since: number } = { signature: undefined, since: 0 };
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

  function hasSettled(signature: string | undefined): signature is string {
    const now = options.now();
    if (signature !== seen.signature) {
      if (!changing) {
        changing = true;
        options.log(
          `The plugins folder is changing; it loads once it has stood still for ${String(settleMs / 1000)} s.`,
        );
      }
      seen = { signature, since: now };
      return false;
    }
    if (signature === undefined) return false;
    if (now - seen.since < settleMs) return false;
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
