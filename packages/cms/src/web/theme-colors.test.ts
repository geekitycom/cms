/**
 * The default theme's colours, checked against WCAG 2.2 AA.
 *
 * The source design (decision-16) is light only and was drawn by eye; the dark
 * scheme was drawn to match it and neither is anything a reader can override.
 * So the ratios are arithmetic here rather than a promise in a README: the test
 * reads the custom properties out of `static/style.css` — the `:root` block for
 * the light scheme and the one inside `@media (prefers-color-scheme: dark)` for
 * the dark — and computes the contrast of every pair the design puts on screen.
 * A colour changed in the stylesheet that breaks one of them fails here rather
 * than in front of somebody trying to read a post.
 *
 * {@link PAIRS} is the table to extend: TASK-86 adds the code token colours and
 * checks them against `--color-code-background`, which is why that token is
 * named rather than folded into `--color-base`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { PACKAGED_THEME_DIR } from './themes.ts';

const STYLESHEET = path.join(PACKAGED_THEME_DIR, 'static', 'style.css');

/** What the theme puts on what, and how much contrast WCAG 2.2 AA asks for. */
interface Pair {
  /** What a reader is looking at, for the assertion message. */
  readonly what: string;
  /** The custom property the foreground comes from, without the `--`. */
  readonly foreground: string;
  /** The custom property the background comes from. */
  readonly background: string;
  /**
   * 4.5 for body text, 3 for large text and for anything that is not text at
   * all — a rule, a border, a focus outline.
   */
  readonly minimum: 4.5 | 3;
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
  { what: 'body text', foreground: 'color-text', background: 'color-body', minimum: 4.5 },
  { what: 'footer text', foreground: 'color-text', background: 'color-body', minimum: 4.5 },
  { what: 'the small print', foreground: 'color-text', background: 'color-body', minimum: 4.5 },
  {
    what: 'a link on the paper',
    foreground: 'color-primary',
    background: 'color-body',
    minimum: 4.5,
  },
  {
    what: 'a link inverted on hover',
    foreground: 'color-body',
    background: 'color-primary',
    minimum: 4.5,
  },
  {
    what: 'blockquote text',
    foreground: 'color-secondary',
    background: 'color-body',
    minimum: 4.5,
  },
  {
    what: 'the skip link when it is focused',
    foreground: 'color-text',
    background: 'color-base-3',
    minimum: 4.5,
  },
  {
    what: 'text on a sunk surface',
    foreground: 'color-text',
    background: 'color-base',
    minimum: 4.5,
  },
  {
    what: 'text on the cooler sunk surface',
    foreground: 'color-text',
    background: 'color-base-2',
    minimum: 4.5,
  },
  {
    what: 'code in a block',
    foreground: 'color-code-text',
    background: 'color-code-background',
    minimum: 4.5,
  },
  { what: 'an error message', foreground: 'color-error', background: 'color-body', minimum: 4.5 },
  { what: 'a heading', foreground: 'color-text', background: 'color-body', minimum: 3 },
  { what: 'the primary rule', foreground: 'color-primary', background: 'color-body', minimum: 3 },
  { what: 'the focus outline', foreground: 'color-primary', background: 'color-body', minimum: 3 },
  {
    what: 'the blockquote border',
    foreground: 'color-secondary',
    background: 'color-body',
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

/** The first top-level `:root { ... }` block. */
function lightRoot(css: string): string {
  const start = css.indexOf(':root');
  assert.notEqual(start, -1, 'the stylesheet has no :root block');
  return braced(css, start);
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
