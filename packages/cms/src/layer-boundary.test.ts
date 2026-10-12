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
  { name: 'public API', units: ['exports.ts', 'config-loader.ts'] },
  { name: 'package index', units: ['index.ts'] },
  { name: 'command line', units: ['cli.ts'] },
];

const ROUTE_IN_A_FEATURE =
  'a Hono route file still inside a feature directory; it reads the request context and the delivery helpers until it moves to web/';

const EXCEPTIONS: readonly Exception[] = [
  { file: 'comments/routes.ts', mayImport: 'web/', until: 'TASK-368', because: ROUTE_IN_A_FEATURE },
  {
    file: 'comments/routes.ts',
    mayImport: 'admin/',
    until: 'TASK-368',
    because: 'a reply post from the comment form is written through the admin’s documentSite',
  },
  { file: 'comments/viewer.ts', mayImport: 'web/', until: 'TASK-368', because: ROUTE_IN_A_FEATURE },
  {
    file: 'webmention/routes.ts',
    mayImport: 'web/',
    until: 'TASK-368',
    because: ROUTE_IN_A_FEATURE,
  },
  {
    file: 'webmention/pingback.ts',
    mayImport: 'web/',
    until: 'TASK-368',
    because: ROUTE_IN_A_FEATURE,
  },
  {
    file: 'federation/mount.ts',
    mayImport: 'web/',
    until: 'TASK-368',
    because: ROUTE_IN_A_FEATURE,
  },
];

const RELATIVE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

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

interface Import {
  readonly from: string;
  readonly to: string;
  readonly file: string;
  readonly at: string;
}

function sourceImports(): Import[] {
  const found: Import[] = [];
  for (const entry of readdirSync(SOURCE_ROOT, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(SOURCE_ROOT, file);
    if (!isSource(relative)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const [, specifier] of line.matchAll(RELATIVE_IMPORT)) {
          if (specifier === undefined) continue;
          const landed = path.relative(SOURCE_ROOT, path.resolve(path.dirname(file), specifier));
          const to = unitOf(landed);
          const from = unitOf(relative);
          if (to === from) continue;
          found.push({ from, to, file: relative, at: `${relative}:${String(index + 1)}` });
        }
      });
  }
  return found;
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

  it('lists only exceptions that an import still needs', () => {
    const imports = sourceImports();
    const stale = EXCEPTIONS.filter(
      (exception) =>
        !imports.some(({ file, to }) => file === exception.file && to === exception.mayImport),
    ).map(({ file, mayImport }) => `${file} -> ${mayImport}`);
    assert.deepEqual(stale, []);
  });
});
