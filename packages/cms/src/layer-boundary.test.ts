import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = import.meta.dirname;

interface Layer {
  readonly name: string;
  readonly units: readonly string[];
}

interface Exception {
  readonly file: string;
  readonly mayImport: string;
  readonly until: string;
  readonly because: string;
}

const LAYERS: readonly Layer[] = [
  { name: 'utilities', units: ['util/', 'types/', 'init.ts'] },
  { name: 'files', units: ['files/'] },
  { name: 'caches', units: ['cache.ts', 'dev-mode.ts'] },
  { name: 'content', units: ['content/'] },
  { name: 'operational state', units: ['store/', 'maintenance.ts'] },
  { name: 'ports', units: ['forms/', 'mail/', 'plugin.ts'] },
  { name: 'config', units: ['config.ts'] },
  { name: 'theme', units: ['theme/'] },
  { name: 'images', units: ['images/'] },
  { name: 'site', units: ['site/'] },
  { name: 'comments', units: ['comments/'] },
  { name: 'notifications', units: ['notifications/'] },
  { name: 'contact', units: ['contact/'] },
  { name: 'privacy', units: ['privacy/'] },
  { name: 'webmention', units: ['webmention/'] },
  { name: 'federation', units: ['federation/'] },
  { name: 'services', units: ['avatars/', 'media/', 'indieauth/'] },
  { name: 'plugins', units: ['plugins/'] },
  { name: 'supervisor', units: ['supervisor/'] },
  { name: 'public site', units: ['web/'] },
  { name: 'admin', units: ['admin/'] },
  { name: 'endpoints and middleware', units: ['micropub/', 'access-log.ts', 'drain.ts'] },
  { name: 'publish pings', units: ['notify.ts', 'indexnow.ts'] },
  { name: 'composition root', units: ['cms/'] },
  { name: 'public API', units: ['exports.ts', 'testing.ts', 'config-loader.ts'] },
  { name: 'package index', units: ['index.ts'] },
  { name: 'command line', units: ['cli.ts'] },
];

const EXCEPTIONS: readonly Exception[] = [];

const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/g;

const HTTP_FRAMEWORK = /^(?:hono|@hono\/[^/]+|@fedify\/hono)(?:\/|$)/;

const LOWEST_HTTP_LAYER = 'web/';

function unitOf(relative: string): string {
  const [first = '', ...rest] = relative.split(path.sep);
  return rest.length === 0 ? first : `${first}/`;
}

function isSource(relative: string): boolean {
  return (
    relative.endsWith('.ts') &&
    !relative.endsWith('.test.ts') &&
    !relative.split(path.sep).includes('__testing__')
  );
}

interface Specifier {
  readonly specifier: string;
  readonly file: string;
  readonly absolute: string;
  readonly at: string;
}

function sourceSpecifiers(): Specifier[] {
  const found: Specifier[] = [];
  for (const entry of readdirSync(SOURCE_ROOT, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const file = path.relative(SOURCE_ROOT, absolute);
    if (!isSource(file)) continue;
    readFileSync(absolute, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const [, specifier] of line.matchAll(IMPORT)) {
          if (specifier === undefined) continue;
          found.push({ specifier, file, absolute, at: `${file}:${String(index + 1)}` });
        }
      });
  }
  return found;
}

interface Import {
  readonly from: string;
  readonly to: string;
  readonly file: string;
  readonly at: string;
}

function sourceImports(): Import[] {
  return sourceSpecifiers()
    .filter(({ specifier }) => specifier.startsWith('./') || specifier.startsWith('../'))
    .flatMap(({ specifier, file, absolute, at }) => {
      const landed = path.relative(SOURCE_ROOT, path.resolve(path.dirname(absolute), specifier));
      const from = unitOf(file);
      const to = unitOf(landed);
      return to === from ? [] : [{ from, to, file, at }];
    });
}

function topLevelUnits(): string[] {
  return readdirSync(SOURCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || isSource(entry.name))
    .filter((entry) => entry.name !== '__testing__')
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
}

const layerOf = new Map(
  LAYERS.flatMap((layer, rank) => layer.units.map((unit) => [unit, { ...layer, rank }] as const)),
);

function excepted({ file, to }: Import): boolean {
  return EXCEPTIONS.some((exception) => exception.file === file && exception.mayImport === to);
}

describe('the layer map', () => {
  it('places every top-level directory and file in exactly one layer', () => {
    const placed = LAYERS.flatMap((layer) => layer.units);
    assert.deepEqual(
      topLevelUnits().filter((unit) => !layerOf.has(unit)),
      [],
      'each unit needs a layer in LAYERS',
    );
    assert.deepEqual(
      placed.filter((unit, index) => placed.indexOf(unit) !== index),
      [],
      'a unit is listed in two layers',
    );
  });

  it('keeps every import pointing at a lower layer', () => {
    const offences = sourceImports()
      .filter((found) => !excepted(found))
      .flatMap(({ from, to, at }) => {
        const own = layerOf.get(from);
        const target = layerOf.get(to);
        if (own === undefined || target === undefined || target.rank < own.rank) return [];
        const where = target.rank === own.rank ? 'its own layer' : 'a higher layer';
        return [
          `${from} (${own.name}) must not import from ${to} (${target.name}, ${where}): ${at}`,
        ];
      });
    assert.deepEqual(offences, []);
  });

  it('keeps Hono out of every layer below the public site', () => {
    const lowest = layerOf.get(LOWEST_HTTP_LAYER)?.rank;
    assert.ok(lowest !== undefined, `${LOWEST_HTTP_LAYER} needs a layer in LAYERS`);
    const offences = sourceSpecifiers()
      .filter(({ specifier }) => HTTP_FRAMEWORK.test(specifier))
      .flatMap(({ specifier, file, at }) => {
        const own = layerOf.get(unitOf(file));
        if (own === undefined || own.rank >= lowest) return [];
        return [
          `${unitOf(file)} (${own.name}) must not import ${specifier}; HTTP handlers live in ${LOWEST_HTTP_LAYER} or above: ${at}`,
        ];
      });
    assert.deepEqual(offences, []);
  });

  it('lists only exceptions that an import still needs', () => {
    const imports = sourceImports();
    const stale = EXCEPTIONS.filter(
      (exception) =>
        !imports.some(({ file, to }) => file === exception.file && to === exception.mayImport),
    ).map(({ file, mayImport }) => `${file} -> ${mayImport}`);
    assert.deepEqual(stale, []);
  });
});
