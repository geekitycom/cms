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

export type ReconcileOutcome = 'created' | 'updated' | 'deleted' | 'unchanged' | 'skipped';

export function changedIndex(outcome: ReconcileOutcome): boolean {
  return outcome === 'created' || outcome === 'updated' || outcome === 'deleted';
}

export interface Reconciler {
  reconcile(relativePath: string, origin: ChangeOrigin): Promise<ReconcileOutcome>;
}

export interface CreateReconcilerOptions {
  store: DocumentLookup & IndexWriter;
  contentDir: string;
  logger: SyncLogger;
  emit: (change: DocumentChange) => Promise<void>;
}

export function createReconciler(options: CreateReconcilerOptions): Reconciler {
  const { store, contentDir, logger, emit } = options;
  const handles = handleDirectory(contentDir);

  async function indexOverStaleRow(document: Document, origin: ChangeOrigin): Promise<void> {
    try {
      store.upsert(document);
    } catch (error) {
      const stalePath = await conflictingPathWhoseFileIsGone(error);
      if (stalePath === undefined) throw error;
      await dropStaleRow(stalePath, origin);
      store.upsert(document);
    }
  }

  async function conflictingPathWhoseFileIsGone(error: unknown): Promise<string | undefined> {
    if (!(error instanceof DuplicatePermalinkError)) return undefined;
    const conflicting = error.conflictingPath;
    if (conflicting === undefined) return undefined;
    if (await exists(path.join(contentDir, conflicting))) return undefined;
    return conflicting;
  }

  async function dropStaleRow(stalePath: string, origin: ChangeOrigin): Promise<void> {
    const stale = store.getByPath(stalePath);
    store.remove(stalePath);
    if (stale !== undefined) {
      await emit({ type: 'deleted', path: stalePath, previous: stale, next: undefined, origin });
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

    if (previous !== undefined && previous.hash === document.hash) return 'unchanged';

    warnAboutIgnoredFields(relativePath, document, logger);

    try {
      await indexOverStaleRow(document, origin);
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

async function readSource(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}
