import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import { DAISYUI } from '../../editor/look.ts';
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

  it('has a rule for every class the editor script writes, in the theme’s colours alone', () => {
    const classes = Object.values(DAISYUI).join(' ').split(/\s+/).filter(Boolean);
    assert.deepEqual(
      classes.filter((name) => !STYLED.has(name)),
      [],
      'these classes in editor/look.ts have no rule in the compiled sheet',
    );
    assert.deepEqual(foreignColours(`<b class="${classes.join(' ')}">`), []);
  });

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
