import type { Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { watch as watchPaths } from 'chokidar';
import type { FSWatcher } from 'chokidar';

import type { Document, DocumentType } from './document.ts';
import { parseDocument } from './parser.ts';
import { isScheduled } from './schedule.ts';
import { DuplicatePermalinkError, isTrashedPath, TRASH_DIRECTORY } from './store.ts';
import type { ContentStore } from './store.ts';

/** File extensions the sync treats as documents. */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/** How long the watcher waits for a path to stop changing before re-reading it. */
export const DEFAULT_DEBOUNCE_MS = 100;

/** Directories that hold documents. Everything else in `content/` is not indexed. */
const DOCUMENT_DIRECTORIES: ReadonlyMap<string, DocumentType> = new Map([
  ['posts', 'post'],
  ['pages', 'page'],
]);

/** What happened to one document. */
export type DocumentChangeType = 'created' | 'updated' | 'deleted';

/**
 * Where a change came from.
 *
 * `scan` is a full walk of the content directory, the boot scan included;
 * `watch` is a file that changed under the running watcher; `admin` is a write
 * the CMS made itself and announced, because the admin corrects the index as
 * soon as the bytes land (doc-1) and the watcher's later re-read of that file
 * is a hash no-op that would otherwise emit nothing at all.
 *
 * `schedule` is the odd one out: nothing was written at all, and the file is
 * exactly as it was. What moved is the clock, past the date of a post that was
 * waiting for it. It carries no `previous`, because until that moment no
 * subscriber knew the post existed — which is why every one of them can treat
 * it as the creation it looks like.
 */
export type ChangeOrigin = 'scan' | 'watch' | 'admin' | 'schedule';

/**
 * One change to the index, as the subscriber sees it.
 *
 * `previous` and `next` are the whole documents, so a subscriber can compare
 * them itself — a draft going live, a title changing, a tag appearing.
 */
export interface DocumentChange {
  /** Which of the three primary changes this is. */
  type: DocumentChangeType;
  /** Content-relative path of the file, with `/` separators. */
  path: string;
  /** The indexed document before the change, `undefined` when there was none. */
  previous: Document | undefined;
  /** The document after the change, `undefined` when the file is gone. */
  next: Document | undefined;
  /** Where the change came from; see {@link ChangeOrigin}. */
  origin: ChangeOrigin;
}

/** What a full scan did. */
export interface SyncResult {
  /** Document files found on disk. */
  scanned: number;
  /** Files indexed for the first time. */
  created: number;
  /** Files whose row was rewritten because the content changed. */
  updated: number;
  /** Rows dropped because the file is gone. */
  removed: number;
  /** Files whose hash matched the indexed row, so nothing was written. */
  unchanged: number;
  /** Files that could not be parsed or indexed. Their previous row is left alone. */
  failed: number;
}

/** Where parse failures go. Anything with a `warn` will do, including `console`. */
export interface SyncLogger {
  warn(message: string): void;
}

/** How to build a {@link ContentSync}. */
export interface CreateContentSyncOptions {
  /** The index to keep in step with the files. */
  store: ContentStore;
  /** Absolute path of the content directory. It need not exist yet. */
  contentDir: string;
  /** Watch for changes after the boot scan. Default `true`. */
  watch?: boolean | undefined;
  /** Per-path debounce for watcher events, in milliseconds. Default 100. */
  debounceMs?: number | undefined;
  /** Where parse failures are reported. Defaults to `console`. */
  logger?: SyncLogger | undefined;
}

/** The events a subscriber can listen for, and what each one carries. */
export interface ContentEventMap {
  /** A document was indexed for the first time. */
  created: [DocumentChange];
  /** An indexed document's content changed. */
  updated: [DocumentChange];
  /** An indexed document's file is gone. */
  deleted: [DocumentChange];
  /**
   * A document became visible on the public site: created already published,
   * a draft that was published, or a document restored from the trash. Fires
   * after the primary event for the same change.
   */
  published: [DocumentChange];
  /** The reverse: published to draft, trashed, or deleted while published. */
  unpublished: [DocumentChange];
  /** Every `created`, `updated` and `deleted`, for subscribers that want them all. */
  change: [DocumentChange];
}

/**
 * A listener for one kind of change.
 *
 * The return is `unknown` rather than `void` so an `async` listener type
 * checks: the sync ignores the value but awaits a promise, which is what lets
 * a subscriber that writes to disk finish before the change is called done.
 */
export type ContentEventListener = (change: DocumentChange) => unknown;

/**
 * Subscription to index changes.
 *
 * A listener that throws — or, when it is `async`, whose promise rejects — is
 * reported through the logger and does not stop the sync, so one bad
 * subscriber cannot wedge the watcher.
 */
export interface ContentEvents {
  /** Listen for an event. Returns the function that unsubscribes. */
  on<K extends keyof ContentEventMap>(event: K, listener: ContentEventListener): () => void;
  /** Listen for the next occurrence only. Returns the function that unsubscribes. */
  once<K extends keyof ContentEventMap>(event: K, listener: ContentEventListener): () => void;
  /** Stop listening. */
  off<K extends keyof ContentEventMap>(event: K, listener: ContentEventListener): void;
}

/** Keeps the content index in step with the files on disk. */
export interface ContentSync {
  /** Subscribe to index changes. */
  readonly events: ContentEvents;
  /**
   * Report a change the sync did not make, and wait for every listener to
   * finish with it.
   *
   * The admin writes a file and corrects the index in the same request rather
   * than waiting for the watcher (doc-1), which means the watcher's re-read
   * finds a hash that already matches and emits nothing. Without this, no
   * subscriber would ever hear about an admin save. The promise settles once
   * every listener has, so a caller that has to know the change was seen — the
   * federation stamping `activitypub` into the file it just wrote — can wait
   * for it.
   */
  announce(change: DocumentChange): Promise<void>;
  /** Walk the content directory once, reconciling every file and dropping rows whose file is gone. */
  sync(): Promise<SyncResult>;
  /**
   * Run the boot scan and, unless watching is off, start the watcher.
   * Resolves with what the scan did.
   */
  start(): Promise<SyncResult>;
  /** Stop the watcher. Safe to call before starting and safe to call twice. */
  stop(): Promise<void>;
}

/**
 * Build the sync for one content directory.
 *
 * Files are the source of truth (decision-1). A scan parses every document
 * under `content/`, writes the ones whose hash differs from the indexed row,
 * and drops rows whose file has gone. Nothing else in the directory is
 * touched: uploads, directory data files and every underscore-prefixed
 * directory but `_trash` are skipped.
 */
export function createContentSync(options: CreateContentSyncOptions): ContentSync {
  const { store, contentDir } = options;
  const logger = options.logger ?? console;
  const events = createEmitter(logger);

  /**
   * Write a document, giving way to a file that has already gone.
   *
   * Renaming a file — which is what trashing and restoring are — briefly
   * leaves two rows claiming one permalink, and the watcher may well see the
   * new name before the old one disappears. When the conflicting row's file is
   * no longer on disk the row is stale, so it is dropped (and reported) and
   * the write retried. A conflict between two files that both exist is a
   * content mistake and is left to the caller to report.
   */
  async function index(document: Document, origin: ChangeOrigin): Promise<void> {
    try {
      store.upsert(document);
      return;
    } catch (error) {
      if (!(error instanceof DuplicatePermalinkError)) throw error;
      const conflicting = error.conflictingPath;
      if (conflicting === undefined) throw error;
      if (await exists(path.join(contentDir, conflicting))) throw error;

      const stale = store.getByPath(conflicting);
      store.remove(conflicting);
      if (stale !== undefined) {
        await emitChange(events, store.now(), {
          type: 'deleted',
          path: conflicting,
          previous: stale,
          next: undefined,
          origin,
        });
      }
      store.upsert(document);
    }
  }

  async function reconcile(relativePath: string, origin: ChangeOrigin): Promise<boolean> {
    const previous = store.getByPath(relativePath);
    const source = await readSource(path.join(contentDir, relativePath));

    if (source === undefined) {
      if (previous === undefined) return false;
      store.remove(relativePath);
      await emitChange(events, store.now(), {
        type: 'deleted',
        path: relativePath,
        previous,
        next: undefined,
        origin,
      });
      return true;
    }

    let document: Document;
    try {
      document = parseDocument(source, { path: relativePath });
    } catch (error) {
      logger.warn(`Skipping ${relativePath}: ${messageOf(error)}`);
      throw new SkippedFile();
    }

    // The hash covers the canonical file text, so a rewrite that changes
    // nothing — an admin save, a touch, the watcher event that follows an
    // admin write — costs no index write and emits no event.
    if (previous !== undefined && previous.hash === document.hash) return false;

    try {
      await index(document, origin);
    } catch (error) {
      logger.warn(`Could not index ${relativePath}: ${messageOf(error)}`);
      throw new SkippedFile();
    }

    await emitChange(events, store.now(), {
      type: previous === undefined ? 'created' : 'updated',
      path: relativePath,
      previous,
      next: document,
      origin,
    });
    return true;
  }

  async function scan(): Promise<SyncResult> {
    const result: SyncResult = {
      scanned: 0,
      created: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
      failed: 0,
    };

    const onDisk = await walk(contentDir, logger);
    const seen = new Set(onDisk);

    // Rows whose file has gone go first, so a document that was renamed —
    // moving into or out of `_trash/` is a rename — does not collide with its
    // own old row over the permalink they share.
    for (const indexed of store.listPaths()) {
      if (seen.has(indexed)) continue;
      try {
        if (await reconcile(indexed, 'scan')) result.removed += 1;
      } catch (error) {
        if (!(error instanceof SkippedFile)) throw error;
        result.failed += 1;
      }
    }

    for (const relativePath of onDisk) {
      result.scanned += 1;
      const existed = store.getByPath(relativePath) !== undefined;
      try {
        const wrote = await reconcile(relativePath, 'scan');
        if (!wrote) result.unchanged += 1;
        else if (existed) result.updated += 1;
        else result.created += 1;
      } catch (error) {
        if (!(error instanceof SkippedFile)) throw error;
        result.failed += 1;
      }
    }

    return result;
  }

  // Watcher events are debounced per path and then handled one at a time, so
  // a burst of writes to one file costs a single re-parse and two files that
  // change together never interleave their index writes.
  const pending = new Map<string, NodeJS.Timeout>();
  let queue: Promise<void> = Promise.resolve();
  let watcher: FSWatcher | undefined;

  function handle(absolutePath: string): void {
    const relativePath = toRelative(contentDir, absolutePath);
    if (relativePath === undefined || !isDocumentPath(relativePath)) return;

    clearTimeout(pending.get(relativePath));
    pending.set(
      relativePath,
      setTimeout(() => {
        pending.delete(relativePath);
        queue = queue.then(async () => {
          try {
            await reconcile(relativePath, 'watch');
          } catch (error) {
            if (error instanceof SkippedFile) return;
            logger.warn(`Could not sync ${relativePath}: ${messageOf(error)}`);
          }
        });
      }, options.debounceMs ?? DEFAULT_DEBOUNCE_MS),
    );
  }

  async function startWatching(): Promise<void> {
    if (watcher !== undefined) return;

    const started = watchPaths(contentDir, {
      ignored: (candidate: string, stats?: Stats) => isIgnored(contentDir, candidate, stats),
      ignoreInitial: true,
      persistent: true,
    });
    watcher = started;

    started.on('add', handle);
    started.on('change', handle);
    started.on('unlink', handle);
    started.on('error', (error: unknown) => {
      logger.warn(`Content watcher error: ${messageOf(error)}`);
    });

    await new Promise<void>((resolve) => {
      started.once('ready', () => resolve());
    });
  }

  return {
    events,

    announce(change) {
      return emitChange(events, store.now(), change);
    },

    sync() {
      return scan();
    },

    async start() {
      const result = await scan();
      if (options.watch !== false) await startWatching();
      return result;
    },

    async stop() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();

      const running = watcher;
      watcher = undefined;
      if (running !== undefined) await running.close();

      // Anything already past its debounce is allowed to finish, so stopping
      // never leaves a half-applied write behind.
      await queue;
    },
  };
}

