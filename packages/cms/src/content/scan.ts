import { walk } from './content-tree.ts';
import { changedIndex } from './reconcile.ts';
import type { ReconcileOutcome, Reconciler } from './reconcile.ts';
import type { CatalogReader } from './store.ts';
import type { SyncLogger, SyncResult } from './sync.ts';

/** What a scan reads and writes through. */
export interface ScanContext {
  reconciler: Reconciler;
  store: CatalogReader;
  contentDir: string;
  logger: SyncLogger;
}

/** Walk the content directory once, reconciling every file and dropping rows whose file is gone. */
export async function scanContent(context: ScanContext): Promise<SyncResult> {
  const { reconciler, store, contentDir, logger } = context;
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
    const outcome = await reconciler.reconcile(indexed, 'scan');
    if (outcome === 'skipped') result.failed += 1;
    else if (changedIndex(outcome)) result.removed += 1;
  }

  for (const relativePath of onDisk) {
    result.scanned += 1;
    tallyFound(result, await reconciler.reconcile(relativePath, 'scan'));
  }

  return result;
}

/**
 * Count what reconciling a file the walk found did. A file that is gone by
 * the time it is read had a row, so dropping it counts as an update.
 */
function tallyFound(result: SyncResult, outcome: ReconcileOutcome): void {
  switch (outcome) {
    case 'skipped':
      result.failed += 1;
      return;
    case 'unchanged':
      result.unchanged += 1;
      return;
    case 'created':
      result.created += 1;
      return;
    case 'updated':
    case 'deleted':
      result.updated += 1;
      return;
  }
}

/** Documents under a content-relative path: indexed ones that are gone first, then what is on disk. */
export async function documentsUnder(
  context: Omit<ScanContext, 'reconciler'>,
  from: string,
): Promise<string[]> {
  const { store, contentDir, logger } = context;
  const onDisk = await walk(contentDir, logger, from);
  const present = new Set(onDisk);
  const gone = store
    .listPaths()
    .filter((indexed) => (from === '' || indexed.startsWith(`${from}/`)) && !present.has(indexed));
  return [...gone, ...onDisk];
}
