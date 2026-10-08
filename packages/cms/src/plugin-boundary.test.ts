/**
 * What left core for `@geekity/plugin-wordpress` (decision-33, TASK-282): no
 * code in this package names the platform that plugin is for. Comments may
 * still cite its conventions as the reason for a layout core keeps by
 * decision (decision-14): the feed and archive URLs, stored ids, oEmbed.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');

/** The directories that hold this package's code, templates and scripts. */
const SOURCE_DIRECTORIES = ['src', 'admin', 'scripts', 'templates', 'themes', 'editor'];

/** Built or vendored output, which nobody here writes by hand. */
const GENERATED = new Set([
  'admin/static/editor.js',
  'admin/static/admin.css',
  'themes/default/static/style.css',
  'themes/default/static/highlight.js',
]);

const CODE = /\.(?:ts|js|mjs|cjs|njk|html|css|json)$/;

/** The platform's name, spelled so this file does not match itself. */
const NAMED = new RegExp(['word', 'press'].join(''), 'i');

describe('core after the WordPress plugin left it', () => {
  it('names the platform in no code, template or script', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = withoutComments(readFileSync(path.join(PACKAGE_ROOT, file), 'utf8'), file);
      code.split('\n').forEach((line, index) => {
        if (NAMED.test(line)) offenders.push(`${file}:${String(index + 1)}: ${line.trim()}`);
      });
    }
    assert.deepEqual(offenders, []);
  });

  it('finds a name in code and not in a comment', () => {
    const name = ['Word', 'Press'].join('');
    assert.ok(NAMED.test(withoutComments(`const x = '${name}'; // fine`, 'a.ts')));
    assert.ok(!NAMED.test(withoutComments(`const x = 1; // ${name}\n/* ${name} */`, 'a.ts')));
    assert.ok(!NAMED.test(withoutComments(`{# ${name} #}<p>ok</p>`, 'a.njk')));
    assert.ok(NAMED.test(withoutComments(`<p>${name}</p>`, 'a.njk')));
  });
});

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const directory of SOURCE_DIRECTORIES) {
    for (const entry of readdirSync(path.join(PACKAGE_ROOT, directory), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !CODE.test(entry.name)) continue;
      const file = path.relative(PACKAGE_ROOT, path.join(entry.parentPath, entry.name));
      if (file.split(path.sep).includes('node_modules') || GENERATED.has(file)) continue;
      if (path.resolve(PACKAGE_ROOT, file) === import.meta.filename) continue;
      files.push(file);
    }
  }
  return files;
}

/**
 * The text with its comments blanked and its lines kept: `//` and `/* *\/`
 * outside strings for script and style, `{# #}` and `<!-- -->` for templates.
 */
function withoutComments(text: string, file: string): string {
  if (/\.(?:njk|html)$/.test(file)) {
    return text.replace(/\{#[\s\S]*?#\}|<!--[\s\S]*?-->/g, (comment) => blankLines(comment));
  }
  if (file.endsWith('.json')) return text;

  let out = '';
  let quote: string | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (quote !== undefined) {
      out += char;
      if (char === '\\') {
        out += text[i + 1] ?? '';
        i += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = (end === -1 ? text.length : end) - 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += blankLines(text.slice(i, stop));
      i = stop - 1;
      continue;
    }
    out += char;
  }
  return out;
}

function blankLines(comment: string): string {
  return comment.replace(/[^\n]/g, '');
}
