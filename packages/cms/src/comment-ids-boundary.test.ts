import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import ts from 'typescript-classic';

const PACKAGES = path.resolve(import.meta.dirname, '..', '..');

const ID = /\b(?:TASK-\d+|decision-\d+|doc-\d+)\b/gi;

const FIX =
  'keep the reason the comment gives and drop the id; the history lives in git and Backlog';

function sourceRoots(): string[] {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES, entry.name, 'src'))
    .filter((root) => existsSync(root));
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

function commentRanges(source: ts.SourceFile): ts.CommentRange[] {
  const text = source.text;
  const ranges = new Map<number, ts.CommentRange>();
  const collect = (found: ts.CommentRange[] | undefined): void => {
    for (const range of found ?? []) ranges.set(range.pos, range);
  };
  const visit = (node: ts.Node): void => {
    collect(ts.getLeadingCommentRanges(text, node.pos));
    collect(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return [...ranges.values()];
}

function idsInComments(relative: string, text: string): string[] {
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  return commentRanges(source)
    .flatMap((range) =>
      [...text.slice(range.pos, range.end).matchAll(ID)].map((match) => ({
        id: match[0],
        at: range.pos + match.index,
      })),
    )
    .sort((a, b) => a.at - b.at)
    .map(({ id, at }) => {
      const line = source.getLineAndCharacterOfPosition(at).line + 1;
      return `${relative}:${String(line)} ${id}`;
    });
}

describe('comments in source', () => {
  it('carry no ticket, decision or doc ids', () => {
    const offences = sourceFiles()
      .flatMap(({ relative, absolute }) => idsInComments(relative, readFileSync(absolute, 'utf8')))
      .map((found) => `${found}: ${FIX}`);
    assert.deepEqual(offences, []);
  });

  it('finds ids in every kind of comment and none in strings', () => {
    const text = [
      '// TASK-12: a line comment',
      '/**',
      ' * A JSDoc block (decision-3).',
      ' */',
      "const a = 'TASK-4 in a string';",
      'const b = `decision-5 in a template ${a}`; // see doc-6',
      'const c = /* TASK-7 */ 1;',
      'const d = "doc-8";',
    ].join('\n');
    assert.deepEqual(idsInComments('x.ts', text), [
      'x.ts:1 TASK-12',
      'x.ts:3 decision-3',
      'x.ts:6 doc-6',
      'x.ts:7 TASK-7',
    ]);
  });
});
