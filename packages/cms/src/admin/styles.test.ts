import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { COMMENT_STATUSES } from './store.ts';

/**
 * The admin's stylesheet is the only place its styles live, so a class a
 * template emits and the stylesheet has never heard of is a screen that
 * renders unstyled — which is exactly how the comments and messages screens
 * shipped. These tests read the templates rather than a list, so a class added
 * to one of them later has to be styled before it can land.
 */

const ADMIN_DIR = fileURLToPath(new URL('../../admin/', import.meta.url));

/**
 * The templates this file covers: the two lists of what somebody wrote, and
 * the shell every signed-in screen is drawn inside, whose menu is the one
 * thing on every page (TASK-72).
 */
const SCREENS = [
  'pages/comments/all.njk',
  'pages/messages/all.njk',
  'layouts/shell.njk',
  // Appearance > Themes, which is cards rather than a table and so brings
  // styles of its own that nothing else on the admin would have caught
  // (TASK-77).
  'pages/appearance/themes.njk',
];

/** Marks where a `{{ … }}` stood, so an interpolated name is not mistaken
 *  for a literal one. */
const HOLE = '\0';

/**
 * Every `admin-…` class a template writes into a `class` attribute.
 *
 * Nunjucks tags are dropped and the text inside them kept, because a class
 * behind an `{% if %}` is still a class the screen can show. An interpolation
 * leaves {@link HOLE} behind, so `admin-status-{{ row.status }}` is reported as
 * the prefix `admin-status-` rather than as a class nothing can match.
 */
function classNames(template: string): { literal: string[]; prefixes: string[] } {
  const literal = new Set<string>();
  const prefixes = new Set<string>();

  for (const [, value] of template.matchAll(/class="([^"]*)"/g)) {
    const text = (value ?? '').replaceAll(/\{%[^%]*%\}/g, ' ').replaceAll(/\{\{[^}]*\}\}/g, HOLE);

    for (const token of text.split(/\s+/)) {
      if (!token.startsWith('admin-')) continue;
      const hole = token.indexOf(HOLE);
      if (hole === -1) literal.add(token);
      else prefixes.add(token.slice(0, hole));
    }
  }

  return { literal: [...literal].sort(), prefixes: [...prefixes].sort() };
}

/** Every class the stylesheet has a selector for, comments ignored. */
function styledClasses(css: string): Set<string> {
  const rules = css.replaceAll(/\/\*[\s\S]*?\*\//g, ' ');
  return new Set([...rules.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(([, name]) => name ?? ''));
}

const stylesheet = await readFile(`${ADMIN_DIR}static/admin.css`, 'utf8');
const css = styledClasses(stylesheet);

/**
 * Every rule of the stylesheet, as its selector and its declarations.
 *
 * Not a CSS parser: the sheet nests nothing but `@media`, so matching the
 * innermost `selector { declarations }` pairs finds every rule there is, and an
 * `@media` line never matches one because its own block holds braces. The
 * selector is whatever follows the last brace before it, with comments dropped
 * and whitespace collapsed.
 */
function adminRules(): { selector: string; declarations: string }[] {
  return [...stylesheet.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (rule) => ({
      selector: (rule[1] ?? '')
        .replace(/^[\s\S]*\}/, '')
        .trim()
        .replace(/\s+/g, ' '),
      declarations: rule[2] ?? '',
    }),
  );
}

/**
 * What `property` settles at for `selector`, or `undefined` when no rule
 * written for exactly that selector says. The last one written wins, which is
 * how this sheet is read.
 */
function declaration(selector: string, property: string): string | undefined {
  return adminRules()
    .filter((rule) => rule.selector === selector)
    .reverse()
    .map((rule) => new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`).exec(rule.declarations)?.[1])
    .find((value) => value !== undefined)
    ?.trim();
}

describe('the admin screens', () => {
  for (const screen of SCREENS) {
    it(`has a rule for every class ${screen} emits`, async () => {
      const { literal } = classNames(await readFile(`${ADMIN_DIR}${screen}`, 'utf8'));

      assert.ok(literal.length > 0, 'the template was read and has classes');
      assert.deepEqual(
        literal.filter((name) => !css.has(name)),
        [],
        'these classes have no rule in admin.css',
      );
    });
  }

  it('has a rule for every comment status the meta line can print', async () => {
    const { prefixes } = classNames(await readFile(`${ADMIN_DIR}pages/comments/all.njk`, 'utf8'));

    assert.deepEqual(prefixes, ['admin-status-'], 'the only interpolated class is the status');
    assert.deepEqual(
      COMMENT_STATUSES.filter((status) => !css.has(`admin-status-${status}`)),
      [],
      'these statuses have no rule in admin.css',
    );
  });
});

/**
 * At a glance is six counts, and it only reads as a row when the six numbers
 * are drawn at one height. A stylesheet has no runtime to assert against, so
 * these read the rules that decide that height out of the sheet as text.
 */
describe('the At a glance counts (TASK-115)', () => {
  it('draws every number at the top of its cell, whatever its label’s length', () => {
    // A cell places its two children in named rows rather than packing them
    // from its bottom edge, so a label that wraps grows the row under the
    // number instead of pushing the number up. `column-reverse` did the
    // packing, and left the number's height to its label's.
    assert.equal(declaration('.admin-counts div', 'display'), 'grid');
    assert.equal(declaration('.admin-counts dd', 'grid-row'), '1');
    assert.equal(declaration('.admin-counts dt', 'grid-row'), '2');
    assert.equal(
      declaration('.admin-counts div', 'flex-direction'),
      undefined,
      'nothing is left packing a cell from its bottom edge',
    );

    // And a cell is as tall as its own content rather than as the tallest of
    // them, so the tallest cell cannot stretch the others' rows.
    assert.equal(declaration('.admin-counts', 'align-items'), 'start');
  });

  it('wraps to a second line rather than squeezing a label or overflowing', () => {
    // A flex line that wraps moves a cell that does not fit onto the next line
    // instead of shrinking it, which is what was breaking 'Published posts'
    // and 'Comments waiting' across two lines in a panel with room for them.
    assert.equal(declaration('.admin-counts', 'flex-wrap'), 'wrap');
  });

  it('stays a dl whose every cell is a dt then its dd', async () => {
    const home = await readFile(`${ADMIN_DIR}pages/dashboard/home.njk`, 'utf8');
    const list = /<dl class="admin-counts">([\s\S]*?)<\/dl>/.exec(home)?.[1];
    assert.ok(list !== undefined, 'At a glance is a definition list');

    const cells = [...list.matchAll(/<div>([\s\S]*?)<\/div>/g)].map(([, cell]) => cell ?? '');
    assert.ok(cells.length > 0, 'the panel was read and has cells');

    for (const cell of cells)
      assert.deepEqual(
        [...cell.matchAll(/<(dt|dd)[\s>]/g)].map(([, tag]) => tag),
        ['dt', 'dd'],
        'a cell is its label and then its number',
      );
  });
});
