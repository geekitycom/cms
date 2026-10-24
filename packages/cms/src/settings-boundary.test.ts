import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = import.meta.dirname;

const SETTINGS = 'settings';

const FORBIDDEN = ['admin/', 'web/', 'cms/', 'plugins/', 'cli/', 'cli.ts'];

const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/g;

function isSource(relative: string): boolean {
  return (
    relative.endsWith('.ts') &&
    !relative.endsWith('.test.ts') &&
    !relative.split(path.sep).includes('__testing__')
  );
}

function forbiddenImports(): string[] {
  const found: string[] = [];
  const root = path.join(SOURCE_ROOT, SETTINGS);
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const file = path.relative(SOURCE_ROOT, absolute).split(path.sep).join('/');
    if (!isSource(file)) continue;
    readFileSync(absolute, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const [, specifier] of line.matchAll(IMPORT)) {
          if (specifier === undefined || !specifier.startsWith('.')) continue;
          const landed = path
            .relative(SOURCE_ROOT, path.resolve(path.dirname(absolute), specifier))
            .split(path.sep)
            .join('/');
          if (FORBIDDEN.some((place) => landed === place || landed.startsWith(place))) {
            found.push(`${file}:${String(index + 1)} imports ${specifier}`);
          }
        }
      });
  }
  return found;
}

describe('the settings registry', () => {
  it(`imports nothing from ${FORBIDDEN.join(', ')}`, () => {
    assert.deepEqual(
      forbiddenImports(),
      [],
      'the registry owns the data contract only: admin pages, routes and commands import it, ' +
        'never the other way round (decision-53)',
    );
  });
});

const RENDERER = ['web/render.ts', 'web/page-sources.ts'];

const REGISTRY = ['settings/', 'site/namespace.ts'];

function registryReads(): string[] {
  const found: string[] = [];
  for (const file of RENDERER) {
    const absolute = path.join(SOURCE_ROOT, file);
    readFileSync(absolute, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const where = `${file}:${String(index + 1)}`;
        if (/\bSettingsRegistry\b/.test(line)) found.push(`${where} names SettingsRegistry`);
        for (const [, specifier] of line.matchAll(IMPORT)) {
          if (specifier === undefined || !specifier.startsWith('.')) continue;
          const landed = path
            .relative(SOURCE_ROOT, path.resolve(path.dirname(absolute), specifier))
            .split(path.sep)
            .join('/');
          if (REGISTRY.some((place) => landed === place || landed.startsWith(place))) {
            found.push(`${where} imports ${specifier}`);
          }
        }
      });
  }
  return found;
}

describe('the renderer', () => {
  it('reads no settings of its own, only the site values its caller hands it', () => {
    assert.deepEqual(
      registryReads(),
      [],
      'the renderer stays synchronous: a handler reads the settings and hands the values in ' +
        'as a request input (decision-53, wave 3)',
    );
  });
});