/**
 * Whether chokidar should skip a path: anything inside a directory the walk
 * would not descend into, and any file that is not a document.
 *
 * chokidar calls this without stats before it knows what a path is, so a name
 * that could be a directory is kept and filtered again when its event arrives.
 */
function isIgnored(contentDir: string, absolutePath: string, stats?: Stats): boolean {
  const relativePath = toRelative(contentDir, absolutePath);
  if (relativePath === undefined) return false;
  if (relativePath === '') return false;

  const segments = relativePath.split('/');
  const name = segments.at(-1) as string;
  if (segments.slice(0, -1).some((segment) => !isWalkableDirectory(segment))) return true;
  if (stats?.isFile() === true) return !isDocumentPath(relativePath);
  return !isWalkableDirectory(name);
}

/** A watched absolute path as a content-relative one, or `undefined` if it is outside. */
function toRelative(contentDir: string, absolutePath: string): string | undefined {
  const relativePath = path.relative(contentDir, absolutePath).replace(/\\/g, '/');
  if (relativePath.startsWith('../') || path.isAbsolute(relativePath)) return undefined;
  return relativePath;
}

/** Thrown inside a reconcile that logged and gave up on one file. */
class SkippedFile extends Error {
  override readonly name = 'SkippedFile';
}

/**
 * Emit the primary change, then the visibility change it implies, and resolve
 * once every listener has finished with all of them.
 *
 * The events go out in order rather than at once, so a subscriber that listens
 * for both `created` and `published` sees them the way the names read.
 */
