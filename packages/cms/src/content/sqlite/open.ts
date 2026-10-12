import { databaseFile, openDatabase } from '../../cache.ts';
import { systemClock } from '../store.ts';
import type { ContentStore, IndexConnection, OpenContentStoreOptions } from '../store.ts';
import { archiveReader } from './archive.ts';
import { backlinkReader } from './backlinks.ts';
import { catalogReader } from './catalog.ts';
import type { IndexDatabase } from './database.ts';
import { documentLookup } from './lookups.ts';
import { replyReader } from './replies.ts';
import { LEDGER, MIGRATIONS } from './schema.ts';
import { scheduleReader } from './schedule.ts';
import { searchReader } from './search.ts';
import { taxonomyReader } from './taxonomy.ts';
import { indexWriter, refreshAgainstBase } from './writes.ts';

/**
 * Open (and if needed create) the index in `dataDir`, applying every migration
 * the package ships. Applying them is idempotent, so reopening an up-to-date
 * database does nothing.
 */
export function openContentStore(options: OpenContentStoreOptions): ContentStore {
  const index: IndexDatabase = {
    db: openDatabase({ dataDir: options.dataDir, ledger: LEDGER, migrations: MIGRATIONS }),
    clock: options.now ?? systemClock,
    baseUrl: options.baseUrl,
    spellings: { current: undefined, staleKeys: new Set() },
    prepared: new Map(),
  };
  if (options.baseUrl !== undefined) refreshAgainstBase(index, options.baseUrl);

  return {
    ...indexConnection(index, databaseFile(options.dataDir)),
    now: () => index.clock(),
    ...indexWriter(index),
    ...documentLookup(index),
    ...archiveReader(index),
    ...taxonomyReader(index),
    ...replyReader(index),
    ...backlinkReader(index),
    ...searchReader(index),
    ...catalogReader(index),
    ...scheduleReader(index),
  };
}

function indexConnection(index: IndexDatabase, file: string): IndexConnection {
  let open = true;
  return {
    file,
    setReadOnly(readOnly) {
      index.db.exec(`PRAGMA query_only = ${readOnly ? 'ON' : 'OFF'}`);
    },
    close() {
      if (!open) return;
      open = false;
      index.db.close();
    },
  };
}
