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
  'layouts/comments.njk',
  'layouts/messages.njk',
  'layouts/shell.njk',
  // Appearance > Themes, which is cards rather than a table and so brings
  // styles of its own that nothing else on the admin would have caught
  // (TASK-77).
  'layouts/themes.njk',
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

const css = styledClasses(await readFile(`${ADMIN_DIR}static/admin.css`, 'utf8'));

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
    const { prefixes } = classNames(await readFile(`${ADMIN_DIR}layouts/comments.njk`, 'utf8'));

    assert.deepEqual(prefixes, ['admin-status-'], 'the only interpolated class is the status');
    assert.deepEqual(
      COMMENT_STATUSES.filter((status) => !css.has(`admin-status-${status}`)),
      [],
      'these statuses have no rule in admin.css',
    );
  });
});
