import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = import.meta.dirname;

const WIKI_LINK_SYNTAX = 'content/wiki-link-syntax.ts';

const ALLOWED_IMPORTS = ['./slug.ts'];

const VALUE_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

function valueImportsOf(file: string): string[] {
  const source = readFileSync(path.join(SOURCE_ROOT, file), 'utf8');
  return [...source.matchAll(VALUE_IMPORT)].map(([, specifier]) => specifier ?? '');
}

function reachableFrom(file: string): Map<string, string[]> {
  const reached = new Map<string, string[]>();
  const pending = [file];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (reached.has(next)) continue;
    const imports = valueImportsOf(next);
    reached.set(next, imports);
    for (const specifier of imports) {
      if (specifier.startsWith('.')) {
        pending.push(path.posix.join(path.posix.dirname(next), specifier));
      }
    }
  }
  return reached;
}

describe(WIKI_LINK_SYNTAX, () => {
  it('imports only the slug module, because the editor bundle includes it', () => {
    assert.deepEqual(valueImportsOf(WIKI_LINK_SYNTAX), ALLOWED_IMPORTS);
  });

  it('reaches no Node built-in or package, directly or through what it imports', () => {
    const offences = [...reachableFrom(WIKI_LINK_SYNTAX)].flatMap(([file, imports]) =>
      imports.filter((specifier) => !specifier.startsWith('.')).map((s) => `${file}: ${s}`),
    );
    assert.deepEqual(offences, [], 'the editor bundle runs in the browser');
  });
});