async function emitChange(events: Emitter, now: Date, change: DocumentChange): Promise<void> {
  await events.emit(change.type, change);
  await events.emit('change', change);

  const wasPublic = isPublic(change.previous, now);
  const isNowPublic = isPublic(change.next, now);
  if (isNowPublic && !wasPublic) await events.emit('published', change);
  else if (wasPublic && !isNowPublic) await events.emit('unpublished', change);
}

/**
 * A document is public when it exists, is not a draft, is not in the trash and
 * its date has arrived.
 *
 * The date is why an edit that pushes a published post into the future reads
 * as an `unpublished`: the post has gone from the site as surely as if it had
 * been drafted, and every subscriber should be told so.
 */
function isPublic(document: Document | undefined, now: Date): boolean {
  if (document === undefined) return false;
  return !document.draft && !isTrashedPath(document.path) && !isScheduled(document, now);
}

/** The file's text, or `undefined` when it is not there any more. */
async function readSource(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

/** Whether a file is still on disk. */
async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every document file under the content directory, content-relative and
 * sorted. A directory that cannot be read is reported and skipped rather than
 * failing the whole walk.
 */
async function walk(contentDir: string, logger: SyncLogger): Promise<string[]> {
  const found: string[] = [];

  async function visit(directory: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!isNotFound(error)) logger.warn(`Could not read ${directory}: ${messageOf(error)}`);
      return;
    }

    for (const entry of entries) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!isWalkableDirectory(entry.name)) continue;
        await visit(path.join(directory, entry.name), relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isDocumentPath(relativePath)) found.push(relativePath);
    }
  }

  await visit(contentDir, '');
  return found.sort();
}

