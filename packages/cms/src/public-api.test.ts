import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SOURCE_ROOT = import.meta.dirname;
const PACKAGES = path.join(SOURCE_ROOT, '..', '..');
const DOCS = path.join(PACKAGES, '..', 'docs');
const API_DOC = path.join(DOCS, 'public-api.md');
const PLUGINS_DOC = path.join(DOCS, 'plugins.md');
const TESTING_SECTION = '### Testing a plugin';
const ROOT_FILES = ['index.ts', 'exports.ts'];
const TESTING_FILES = ['testing.ts'];
const CONFIG_FILES = ['config-entry.ts'];
const ENTRY_RE_EXPORT = "export * from './exports.ts';";

const ROOT = '@geekity/cms';
const CONFIG_ENTRY = '@geekity/cms/config';
const PLUGIN_ENTRY = '@geekity/cms/plugin';
const TESTING_ENTRY = '@geekity/cms/testing';

const NAMED_EXPORT = /^export\s+(type\s+)?\{([^}]*)\}\s+from\s+'[^']+';/gm;
const DOCUMENTED_EXPORT = /^\| `([A-Za-z_$][\w$]*)` +\|/gm;
const NAMED_IMPORT = /\bimport\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g;
const ANY_CORE_IMPORT =
  /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"](@geekity\/cms(?:\/[\w.-]+)?)['"]/gm;

interface EntryExports {
  readonly values: readonly string[];
  readonly types: readonly string[];
}

interface NamedList {
  readonly values: string[];
  readonly types: string[];
}

function splitNames(list: string, typeOnly: boolean, into: NamedList): void {
  for (const raw of list.split(',')) {
    const element = raw.trim();
    if (element === '') continue;
    const isType = typeOnly || element.startsWith('type ');
    const name =
      element
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .at(-1) ?? element;
    (isType ? into.types : into.values).push(name);
  }
}

function entryExports(files: readonly string[]): EntryExports {
  const found: NamedList = { values: [], types: [] };
  for (const file of files) {
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
      splitNames(list, typeOnly !== undefined, found);
    }
  }
  return { values: found.values.sort(), types: found.types.sort() };
}

function documentedIn(text: string): string[] {
  return [...text.matchAll(DOCUMENTED_EXPORT)].map(([, name = '']) => name).sort();
}

function documentedRootExports(): string[] {
  return documentedIn(readFileSync(API_DOC, 'utf8'));
}

