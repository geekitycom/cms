import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { databaseFile, openDatabase } from '../../cache.ts';
import {
  migrateActorKeysToFiles,
  migrateSettingsToFile,
  migrateUsersToFile,
} from '../legacy-migrations.ts';
import { openAdminStore } from '../store.ts';
import { LEDGER, MIGRATIONS, openAdminDatabase } from './schema.ts';

interface SchemaShape {
  schema: { type: string; name: string; tbl_name: string; sql: string | null }[];
  userVersion: number;
  ledger: number[];
}

const RELEASED: SchemaShape = JSON.parse(
  readFileSync(new URL('./__fixtures__/schema.json', import.meta.url), 'utf8'),
) as SchemaShape;

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-schema-'));
  temporaryDirs.push(dir);
  return dir;
}

function shapeOf(dataDir: string): SchemaShape {
  const db = new DatabaseSync(databaseFile(dataDir));
  try {
    return {
      schema: db
        .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
        .all()
        .map((row) => ({ ...row })) as SchemaShape['schema'],
      userVersion: Number(db.prepare('PRAGMA user_version').get()?.['user_version']),
      ledger: db
        .prepare(`SELECT version FROM ${LEDGER} ORDER BY version`)
        .all()
        .map((row) => Number(row['version'])),
    };
  } finally {
    db.close();
  }
}

describe('the admin schema', () => {
  it('is what the previous release created, on a new database', async () => {
    const dataDir = await temporaryDir();
    openAdminStore({ dataDir }).close();

    assert.deepEqual(shapeOf(dataDir), RELEASED);
  });

  it('is reached from a database stopped at every earlier migration', async () => {
    for (let applied = 1; applied < MIGRATIONS.length; applied += 1) {
      const dataDir = await temporaryDir();
      openDatabase({ dataDir, ledger: LEDGER, migrations: MIGRATIONS.slice(0, applied) }).close();

      openAdminStore({ dataDir }).close();

      assert.deepEqual(shapeOf(dataDir), RELEASED, `from migration ${String(applied)}`);
    }
  });

  it('loses only the three legacy tables to the legacy migrations', async () => {
    const dataDir = await temporaryDir();
    const db = openAdminDatabase(dataDir);
    migrateSettingsToFile(db, path.join(dataDir, 'content'));
    migrateActorKeysToFiles(db, dataDir);
    migrateUsersToFile(db, dataDir);
    db.close();

    const legacy = ['settings', 'actor_keys', 'users'];
    assert.deepEqual(shapeOf(dataDir), {
      ...RELEASED,
      schema: RELEASED.schema.filter((entry) => !legacy.includes(entry.tbl_name)),
    });
  });
});
