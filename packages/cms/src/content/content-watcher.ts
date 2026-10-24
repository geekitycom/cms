import { randomUUID } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';

import { messageOf } from '../util/errors.ts';
import { isWalkableDirectory } from './content-tree.ts';
import type { SyncLogger } from './sync.ts';
import { watchTree } from './tree-watch.ts';
import type { TreeWatcher } from './tree-watch.ts';
import type { WatchDebounce } from './watch-debounce.ts';

/** Name prefix of the directory the watcher makes to learn that it is listening. */
const PROBE_PREFIX = '.geekity-watch-';

/** How long one probe waits for its event before another is made. */
const PROBE_INTERVAL_MS = 250;

/** How long the watcher keeps probing before it reports that it hears nothing. */
const PROBE_DEADLINE_MS = 5_000;

/** Watches the content directory and reports each changed path once it has stopped changing. */
export interface ContentWatcher {
  /**
   * Start watching, resolving once the watch hears changes or has given up
   * waiting to. Does nothing when already watching.
   */
  start(): Promise<void>;
  /** Drop every path still waiting out its debounce and stop watching. */
  stop(): void;
  /** How many paths are still waiting out their debounce. */
  waiting(): number;
}

/** How to build a {@link ContentWatcher}. */
export interface CreateContentWatcherOptions {
  contentDir: string;
  logger: SyncLogger;
  debounce: WatchDebounce;
  /**
   * Called with a content-relative path once it has stopped changing, `''`
   * when the watch could not say which path changed. The path may be a
   * document, any other file, or a directory that was made, moved or removed.
   */
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

/**
 * Whether the watch should skip a content-relative path: anything inside a
 * directory the walk would not descend into, and anything named as such a
 * directory. The watch's own probe is let through.
 *
 * The watch is told only a name, never whether it is a file, so a file that
 * is not a document is kept here and found to name no documents when its
 * event is handled.
 */
function isIgnored(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, '/').split('/');
  const name = segments.at(-1) as string;
  if (segments.slice(0, -1).some((segment) => !isWalkableDirectory(segment))) return true;
  if (segments.length === 1 && name.startsWith(PROBE_PREFIX)) return false;
  return !isWalkableDirectory(name);
}