function documentedTestingExports(): string[] {
  const text = readFileSync(PLUGINS_DOC, 'utf8');
  const start = text.indexOf(`\n${TESTING_SECTION}\n`);
  assert.notEqual(start, -1, `docs/plugins.md needs a "${TESTING_SECTION}" section`);
  const rest = text.slice(start + TESTING_SECTION.length + 1);
  const end = rest.search(/\n#/);
  return documentedIn(end === -1 ? rest : rest.slice(0, end));
}

function duplicates(names: readonly string[]): string[] {
  return names.filter((name, index) => names.indexOf(name) !== index);
}

interface PluginImport {
  readonly at: string;
  readonly specifier: string;
  readonly names: readonly string[];
}

interface PluginFile {
  readonly at: string;
  readonly folder: 'src' | 'test' | 'scripts';
  readonly text: string;
}

function pluginFiles(): PluginFile[] {
  const files: PluginFile[] = [];
  const plugins = readdirSync(PACKAGES).filter((name) => name.startsWith('plugin-'));
  assert.ok(plugins.length > 0, `no plugin packages beside packages/cms in ${PACKAGES}`);
  for (const plugin of plugins) {
    for (const folder of ['src', 'test', 'scripts'] as const) {
      const dir = path.join(PACKAGES, plugin, folder);
      let entries;
      try {
        entries = readdirSync(dir, { recursive: true, withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
        const absolute = path.join(entry.parentPath, entry.name);
        files.push({
          at: path.relative(PACKAGES, absolute),
          folder,
          text: readFileSync(absolute, 'utf8'),
        });
      }
    }
  }
  return files;
}

function coreImports(file: PluginFile): PluginImport[] {
  const imports = [...file.text.matchAll(NAMED_IMPORT)]
    .filter(([, , , specifier = '']) => specifier === ROOT || specifier.startsWith(`${ROOT}/`))
    .map(([, typeOnly, list = '', specifier = '']) => {
      const names: NamedList = { values: [], types: [] };
      splitNames(list, typeOnly !== undefined, names);
      return { at: file.at, specifier, names: [...names.values, ...names.types] };
    });
  assert.equal(
    imports.length,
    [...file.text.matchAll(ANY_CORE_IMPORT)].length,
    `${file.at} reaches ${ROOT} other than through \`import { … } from\`; this check reads only named imports`,
  );
  return imports;
}

describe('the root entry of @geekity/cms', () => {
  it('exports at runtime exactly the values its export statements name', async () => {
    const runtime = Object.keys(await import('./index.ts')).sort();

    assert.deepEqual(runtime, entryExports(ROOT_FILES).values);
  });

  it('exports exactly the names docs/public-api.md lists', () => {
    const { values, types } = entryExports(ROOT_FILES);
    const exported = [...values, ...types].sort();
    const documented = documentedRootExports();

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
    const { values, types } = entryExports(ROOT_FILES);

    assert.deepEqual(duplicates([...values, ...types]), []);
    assert.deepEqual(duplicates(documentedRootExports()), []);
  });
});

describe(`the ${CONFIG_ENTRY} entry`, () => {
  it('exports at runtime exactly the values its export statements name', async () => {
    const runtime = Object.keys(await import('./config-entry.ts')).sort();

    assert.deepEqual(runtime, entryExports(CONFIG_FILES).values);
  });

  it('exports only names the root entry also exports, so a config can import from either', () => {
    const root = entryExports(ROOT_FILES);
    const config = entryExports(CONFIG_FILES);

    assert.deepEqual(
      [...config.values, ...config.types].filter(
        (name) => !root.values.includes(name) && !root.types.includes(name),
      ),
      [],
    );
  });
});

describe('the @geekity/cms/testing entry', () => {
  it('exports at runtime exactly the values its export statements name', async () => {
    const runtime = Object.keys(await import('./testing.ts')).sort();

    assert.deepEqual(runtime, entryExports(TESTING_FILES).values);
  });

  it('exports exactly the names the Testing a plugin table in docs/plugins.md lists', () => {
    const { values, types } = entryExports(TESTING_FILES);
    const exported = [...values, ...types].sort();
    const documented = documentedTestingExports();

    assert.deepEqual(
      {
        undocumented: exported.filter((name) => !documented.includes(name)),
        gone: documented.filter((name) => !exported.includes(name)),
      },
      { undocumented: [], gone: [] },
      `Add each export of src/testing.ts to the "${TESTING_SECTION}" table in docs/plugins.md, or take it out.`,
    );
    assert.deepEqual(duplicates(exported), []);
  });

  it('exports only values a plugin test imports from it', () => {
    const imported = new Set(
      pluginFiles()
        .filter((file) => file.folder === 'test')
        .flatMap(coreImports)
        .filter(({ specifier }) => specifier === TESTING_ENTRY)
        .flatMap(({ names }) => names),
    );

    assert.deepEqual(
      entryExports(TESTING_FILES).values.filter((name) => !imported.has(name)),
      [],
      `Each value in ${TESTING_ENTRY} exists for a plugin test; remove one no plugin test imports.`,
    );
  });
});

describe('the plugin packages', () => {
  it('import from the root entry only the names docs/public-api.md lists', () => {
    const documented = documentedRootExports();
    const offences = pluginFiles()
      .flatMap(coreImports)
      .filter(({ specifier }) => specifier === ROOT)
      .flatMap(({ at, names }) =>
        names.filter((name) => !documented.includes(name)).map((name) => `${name}: ${at}`),
      );

    assert.deepEqual(
      offences,
      [],
      `A plugin test builds its host from ${TESTING_ENTRY} or ${PLUGIN_ENTRY}; ` +
        `the root entry holds only what docs/public-api.md lists.`,
    );
  });

  it(`reach core from src/ only through ${PLUGIN_ENTRY}, so a bundle never carries test helpers`, () => {
    const offences = pluginFiles()
      .filter((file) => file.folder === 'src')
      .flatMap(coreImports)
      .filter(({ specifier }) => specifier !== PLUGIN_ENTRY)
      .map(({ at, specifier }) => `${specifier}: ${at}`);

    assert.deepEqual(offences, []);
  });
});
