import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import ts from 'typescript-classic';

const PACKAGES = path.resolve(import.meta.dirname, '..', '..');

const ALLOWED = [
  'cms/src/files/data-files.ts',
  'cms/src/settings/registry.ts',
  'cms/src/plugins/settings.ts',
];

const JOINS = new Set(['join', 'resolve']);

const FIX = 'build the path with `dataPath` and a declaration in files/data-files.ts (decision-55)';

function sourceRoots(): string[] {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && (entry.name === 'cms' || entry.name.startsWith('plugin-')),
    )
    .map((entry) => path.join(PACKAGES, entry.name, 'src'));
}

function isSource(relative: string): boolean {
  return (
    relative.endsWith('.ts') &&
    !relative.endsWith('.test.ts') &&
    !relative.split('/').includes('__testing__')
  );
}

function sourceFiles(): { relative: string; absolute: string }[] {
  return sourceRoots().flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const absolute = path.join(entry.parentPath, entry.name);
        return { absolute, relative: path.relative(PACKAGES, absolute).split(path.sep).join('/') };
      })
      .filter(({ relative }) => isSource(relative)),
  );
}

function isJoin(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return JOINS.has(callee.text);
  return (
    ts.isPropertyAccessExpression(callee) &&
    JOINS.has(callee.name.text) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'path'
  );
}

function namesDataDir(argument: ts.Expression | undefined): boolean {
  if (argument === undefined) return false;
  if (ts.isIdentifier(argument)) return argument.text === 'dataDir';
  return ts.isPropertyAccessExpression(argument) && argument.name.text === 'dataDir';
}

function dataDirJoins(relative: string, text: string): string[] {
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      isJoin(node.expression) &&
      node.arguments.length > 1 &&
      namesDataDir(node.arguments[0])
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push(`${relative}:${String(line + 1)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('paths under dataDir', () => {
  it('are built by dataPath, outside the modules that own a folder of their own', () => {
    const offences = sourceFiles()
      .filter(({ relative }) => !ALLOWED.includes(relative))
      .flatMap(({ relative, absolute }) => dataDirJoins(relative, readFileSync(absolute, 'utf8')))
      .map((at) => `${at} joins a path onto dataDir: ${FIX}`);
    assert.deepEqual(offences, []);
  });

  it('finds a join that spans several lines and one through a property', () => {
    const text = [
      "import path from 'node:path';",
      'const a = path.join(',
      '  config.dataDir,',
      "  'users.json',",
      ');',
      "const b = join(dataDir, 'x');",
      "const c = path.resolve(dirs.dataDir, 'y');",
      "const d = path.join(contentDir, 'z');",
      'const e = path.resolve(dataDir);',
    ].join('\n');
    assert.deepEqual(dataDirJoins('x.ts', text), ['x.ts:2', 'x.ts:6', 'x.ts:7']);
  });
});
