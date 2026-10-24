import { walk } from './content-tree.ts';
import { changedIndex } from './reconcile.ts';
import type { ReconcileOutcome, Reconciler } from './reconcile.ts';
import type { CatalogReader } from './store.ts';
import type { SyncLogger, SyncResult } from './sync.ts';

export interface ScanContext {
  reconciler: Reconciler;
  store: CatalogReader;
  contentDir: string;
  logger: SyncLogger;
}

export async function scanContent(context: ScanContext): Promise<SyncResult> {
  const { reconciler, contentDir, logger } = context;
  const result: SyncResult = {
    scanned: 0,
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    failed: 0,
  };

  const onDisk = await walk(contentDir, logger);
  await freePermalinksHeldByGoneFiles(context, new Set(onDisk), result);

  for (const relativePath of onDisk) {
    result.scanned += 1;
    tallyFound(result, await reconciler.reconcile(relativePath, 'scan'));
  }

  return result;
}

async function freePermalinksHeldByGoneFiles(
  { reconciler, store }: ScanContext,
  onDisk: ReadonlySet<string>,
  result: SyncResult,
): Promise<void> {
  for (const indexed of store.listPaths()) {
    if (onDisk.has(indexed)) continue;
    const outcome = await reconciler.reconcile(indexed, 'scan');
    if (outcome === 'skipped') result.failed += 1;
    else if (changedIndex(outcome)) result.removed += 1;
  }
}

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
