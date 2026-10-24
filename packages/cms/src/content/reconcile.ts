import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { messageOf } from '../util/errors.ts';
import { exists, isNotFound } from '../util/files.ts';
import type { Document } from './document.ts';
import { handleDirectory } from './handles.ts';
import {
  ORIGINAL_FRONT_MATTER_KEY,
  ORIGINAL_NAME_FRONT_MATTER_KEY,
  originalOf,
} from './original.ts';
import { parseDocument } from './parser.ts';
import { replyTarget } from './post-type.ts';
import { DuplicatePermalinkError } from './store.ts';
import type { DocumentLookup, IndexWriter } from './store.ts';
import type { ChangeOrigin, DocumentChange, SyncLogger } from './sync.ts';

/**
 * What reconciling one file did.
 *
 * `created`, `updated` and `deleted` wrote the index and emitted the change;
 * `unchanged` found the file and its row already agree, or neither exists;
 * `skipped` logged why the file could not be parsed or indexed and left its
 * previous row alone.
 */
export type ReconcileOutcome = 'created' | 'updated' | 'deleted' | 'unchanged' | 'skipped';

/** Whether an outcome wrote the index. */
export function changedIndex(outcome: ReconcileOutcome): boolean {
  return outcome === 'created' || outcome === 'updated' || outcome === 'deleted';
}

/** Brings one file's index row in step with the file. */
export interface Reconciler {
  /**
   * Read the file at a content-relative path and write, rewrite or drop its
   * row to match. An error that is not about the file itself — the index
   * failing, a listener's write escaping — is thrown.
   */
  reconcile(relativePath: string, origin: ChangeOrigin): Promise<ReconcileOutcome>;
}

/** How to build a {@link Reconciler}. */
export interface CreateReconcilerOptions {
  store: DocumentLookup & IndexWriter;
  contentDir: string;
  logger: SyncLogger;
  /** Deliver a change to every subscriber, resolving once they have all finished. */
  emit: (change: DocumentChange) => Promise<void>;
}

export function createReconciler(options: CreateReconcilerOptions): Reconciler {
  const { store, contentDir, logger, emit } = options;
  const handles = handleDirectory(contentDir);

  /**
   * Write a document, giving way to a file that has already gone.
   *
   * Renaming a live file briefly leaves two rows claiming one permalink, and
   * the watcher may well see the new name before the old one disappears. When
   * the conflicting row's file is no longer on disk the row is stale, so it is
   * dropped (and reported) and the write retried. A conflict between two files that both exist is a
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
        await emit({
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

  async function remove(
    relativePath: string,
    previous: Document | undefined,
    origin: ChangeOrigin,
  ): Promise<ReconcileOutcome> {
    if (previous === undefined) return 'unchanged';
    store.remove(relativePath);
    await emit({ type: 'deleted', path: relativePath, previous, next: undefined, origin });
    return 'deleted';
  }

  async function reconcile(relativePath: string, origin: ChangeOrigin): Promise<ReconcileOutcome> {
    const previous = store.getByPath(relativePath);
    const source = await readSource(path.join(contentDir, relativePath));
    if (source === undefined) return await remove(relativePath, previous, origin);

    let document: Document;
    try {
      document = parseDocument(source, { path: relativePath, handles });
    } catch (error) {
      logger.warn(`Skipping ${relativePath}: ${messageOf(error)}`);
      return 'skipped';
    }

    // The hash covers the canonical file text, so a rewrite that changes
    // nothing — an admin save, a touch, the watcher event that follows an
    // admin write — costs no index write and emits no event.
    if (previous !== undefined && previous.hash === document.hash) return 'unchanged';

    warnAboutIgnoredFields(relativePath, document, logger);

    try {
      await index(document, origin);
    } catch (error) {
      logger.warn(`Could not index ${relativePath}: ${messageOf(error)}`);
      return 'skipped';
    }

    const type = previous === undefined ? 'created' : 'updated';
    await emit({ type, path: relativePath, previous, next: document, origin });
    return type;
  }

  return { reconcile };
}

/**
 * Tell the author about front matter that parsed but means nothing. The
 * document is indexed all the same, as an unknown activitypub.type is: a post
 * with an unusable in-reply-to is still a post, only not a reply.
 */
function warnAboutIgnoredFields(
  relativePath: string,
  document: Document,
  logger: SyncLogger,
): void {
  if (document.inReplyTo !== undefined && replyTarget(document) === undefined) {
    logger.warn(
      `${relativePath} names in-reply-to "${document.inReplyTo}", which is not an http or https URL, so it is not a reply.`,
    );
  }
  if (originalOf(document.extra) !== undefined) return;
  const original = document.extra[ORIGINAL_FRONT_MATTER_KEY];
  if (original !== undefined) {
    logger.warn(
      `${relativePath} names ${ORIGINAL_FRONT_MATTER_KEY} ${JSON.stringify(original)}, which is not an absolute http or https URL, so the page stays its own canonical URL.`,
    );
  }
  const name = document.extra[ORIGINAL_NAME_FRONT_MATTER_KEY];
  if (name !== undefined) {
    logger.warn(
      `${relativePath} names ${ORIGINAL_NAME_FRONT_MATTER_KEY} ${JSON.stringify(name)} with no absolute http or https ${ORIGINAL_FRONT_MATTER_KEY}, so it names nothing.`,
    );
  }
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
