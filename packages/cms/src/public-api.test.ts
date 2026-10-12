import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = import.meta.dirname;
const API_DOC = path.join(SOURCE_ROOT, '..', '..', '..', 'docs', 'public-api.md');
const ENTRY_FILES = ['index.ts', 'exports.ts'];
const ENTRY_RE_EXPORT = "export * from './exports.ts';";

const NAMED_EXPORT = /^export\s+(type\s+)?\{([^}]*)\}\s+from\s+'[^']+';/gm;
const DOCUMENTED_EXPORT = /^\| `([A-Za-z_$][\w$]*)` +\|/gm;

interface EntryExports {
  readonly values: readonly string[];
  readonly types: readonly string[];
}

function entryExports(): EntryExports {
  const values: string[] = [];
  const types: string[] = [];
  for (const file of ENTRY_FILES) {
    const text = readFileSync(path.join(SOURCE_ROOT, file), 'utf8');
    const statements = text.split('\n').filter((line) => line.startsWith('export'));
    const named = [...text.matchAll(NAMED_EXPORT)];
    const reExports = statements.filter((line) => line === ENTRY_RE_EXPORT);
    assert.equal(
      named.length + reExports.length,
      statements.length,
      `${file} may hold only \`export { … } from\` and \`export type { … } from\` statements`,
    );
    for (const [, typeOnly, list = ''] of named) {
      for (const raw of list.split(',')) {
        const element = raw.trim();
        if (element === '') continue;
        const isType = typeOnly !== undefined || element.startsWith('type ');
        const name =
          element
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)
            .at(-1) ?? element;
        (isType ? types : values).push(name);
      }
    }
  }
  return { values: values.sort(), types: types.sort() };
}

function documentedExports(): string[] {
  return [...readFileSync(API_DOC, 'utf8').matchAll(DOCUMENTED_EXPORT)]
    .map(([, name = '']) => name)
    .sort();
}

describe('the root entry of @geekity/cms', () => {
  it('exports at runtime exactly the values its export statements name', async () => {
    const runtime = Object.keys(await import('./index.ts')).sort();

    assert.deepEqual(runtime, entryExports().values);
  });

  it('exports exactly the names docs/public-api.md lists', () => {
    const { values, types } = entryExports();
    const exported = [...values, ...types].sort();
    const documented = documentedExports();

    const undocumented = exported.filter((name) => !documented.includes(name));
    const gone = documented.filter((name) => !exported.includes(name));
    assert.deepEqual(
      { undocumented, gone },
      { undocumented: [], gone: [] },
      'The root entry is a public API. Add each new export to docs/public-api.md with one line, ' +
        'or take it out of src/exports.ts; remove a documented name only in a breaking change.',
    );
  });

  it('names each export once', () => {
    const { values, types } = entryExports();
    const all = [...values, ...types];

    assert.deepEqual(
      all.filter((name, index) => all.indexOf(name) !== index),
      [],
    );
    assert.deepEqual(
      documentedExports().filter((name, index, list) => list.indexOf(name) !== index),
      [],
    );
  });
});
