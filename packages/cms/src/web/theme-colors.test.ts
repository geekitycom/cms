/**
 * The default theme's colours, checked against WCAG 2.2.
 *
 * The ratios are arithmetic here rather than a promise in a README: the test
 * reads the custom properties out of the compiled `static/style.css` (the
 * `:root` block that declares the `--color-*` tokens for the light scheme and
 * the one inside `@media (prefers-color-scheme: dark)` for the dark) and
 * computes the contrast of every pair the design puts on screen. A colour
 * changed in the theme's source that breaks one of them fails here rather than
 * in front of somebody trying to read a post.
 *
 * The bar is the Colour contrast rule of the specification.website checklist
 * (TASK-187, doc-9): every run of text, the small sans kickers, dates and meta
 * lines and the highlighter's token colours included, at 7:1 (WCAG 1.4.6, AAA)
 * on whatever it sits on; every border a reader relies on to find a control or
 * a boundary at 3:1 (1.4.11).
 * `--color-rule` is in no pair: it is a decorative hairline, and nothing a
 * reader needs is drawn with it.
 *
 * {@link PAIRS} is the table to extend.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { PACKAGED_THEME_DIR } from './themes.ts';

const STYLESHEET = path.join(PACKAGED_THEME_DIR, 'static', 'style.css');

/** What the theme puts on what, and how much contrast it has to have. */
interface Pair {
  /** What a reader is looking at, for the assertion message. */
  readonly what: string;
  /** The custom property the foreground comes from, without the `--`. */
  readonly foreground: string;
  /** The custom property the background comes from. */
  readonly background: string;
  /**
   * 7 for every run of text, code included, and 3 for anything that is not
   * text at all: a border, a rule a reader relies on, a focus outline.
   */
  readonly minimum: 7 | 3;
}

/**
 * Every text and background pair the design puts on screen, in both schemes.
 *
 * Some rows name the same two tokens under different headings — the footer and
 * the small print are the body text colour on the body — and they are listed
 * separately on purpose: the row is where a later change that recolours one of
 * them says so.
 */
const PAIRS: readonly Pair[] = [
  { what: 'body text', foreground: 'color-text', background: 'color-body', minimum: 7 },
  { what: 'a heading', foreground: 'color-text', background: 'color-body', minimum: 7 },
  {
    what: 'a kicker, a date or a meta line',
    foreground: 'color-muted',
    background: 'color-body',
    minimum: 7,
  },
  { what: 'footer text', foreground: 'color-muted', background: 'color-body', minimum: 7 },
  {
    what: 'a deck, a quote or a bio note',
    foreground: 'color-muted',
    background: 'color-body',
    minimum: 7,
  },
  {
    what: 'muted text on a sunk surface',
    foreground: 'color-muted',
    background: 'color-base',
    minimum: 7,
  },
  {
    what: 'a link on the paper',
    foreground: 'color-primary',
    background: 'color-body',
    minimum: 7,
  },
  {
    what: 'the kind word in a kicker',
    foreground: 'color-primary',
    background: 'color-body',
    minimum: 7,
  },
  {
    what: 'a link on a sunk surface',
    foreground: 'color-primary',
    background: 'color-base',
    minimum: 7,
  },
  {
    what: 'the words on a submit button',
    foreground: 'color-body',
    background: 'color-primary',
    minimum: 7,
  },
  {
    what: 'the words on a submit button under the pointer',
    foreground: 'color-body',
    background: 'color-text',
    minimum: 7,
  },
  { what: 'a tag link', foreground: 'color-secondary', background: 'color-body', minimum: 7 },
  {
    what: 'the skip link when it is focused',
    foreground: 'color-text',
    background: 'color-base-3',
    minimum: 7,
  },
  {
    what: 'text in a field or a notice',
    foreground: 'color-text',
    background: 'color-base',
    minimum: 7,
  },
  {
    what: 'text on the cooler sunk surface',
    foreground: 'color-text',
    background: 'color-base-2',
    minimum: 7,
  },
  {
    what: 'code in a block',
    foreground: 'color-code-text',
    background: 'color-code-background',
    minimum: 7,
  },
  { what: 'an error message', foreground: 'color-error', background: 'color-body', minimum: 7 },
  // The highlighter's token colours (TASK-86): Tomorrow on light paper and
  // Tomorrow Night on dark, every one of them on the block background. A
  // syntax theme is drawn for a reader looking at code for an hour, and some of
  // its colours — the comment grey above all — are far too faint for that here;
  // where a stock colour missed, it was darkened or lifted until it made 7:1,
  // and this is where that is kept honest.
  ...(
    [
      ['a comment', 'color-code-comment'],
      ['a markup tag', 'color-code-tag'],
      ['a variable or a list bullet', 'color-code-name'],
      ['a number or a constant', 'color-code-literal'],
      ['a class name', 'color-code-class'],
      ['a string', 'color-code-string'],
      ['a built-in or a regexp', 'color-code-support'],
      ['a function name or a heading', 'color-code-function'],
      ['a keyword', 'color-code-keyword'],
      ['a preprocessor line', 'color-code-meta'],
    ] as const
  ).map(([what, foreground]) => ({
    what: `${what} in a code block`,
    foreground,
    background: 'color-code-background',
    minimum: 7 as const,
  })),
  // A diff's added and removed lines keep the block's own ink on a tinted
  // line, the way prism-diff.css did, so the tint is the pair to check.
  {
    what: 'an added line in a diff',
    foreground: 'color-code-text',
    background: 'color-code-added-background',
    minimum: 7,
  },
  {
    what: 'a removed line in a diff',
    foreground: 'color-code-text',
    background: 'color-code-removed-background',
    minimum: 7,
  },
  // Borders a reader relies on to find a control or a boundary.
  {
    what: 'the focus outline on the paper',
    foreground: 'color-secondary',
    background: 'color-body',
    minimum: 3,
  },
  {
    what: 'the focus outline on a field',
    foreground: 'color-secondary',
    background: 'color-base',
    minimum: 3,
  },
  {
    what: 'a field’s border on the field',
    foreground: 'color-edge',
    background: 'color-base',
    minimum: 3,
  },
  {
    what: 'a field’s border on the paper',
    foreground: 'color-edge',
    background: 'color-body',
    minimum: 3,
  },
  {
    what: 'a previous or next card’s border',
    foreground: 'color-edge',
    background: 'color-body',
    minimum: 3,
  },
  {
    what: 'a code block’s border',
    foreground: 'color-edge',
    background: 'color-code-background',
    minimum: 3,
  },
  {
    what: 'the citation rule',
    foreground: 'color-primary',
    background: 'color-body',
    minimum: 3,
  },
  {
    what: 'the blockquote rule',
    foreground: 'color-primary',
    background: 'color-body',
    minimum: 3,
  },
  {
    what: 'an invalid field’s border',
    foreground: 'color-error',
    background: 'color-base',
    minimum: 3,
  },
];

