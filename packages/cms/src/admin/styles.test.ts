import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import { adminFile } from './__testing__/admin-files.ts';
import { DAISYUI_ADMIN_DIR } from './templates.ts';

/**
 * Tailwind writes a rule only for a class it knows, so a class token with no
 * rule in the compiled output is a misspelling, a DaisyUI class that does not
 * exist, or one built by interpolation where Tailwind could not read it. And
 * every built-in theme draws the admin only while its colours are the theme's
 * semantic tokens.
 */

const TEMPLATES = (await readdir(DAISYUI_ADMIN_DIR, { recursive: true }))
  .filter((file) => file.endsWith('.njk'))
  .sort();

const COMPILED = await readFile(path.join(DAISYUI_ADMIN_DIR, 'static', 'admin.css'), 'utf8');

const HOLE = '\0';

const COLOUR_UTILITY =
  '(?:bg|text|border(?:-[xytrblse])?|outline|ring|ring-offset|fill|stroke|from|via|to|decoration|accent|caret|divide|placeholder|shadow|inset-shadow|drop-shadow)';

const PALETTE = new RegExp(
  `(?:^|:)!?${COLOUR_UTILITY}-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)|black|white)(?:/[^\\s]+)?!?$`,
);

const ARBITRARY = new RegExp(`(?:^|:)!?${COLOUR_UTILITY}-(?:\\[([^\\]]*)\\]|\\(([^)]*)\\))`);

const ARBITRARY_PROPERTY = /(?:^|:)\[([\w-]+):([^\]]*)\]/;

const NOT_A_COLOUR = new Set([
  'auto',
  'none',
  'inherit',
  'initial',
  'unset',
  'revert',
  'transparent',
  'currentcolor',
]);

/** A CSS colour written out: hex, a colour function, a custom property or a
 *  named colour. A length, a URL or a keyword that is not a colour is not. */