/**
 * Whether the walk descends into a directory. Eleventy ignores directories
 * whose name starts with an underscore and so does the CMS, with one
 * exception: the trash still holds documents, which stay indexed so the admin
 * can restore them.
 */
function isWalkableDirectory(name: string): boolean {
  if (name === TRASH_DIRECTORY) return true;
  if (name.startsWith('_') || name.startsWith('.')) return false;
  return name !== 'node_modules';
}

/**
 * Whether a content-relative path is a document: a Markdown file under a
 * `posts/` or `pages/` directory. Uploads, directory data files and anything
 * the CMS does not model are skipped without a word.
 */
function isDocumentPath(relativePath: string): boolean {
  if (!MARKDOWN_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) return false;
  const segments = relativePath.split('/').slice(0, -1);
  return segments.some((segment) => DOCUMENT_DIRECTORIES.has(segment));
}

/** The minimum event emitter this needs, typed to {@link ContentEventMap}. */
interface Emitter extends ContentEvents {
  /** Deliver one event, resolving once every listener has finished with it. */
  emit<K extends keyof ContentEventMap>(event: K, change: DocumentChange): Promise<void>;
}

function createEmitter(logger: SyncLogger): Emitter {
  const listeners = new Map<keyof ContentEventMap, Set<ContentEventListener>>();

  function setFor(event: keyof ContentEventMap): Set<ContentEventListener> {
    const existing = listeners.get(event);
    if (existing !== undefined) return existing;
    const created = new Set<ContentEventListener>();
    listeners.set(event, created);
    return created;
  }

  return {
    on(event, listener) {
      setFor(event).add(listener);
      return () => {
        listeners.get(event)?.delete(listener);
      };
    },

    once(event, listener) {
      const wrapped: ContentEventListener = (change) => {
        listeners.get(event)?.delete(wrapped);
        listener(change);
      };
      setFor(event).add(wrapped);
      return () => {
        listeners.get(event)?.delete(wrapped);
      };
    },

    off(event, listener) {
      listeners.get(event)?.delete(listener);
    },

    async emit(event, change) {
      const registered = listeners.get(event);
      if (registered === undefined) return;
      for (const listener of [...registered]) {
        try {
          // A listener's return is ignored, but an `async` one hands back a
          // promise: awaiting it is what lets a subscriber that writes to disk
          // finish before the caller carries on, and what keeps a rejection
          // from escaping as an unhandled one.
          await listener(change);
        } catch (error) {
          logger.warn(`A ${event} listener threw: ${messageOf(error)}`);
        }
      }
    },
  };
}