/**
 * The `:root` declarations of one scheme, as `name -> value` without the `--`.
 *
 * `light` is the `:root` block at the top of the file; `dark` is the one inside
 * the `prefers-color-scheme: dark` media query. Both are read out of the
 * stylesheet the package ships, so there is no second copy of the palette to
 * keep in step with it.
 */
function customProperties(css: string, scheme: 'light' | 'dark'): Map<string, string> {
  const block = scheme === 'light' ? lightRoot(css) : darkRoot(css);
  const properties = new Map<string, string>();

  for (const [, name = '', value = ''] of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    properties.set(name, value.trim());
  }

  return properties;
}

/**
 * The first `:root { ... }` block that declares `--color-body`. Tailwind puts
 * a `:root` of its own in the theme layer ahead of it, holding its spacing and
 * type scale, and that one names no colour.
 */
function lightRoot(css: string): string {
  for (let start = css.indexOf(':root'); start !== -1; start = css.indexOf(':root', start + 1)) {
    const block = braced(css, start);
    if (block.includes('--color-body:')) return block;
  }
  assert.fail('the stylesheet has no :root block declaring the colour tokens');
}

/** The `:root { ... }` inside `@media (prefers-color-scheme: dark)`. */
function darkRoot(css: string): string {
  const query = css.indexOf('prefers-color-scheme: dark');
  assert.notEqual(query, -1, 'the stylesheet has no dark scheme');
  const start = css.indexOf(':root', query);
  assert.notEqual(start, -1, 'the dark scheme redefines nothing on :root');
  return braced(css, start);
}

/** The `{ ... }` that follows `from`, balanced, so a nested block is included. */
function braced(css: string, from: number): string {
  const open = css.indexOf('{', from);
  let depth = 0;

  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }

  throw new Error('unbalanced braces in the stylesheet');
}

/** `#rgb`, `#rrggbb` and `rgb(r g b)` as the three channels, 0-255. */
function channels(color: string): [number, number, number] {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  if (hex) {
    const digits = hex[1] ?? '';
    const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
    return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16)) as [
      number,
      number,
      number,
    ];
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  assert.ok(rgb, `${color} is not a colour this test can read`);
  const parts = (rgb[1] ?? '')
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  assert.ok(parts.length >= 3, `${color} is not a colour this test can read`);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** WCAG 2.2 relative luminance. */
function luminance(color: string): number {
  const [r, g, b] = channels(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, 1 to 21. */
function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

describe('the default theme palette', () => {
  const css = readFileSync(STYLESHEET, 'utf8');
  const schemes = {
    light: customProperties(css, 'light'),
    dark: customProperties(css, 'dark'),
  } as const;

  it('declares the same colour tokens in both schemes', () => {
    const colors = (properties: Map<string, string>): string[] =>
      [...properties.keys()].filter((name) => name.startsWith('color-')).sort();

    assert.ok(colors(schemes.light).length > 0, 'the light scheme names no colours');
    assert.deepEqual(
      colors(schemes.dark),
      colors(schemes.light),
      'the dark scheme names a different set of colours from the light one',
    );
  });

  it('says which schemes a browser may paint form controls in', () => {
    assert.match(
      lightRoot(css),
      /color-scheme:\s*light dark/,
      'the :root block does not say `color-scheme: light dark`',
    );
  });

  for (const scheme of ['light', 'dark'] as const) {
    describe(`the ${scheme} scheme`, () => {
      for (const pair of PAIRS) {
        it(`${pair.what} meets ${String(pair.minimum)}:1`, () => {
          const properties = schemes[scheme];
          const foreground = properties.get(pair.foreground);
          const background = properties.get(pair.background);

          assert.ok(foreground, `--${pair.foreground} is not declared in the ${scheme} scheme`);
          assert.ok(background, `--${pair.background} is not declared in the ${scheme} scheme`);

          const ratio = contrast(foreground, background);
          assert.ok(
            ratio >= pair.minimum,
            `${pair.what}: --${pair.foreground} on --${pair.background} is ${ratio.toFixed(2)}:1, below ${String(pair.minimum)}:1`,
          );
        });
      }
    });
  }
});
