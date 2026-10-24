import { randomUUID } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';

import { messageOf } from '../util/errors.ts';
import { isWalkableDirectory } from './content-tree.ts';
import type { SyncLogger } from './sync.ts';
import { watchTree } from './tree-watch.ts';
import type { TreeWatcher } from './tree-watch.ts';
import type { WatchDebounce } from './watch-debounce.ts';

const PROBE_PREFIX = '.geekity-watch-';

const PROBE_INTERVAL_MS = 250;

const PROBE_DEADLINE_MS = 5_000;

export interface ContentWatcher {
  start(): Promise<void>;
  stop(): void;
  waiting(): number;
}

export interface CreateContentWatcherOptions {
  contentDir: string;
  logger: SyncLogger;
  debounce: WatchDebounce;
  onSettledPath: (relativePath: string) => void;
}

export function createContentWatcher(options: CreateContentWatcherOptions): ContentWatcher {
  const { contentDir, logger, debounce, onSettledPath } = options;
  const pending = new Map<string, () => void>();
  let watcher: TreeWatcher | undefined;

  function handle(relativePath: string): void {
    pending.get(relativePath)?.();
    pending.set(
      relativePath,
      debounce(relativePath, () => {
        pending.delete(relativePath);
        onSettledPath(relativePath);
      }),
    );
  }

  async function start(): Promise<void> {
    if (watcher !== undefined) return;
    await mkdir(contentDir, { recursive: true });

    const started = watchTree(contentDir, { ignore: isIgnored });
    watcher = started;

    started.on('change', (_type: string, relativePath: string | null) => {
      if (relativePath === null) {
        handle('');
        return;
      }
      if (!path.basename(relativePath).startsWith(PROBE_PREFIX)) handle(relativePath);
    });
    started.on('error', (error: unknown) => {
      logger.warn(`Content watcher error: ${messageOf(error)}`);
    });

    await started.ready;
    if (!(await hearsChanges(started, contentDir, logger))) {
      logger.warn(
        `The content watcher reported nothing for ${PROBE_DEADLINE_MS / 1000}s, so a file changed while the site runs may not show until it restarts.`,
      );
    }
  }

  return {
    start,

    stop() {
      for (const cancel of pending.values()) cancel();
      pending.clear();
      watcher?.close();
      watcher = undefined;
    },

    waiting() {
      return pending.size;
    },
  };
}

/**
 * Whether the watch reports changes yet, learned by making one: macOS
 * starts reporting a moment after the watch returns, and a change made
 * before then is never reported, so the boot scan waits for this.
 */
async function hearsChanges(
  started: TreeWatcher,
  contentDir: string,
  logger: SyncLogger,
): Promise<boolean> {
  const deadline = Date.now() + PROBE_DEADLINE_MS;
  while (Date.now() < deadline) {
    const probe = `${PROBE_PREFIX}${randomUUID()}`;
    const heard = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        started.off('change', listener);
        resolve(false);
      }, PROBE_INTERVAL_MS);
      function listener(_type: string, filename: string | null): void {
        if (filename === null || path.basename(filename) !== probe) return;
        clearTimeout(timer);
        started.off('change', listener);
        resolve(true);
      }
      started.on('change', listener);
    });
    const probePath = path.join(contentDir, probe);
    try {
      await mkdir(probePath);
    } catch (error) {
      logger.warn(
        `The content directory cannot be written, so whether the watcher reports changes was not checked: ${messageOf(error)}`,
      );
      return true;
    }
    const wasHeard = await heard;
    await rmdir(probePath);
    if (wasHeard) return true;
  }
  return false;
}

function isIgnored(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, '/').split('/');
  const name = segments.at(-1) as string;
  if (segments.slice(0, -1).some((segment) => !isWalkableDirectory(segment))) return true;
  if (segments.length === 1 && name.startsWith(PROBE_PREFIX)) return false;
  return !isWalkableDirectory(name);
}
