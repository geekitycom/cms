import { messageOf } from '../util/errors.ts';
import { createSerialQueue } from '../util/queue.ts';
import { isDocumentPath } from './content-tree.ts';
import { createContentWatcher } from './content-watcher.ts';
import type { Document } from './document.ts';
import { changedIndex, createReconciler } from './reconcile.ts';
import { documentsUnder, scanContent } from './scan.ts';
import { isServed } from './served.ts';
import type { CatalogReader, DocumentLookup, IndexClock, IndexWriter } from './store.ts';
import { defaultWatchDebounce } from './watch-debounce.ts';
import type { WatchDebounce } from './watch-debounce.ts';

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
  store: DocumentLookup & CatalogReader & IndexWriter & IndexClock;
  /** Absolute path of the content directory. It need not exist yet. */
  contentDir: string;
  /** Watch for changes after the boot scan. Default `true`. */
  watch?: boolean | undefined;
  debounce?: WatchDebounce | undefined;
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
  /**
   * Run `listener` each time the index settles: after every full scan, and
   * after a run of watcher changes once no more are waiting. It runs on the
   * sync's own queue, so no file is reconciled while it does, and a scan
   * resolves only once it has finished. Returns the function that
   * unsubscribes.
   */
  onSettled(listener: () => unknown): () => void;
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
  const emit = (change: DocumentChange): Promise<void> => emitChange(events, store.now(), change);
  const reconciler = createReconciler({ store, contentDir, logger, emit });
  const tree = { store, contentDir, logger };

  // Watcher events are debounced per path and then handled one at a time, on
  // the same queue as a full scan, so a burst of writes to one file costs a
  // single re-parse and no two reconciles of one path ever interleave.
  const queue = createSerialQueue();
  const settled = createSettledListeners(logger);
  const watcher = createContentWatcher({
    contentDir,
    logger,
    debounce: options.debounce ?? defaultWatchDebounce,
    onSettledPath: (relativePath) => void queue.run(() => reconcileWatched(relativePath)),
  });

  async function scanAndSettle(): Promise<SyncResult> {
    const result = await scanContent({ reconciler, ...tree });
    await settled.settle();
    return result;
  }

  /**
   * Reconcile what a watcher event names. A document is re-read; any other
   * path may be a directory that was made, moved or removed, so every
   * document under it, on disk or in the index, is.
   */
  async function reconcileWatched(relativePath: string): Promise<void> {
    const paths = isDocumentPath(relativePath)
      ? [relativePath]
      : await documentsUnder(tree, relativePath);
    for (const documentPath of paths) {
      try {
        if (changedIndex(await reconciler.reconcile(documentPath, 'watch'))) {
          settled.markUnsettled();
        }
      } catch (error) {
        logger.warn(`Could not sync ${documentPath}: ${messageOf(error)}`);
      }
    }
    // This run is the one left in the queue, and no path is waiting out
    // its debounce: the burst is over.
    if (settled.isUnsettled() && watcher.waiting() === 0 && queue.pending() === 1) {
      await settled.settle();
    }
  }

  return {
    events,

    announce: emit,

    onSettled(listener) {
      return settled.add(listener);
    },

    sync() {
      return queue.run(scanAndSettle);
    },

    // The watch goes first and the scan after it hears changes, so a file
    // written at any moment of the boot is either found by the scan or
    // reported by the watch.
    async start() {
      if (options.watch !== false) await watcher.start();
      return await queue.run(scanAndSettle);
    },

    async stop() {
      watcher.stop();
      // Anything already past its debounce is allowed to finish, so stopping
      // never leaves a half-applied write behind.
      await queue.settled();
    },
  };
}

/** The listeners {@link ContentSync.onSettled} keeps, and whether a change is waiting for them. */
interface SettledListeners {
  add(listener: () => unknown): () => void;
  /** Note that the index changed since the listeners last ran. */
  markUnsettled(): void;
  isUnsettled(): boolean;
  /** Run every listener in turn, logging any that throws. */
  settle(): Promise<void>;
}

function createSettledListeners(logger: SyncLogger): SettledListeners {
  const listeners = new Set<() => unknown>();
  let unsettled = false;

  return {
    add(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    markUnsettled() {
      unsettled = true;
    },

    isUnsettled() {
      return unsettled;
    },

    async settle() {
      unsettled = false;
      for (const listener of [...listeners]) {
        try {
          await listener();
        } catch (error) {
          logger.warn(`A settled listener threw: ${messageOf(error)}`);
        }
      }
    },
  };
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

function isPublic(document: Document | undefined, now: Date): boolean {
  return document !== undefined && isServed(document, now);
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