function namesAColour(value: string): boolean {
  const written =
    /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|var\(|^--|^color:/i;
  return written.test(value) || (/^[a-z]+$/i.test(value) && !NOT_A_COLOUR.has(value.toLowerCase()));
}

/**
 * Every class token a template can emit, and every one it builds by
 * interpolation instead of writing out.
 *
 * Read from three places. A `class` attribute, with Nunjucks tags dropped and
 * the text inside them kept. A string literal inside an interpolation there, as in
 * `{{ 'tab-active' if current }}`. And a modifier map, a `{% set %}` dict that
 * the template passes through the `modifier` filter. Any other interpolation
 * in a class is reported as built.
 */
function classTokens(template: string): { classes: string[]; built: string[] } {
  const source = template.replaceAll(/\{#[\s\S]*?#\}/g, ' ');
  const classes = new Set<string>();
  const built = new Set<string>();

  const maps = new Set([...source.matchAll(/(\w+)\s*\|\s*modifier\b/g)].map(([, name]) => name));
  for (const [, name, body] of source.matchAll(
    /\{%-?\s*set\s+(\w+)\s*=\s*\{([\s\S]*?)\}\s*-?%\}/g,
  )) {
    if (!maps.has(name)) continue;
    for (const [, single, double] of (body ?? '').matchAll(/:\s*(?:'([^']*)'|"([^"]*)")/g)) {
      for (const token of (single ?? double ?? '').split(/\s+/)) if (token) classes.add(token);
    }
  }

  for (const [, value] of source.matchAll(/\bclass="([^"]*)"/g)) {
    const text = (value ?? '')
      .replaceAll(/\{%[\s\S]*?%\}/g, ' ')
      .replaceAll(/\{\{([\s\S]*?)\}\}/g, (_, expression: string) => {
        if (/^\s*\w+\s*\|\s*modifier\(/.test(expression)) return ' ';
        const literals = [...expression.matchAll(/'([^']*)'|"([^"]*)"/g)].map(
          ([, single, double]) => single ?? double ?? '',
        );
        return literals.length > 0 ? ` ${literals.join(' ')} ` : HOLE;
      });
    for (const token of text.split(/\s+/)) {
      if (token === '') continue;
      if (token.includes(HOLE)) built.add(token.replaceAll(HOLE, '{{…}}'));
      else classes.add(token);
    }
  }

  return { classes: [...classes].sort(), built: [...built].sort() };
}

/** Every class a stylesheet has a selector for, unescaped. */
function styledClasses(css: string): Set<string> {
  const rules = css.replaceAll(/\/\*[\s\S]*?\*\//g, ' ');
  return new Set(
    [...rules.matchAll(/\.((?:\\[0-9a-fA-F]{1,6}\s?|\\[^0-9a-fA-F\s]|[\w-])+)/g)].map(([, name]) =>
      (name ?? '')
        .replaceAll(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
          String.fromCodePoint(Number.parseInt(hex, 16)),
        )
        .replaceAll(/\\(.)/g, '$1'),
    ),
  );
}

const STYLED = styledClasses(COMPILED);

/**
 * The templates no DaisyUI theme draws, which decision-30 lists among its
 * authored exceptions. The admin bar is drawn in a shadow root, where the theme
 * stops, by a plain stylesheet of its own, so its classes are held to that
 * sheet instead of to admin.css. The public site's entry to the bar adds the
 * notice printed under it on a page the site's own theme draws, styled inline
 * in colours of its own, so neither check reads that template.
 */
const OWN_STYLESHEET: Readonly<Record<string, string>> = {
  'components/admin-bar.njk': 'static/admin-bar.css',
};
const ON_THE_PUBLIC_SITE: ReadonlySet<string> = new Set(['components/public-admin-bar.njk']);

/** The classes `template` is held to: its own stylesheet's, or admin.css's. */
async function stylesFor(template: string): Promise<Set<string>> {
  const own = OWN_STYLESHEET[template];
  return own === undefined
    ? STYLED
    : styledClasses(await readFile(path.join(DAISYUI_ADMIN_DIR, own), 'utf8'));
}

/** The classes `template` emits that `styled` has no rule for, and the ones it
 *  builds by interpolation. */
function unstyled(template: string, styled: Set<string>): { missing: string[]; built: string[] } {
  const { classes, built } = classTokens(template);
  return { missing: classes.filter((name) => !styled.has(name)), built };
}

/** Every colour in `template` that is not one of the theme's semantic tokens. */
function foreignColours(template: string): string[] {
  const source = template.replaceAll(/\{#[\s\S]*?#\}/g, ' ');
  const found: string[] = [];

  for (const token of classTokens(template).classes) {
    const arbitrary = ARBITRARY.exec(token);
    const property = ARBITRARY_PROPERTY.exec(token);
    if (PALETTE.test(token)) found.push(token);
    else if (arbitrary && namesAColour(arbitrary[1] ?? arbitrary[2] ?? '')) found.push(token);
    else if (
      property &&
      /color|^background|^fill$|^stroke$|^border|^outline|shadow$/.test(property[1] ?? '') &&
      namesAColour(property[2] ?? '')
    )
      found.push(token);
  }

  const outsideLinks = source.replaceAll(/\b(?:href|src|action|formaction)="[^"]*"/g, ' ');
  for (const [hex] of outsideLinks.matchAll(
    /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi,
  ))
    found.push(hex);
  for (const [fn] of source.matchAll(/\b(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch|color-mix)\(/g))
    found.push(fn);

  return found;
}

describe('the DaisyUI admin templates', () => {
  it('are found by reading daisyui/', () => {
    assert.ok(
      TEMPLATES.includes('layouts/base.njk') && TEMPLATES.includes('components/button.njk'),
      `the templates were found: ${TEMPLATES.join(', ')}`,
    );
  });

  it('names only templates that exist among its exceptions', () => {
    for (const template of [...Object.keys(OWN_STYLESHEET), ...ON_THE_PUBLIC_SITE]) {
      assert.ok(TEMPLATES.includes(template), `${template} is in daisyui/`);
    }
  });

  for (const template of TEMPLATES.filter((name) => !ON_THE_PUBLIC_SITE.has(name))) {
    it(`${template} writes every class out in full, and each has a rule in ${OWN_STYLESHEET[template] ?? 'the compiled sheet'}`, async () => {
      const source = await readFile(path.join(DAISYUI_ADMIN_DIR, template), 'utf8');
      const { missing, built } = unstyled(source, await stylesFor(template));

      assert.deepEqual(
        built,
        [],
        'these classes are built by interpolation, which Tailwind cannot read',
      );
      assert.deepEqual(missing, [], 'these classes have no rule in the stylesheet that draws them');
    });

    it(`${template} draws in the theme's semantic colours alone`, async () => {
      const source = await readFile(path.join(DAISYUI_ADMIN_DIR, template), 'utf8');
      assert.deepEqual(foreignColours(source), [], 'these colours are not semantic tokens');
    });
  }

  it('would refuse a misspelt, built or foreign class wherever a template writes it', () => {
    assert.deepEqual(unstyled('<b class="btn btn-primay">', STYLED).missing, ['btn-primay']);
    assert.deepEqual(
      unstyled(`{% set M = { a: 'btn-primay' } %}<b class="btn{{ M | modifier(x) }}">`, STYLED)
        .missing,
      ['btn-primay'],
    );
    assert.deepEqual(unstyled(`<b class="{% if x %}btn-primay{% endif %}">`, STYLED).missing, [
      'btn-primay',
    ]);
    assert.deepEqual(unstyled(`<b class="btn{{ ' btn-primay' if x }}">`, STYLED).missing, [
      'btn-primay',
    ]);
    assert.deepEqual(unstyled('<b class="btn btn-{{ color }} {{ extra }}">', STYLED).built, [
      'btn-{{…}}',
      '{{…}}',
    ]);
    assert.deepEqual(
      unstyled('<b class="btn btn-primary bg-base-200 sm:alert-horizontal">', STYLED),
      {
        missing: [],
        built: [],
      },
    );

    assert.deepEqual(
      foreignColours(
        '<b class="bg-gray-200 hover:text-white border-red-500/50 bg-[#123456] text-(--brand) [color:red] text-[tomato]"><svg fill="#fff"></svg><p style="color: rgb(0 0 0)">',
      ),
      [
        '[color:red]',
        'bg-[#123456]',
        'bg-gray-200',
        'border-red-500/50',
        'hover:text-white',
        'text-(--brand)',
        'text-[tomato]',
        '#123456',
        '#fff',
        'rgb(',
      ],
    );
    assert.deepEqual(
      foreignColours(
        '<a class="btn btn-neutral bg-base-200 text-base-content text-neutral-content text-[13px] shadow-sm" href="#feed">',
      ),
      [],
    );
  });
});

const stylesheet = await readFile(adminFile('static/admin.css'), 'utf8');

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

  it('leaves a panel in the grid to the grid, and spaces the ones that stack', () => {
    // The dashboard's two panels are siblings in `.admin-panels`, whose `gap`
    // is already the space between them; an unscoped adjacent-sibling margin
    // also matched there and pushed Recent posts down inside its own cell.
    // The Followers screen stacks its panels in normal flow and still needs it.
    const stacking = adminRules().filter(
      (rule) =>
        /\.admin-panel \+ \.admin-panel/.test(rule.selector) &&
        /margin-top/.test(rule.declarations),
    );

    assert.equal(stacking.length, 1, 'one rule spaces stacked panels');
    assert.match(
      stacking[0]?.selector ?? '',
      /:not\(\.admin-panels\) >/,
      'and it does not reach a panel the dashboard grid is laying out',
    );

    // The grid spaces its cells in both directions, so a wrapped row is spaced
    // too, which is what the margin would otherwise have been covering.
    assert.equal(declaration('.admin-panels', 'gap'), '1rem');
    assert.equal(declaration('.admin-panels', 'align-items'), 'start');
  });

  it('stays a dl whose every cell is a dt then its dd', async () => {
    const home = await readFile(adminFile('pages/dashboard/home.njk'), 'utf8');
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
