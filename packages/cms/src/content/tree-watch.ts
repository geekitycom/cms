import { EventEmitter } from 'node:events';
import { lstatSync, watch } from 'node:fs';
import type { FSWatcher, Stats, WatchEventType } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

import { isNotFound } from '../util/files.ts';

/** A path's event: `rename` when it appeared or went, `change` when it was written. */
export type TreeChangeListener = (type: WatchEventType, relativePath: string | null) => void;

/** A watch over a directory tree, reporting every path by its tree-relative name. */
export interface TreeWatcher {
  on(event: 'change', listener: TreeChangeListener): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  off(event: 'change', listener: TreeChangeListener): this;
  /** Settles once every directory that was there at the start is watched. */
  readonly ready: Promise<void>;
  close(): void;
}

export interface WatchTreeOptions {
  /** Whether a tree-relative path is left unwatched and its events unreported. */
  ignore: (relativePath: string) => boolean;
}

/**
 * Watch a directory tree, with the strategy the platform needs.
 *
 * On macOS and Windows one recursive watch covers the tree. On macOS it has
 * to: every directory watch in the process shares one FSEvents stream, and
 * adding a watch restarts that stream, deaf to anything that happens while
 * it does, so a new directory's documents would go unreported.
 *
 * On Linux the recursive watch is Node's own, built from one inotify watch per
 * file. That watch follows the file's inode, so once a file is replaced by a
 * rename (the way the CMS writes every file) its later edits are never
 * reported. A watch on the directory reports them, so Linux gets one
 * non-recursive watch per directory.
 */
export function watchTree(root: string, options: WatchTreeOptions): TreeWatcher {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? watchRecursively(root, options)
    : watchEachDirectory(root, options);
}

class Tree extends EventEmitter implements TreeWatcher {
  ready: Promise<void> = Promise.resolve();
  private readonly stop: () => void;

  constructor(stop: () => void) {
    super();
    this.stop = stop;
  }

  close(): void {
    this.stop();
  }
}

function watchRecursively(root: string, options: WatchTreeOptions): TreeWatcher {
  const watcher = watch(root, { recursive: true, persistent: true, ignore: options.ignore });
  const tree = new Tree(() => watcher.close());
  watcher.on('change', (type: WatchEventType, filename: string | Buffer | null) => {
    tree.emit('change', type, filename === null ? null : filename.toString().replace(/\\/g, '/'));
  });
  watcher.on('error', (error: unknown) => tree.emit('error', error));
  return tree;
}

interface DirectoryWatch {
  ino: number;
  watcher: FSWatcher;
}

function watchEachDirectory(root: string, options: WatchTreeOptions): TreeWatcher {
  const watchers = new Map<string, DirectoryWatch>();
  let closed = false;
  const tree = new Tree(() => {
    closed = true;
    unwatchUnder(root);
  });

  function relativeTo(absolute: string): string {
    return path.relative(root, absolute).replace(/\\/g, '/');
  }

  function emit(type: WatchEventType, relativePath: string): void {
    if (!closed) tree.emit('change', type, relativePath);
  }

  function watchDirectory(directory: string, ino: number): void {
    if (closed) return;
    const current = watchers.get(directory);
    if (current?.ino === ino) return;
    current?.watcher.close();
    watchers.delete(directory);

    let watcher: FSWatcher;
    try {
      watcher = watch(directory, { persistent: true });
    } catch (error) {
      if (!isNotFound(error)) tree.emit('error', error);
      return;
    }
    watchers.set(directory, { ino, watcher });
    watcher.on('change', (type: WatchEventType, filename: string | Buffer | null) => {
      void watchThenReport(directory, type, filename === null ? null : filename.toString());
    });
    watcher.on('error', (error: unknown) => {
      unwatchUnder(directory);
      tree.emit('error', error);
    });
  }

  /**
   * `report` names what is already inside a directory that appeared while
   * watching: its files were written before its watch existed, so no event
   * of their own will come, as Node's recursive watcher reported them.
   */
  async function watchDirectoriesUnder(
    directory: string,
    ino: number,
    report: boolean,
  ): Promise<void> {
    watchDirectory(directory, ino);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!isNotFound(error)) tree.emit('error', error);
      return;
    }
    for (const entry of entries) {
      if (closed) return;
      const child = path.join(directory, entry.name);
      if (options.ignore(relativeTo(child))) continue;
      if (!entry.isDirectory()) {
        if (report) emit('rename', relativeTo(child));
        continue;
      }
      const found = await statIfPresent(child);
      if (found?.isDirectory()) await watchDirectoriesUnder(child, found.ino, report);
    }
  }

  async function watchThenReport(
    directory: string,
    type: WatchEventType,
    name: string | null,
  ): Promise<void> {
    if (name === null) {
      emit(type, relativeTo(directory));
      return;
    }
    const absolute = path.join(directory, name);
    const relativePath = relativeTo(absolute);
    if (options.ignore(relativePath)) return;

    const found = await statIfPresent(absolute);
    if (found === undefined) {
      unwatchUnder(absolute);
      // A removed directory's own watch reports the removal under the
      // directory's name, as if it were a child.
      if (name === path.basename(directory) && (await statIfPresent(directory)) === undefined) {
        unwatchUnder(directory);
        emit(type, relativeTo(directory));
        return;
      }
    } else if (found.isDirectory()) {
      await watchDirectoriesUnder(absolute, found.ino, true);
    }
    emit(type, relativePath);
  }

  async function statIfPresent(absolute: string): Promise<Stats | undefined> {
    try {
      return await lstat(absolute);
    } catch (error) {
      if (!isNotFound(error)) tree.emit('error', error);
      return undefined;
    }
  }

  function unwatchUnder(directory: string): void {
    for (const [watched, { watcher }] of watchers) {
      if (watched !== directory && !watched.startsWith(directory + path.sep)) continue;
      watcher.close();
      watchers.delete(watched);
    }
  }

  tree.ready = watchDirectoriesUnder(root, lstatSync(root).ino, false);
  return tree;
}
