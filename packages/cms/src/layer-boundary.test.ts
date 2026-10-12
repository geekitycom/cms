import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = import.meta.dirname;

interface LayerRule {
  /** The top-level directories the rule holds for. */
  readonly layer: readonly string[];
  /** The top-level directories no non-test module in the layer may import. */
  readonly above: readonly string[];
}

const RULES: readonly LayerRule[] = [
  { layer: ['content', 'media', 'micropub', 'site'], above: ['admin'] },
  {
    layer: ['content'],
    above: [
      'web',
      'webmention',
      'federation',
      'comments',
      'contact',
      'site',
      'admin',
      'micropub',
      'cms',
    ],
  },
];

const RELATIVE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

/** Every relative import in the layer, as the top-level directory it lands in and where it is. */
function importsOf(directory: string): { target: string; at: string }[] {
  const found: { target: string; at: string }[] = [];
  for (const entry of readdirSync(path.join(SOURCE_ROOT, directory), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      continue;
    }
    const file = path.join(entry.parentPath, entry.name);
    if (file.split(path.sep).includes('__testing__')) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const [, specifier] of line.matchAll(RELATIVE_IMPORT)) {
          if (specifier === undefined) continue;
          const landed = path.relative(SOURCE_ROOT, path.resolve(path.dirname(file), specifier));
          const target = landed.split(path.sep)[0] ?? '';
          found.push({ target, at: `${path.relative(SOURCE_ROOT, file)}:${String(index + 1)}` });
        }
      });
  }
  return found;
}

describe('the layer boundaries', () => {
  for (const { layer, above } of RULES) {
    for (const directory of layer) {
      it(`keeps ${directory}/ from importing ${above.map((name) => `${name}/`).join(', ')}`, () => {
        const offences = importsOf(directory)
          .filter(({ target }) => above.includes(target))
          .map(({ target, at }) => `${directory}/ must not import from ${target}/: ${at}`);
        assert.deepEqual(offences, []);
      });
    }
  }
});
