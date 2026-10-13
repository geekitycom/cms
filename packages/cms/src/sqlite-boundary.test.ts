import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = import.meta.dirname;

const SQLITE = 'node:sqlite';

const ALLOWED_PLACES = ['store/', 'content/sqlite/'];

interface Exception {
  readonly file: string;
  readonly because: string;
}

const EXCEPTIONS: readonly Exception[] = [
  {
    file: 'cache.ts',
    because: 'opens the database file and runs the migration ledger both stores are built on',
  },
  {
    file: 'cli.ts',
    because: 'probes whether a running server holds the database before a rebuild',
  },
  {
    file: 'cms/boot.ts',
    because: 'hands the raw admin database to the legacy migrations at boot',
  },
  {
    file: 'admin/legacy-migrations.ts',
    because: 'reads and drops the tables that moved out of SQLite into files',
  },
];

const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/g;

function isSource(relative: string): boolean {
  return (
    relative.endsWith('.ts') &&
    !relative.endsWith('.test.ts') &&
    !relative.split(path.sep).includes('__testing__')
  );
}

interface SqliteImport {
  readonly file: string;
  readonly at: string;
}

function sqliteImports(): SqliteImport[] {
  const found: SqliteImport[] = [];
  for (const entry of readdirSync(SOURCE_ROOT, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(SOURCE_ROOT, absolute);
    if (!isSource(relative)) continue;
    const file = relative.split(path.sep).join('/');
    readFileSync(absolute, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const [, specifier] of line.matchAll(IMPORT)) {
          if (specifier === SQLITE) found.push({ file, at: `${file}:${String(index + 1)}` });
        }
      });
  }
  return found;
}

function inAllowedPlace(file: string): boolean {
  return ALLOWED_PLACES.some((place) => file.startsWith(place));
}

describe('node:sqlite', () => {
  const imports = sqliteImports();

  it('is imported only by the stores and the files listed in EXCEPTIONS', () => {
    const offences = imports
      .filter(({ file }) => !inAllowedPlace(file))
      .filter(({ file }) => !EXCEPTIONS.some((exception) => exception.file === file))
      .map(({ at }) => at);

    assert.deepEqual(
      offences,
      [],
      `these import ${SQLITE} outside ${ALLOWED_PLACES.join(' and ')}: reach the database ` +
        'through ContentStore or AdminStore instead (decision-52)',
    );
  });

  it('lists no exception that no longer imports it', () => {
    const stale = EXCEPTIONS.filter(
      (exception) => !imports.some(({ file }) => file === exception.file),
    ).map(({ file }) => file);

    assert.deepEqual(
      stale,
      [],
      `these no longer import ${SQLITE}: remove them from EXCEPTIONS so the list only shrinks`,
    );
  });
});
