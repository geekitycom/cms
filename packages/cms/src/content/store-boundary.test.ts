import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = path.dirname(import.meta.dirname);

function sourceFiles(): { relative: string; text: string }[] {
  return readdirSync(SOURCE_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .map((file) => path.relative(SOURCE_ROOT, file).split(path.sep).join('/'))
    .filter((relative) => !relative.endsWith('.test.ts') && !relative.includes('__testing__/'))
    .map((relative) => ({
      relative,
      text: readFileSync(path.join(SOURCE_ROOT, relative), 'utf8'),
    }));
}

const IMPLEMENTATION = 'content/sqlite/';

/** Where the whole store may be named: the composition root and the package's export list. */
const HOLDERS_OF_THE_WHOLE_STORE = ['cms/', 'content/', 'exports.ts'];

describe('the content index boundary', () => {
  it('keeps node:sqlite inside the index implementation within content/', () => {
    const offenders = sourceFiles()
      .filter(
        ({ relative }) => relative.startsWith('content/') && !relative.startsWith(IMPLEMENTATION),
      )
      .filter(({ text }) => /from 'node:sqlite'/.test(text))
      .map(({ relative }) => relative);
    assert.deepEqual(offenders, [], `only ${IMPLEMENTATION} imports node:sqlite in content/`);
  });

  it('reaches the implementation only through the content barrel', () => {
    const offenders = sourceFiles()
      .filter(
        ({ relative }) => !relative.startsWith(IMPLEMENTATION) && relative !== 'content/index.ts',
      )
      .filter(({ text }) => /from '[^']*\/sqlite\/[^']*'/.test(text))
      .map(({ relative }) => relative);
    assert.deepEqual(offenders, [], 'import openContentStore from content/index.ts');
  });

  it('names the whole ContentStore only in the composition root, content/ and the export list', () => {
    const offenders = sourceFiles()
      .filter(
        ({ relative }) => !HOLDERS_OF_THE_WHOLE_STORE.some((holder) => relative.startsWith(holder)),
      )
      .filter(({ text }) => /\bContentStore\b/.test(text.replace(/\{@link ContentStore\}/g, '')))
      .map(({ relative }) => relative);
    assert.deepEqual(
      offenders,
      [],
      'depend on the interfaces in content/store.ts a caller reads (DocumentLookup, ArchiveReader, …)',
    );
  });
});
