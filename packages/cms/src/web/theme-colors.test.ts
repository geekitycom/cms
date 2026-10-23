/**
 * The default theme's colours, checked against WCAG 2.2, in every colour
 * scheme it declares and in both modes.
 *
 * The ratios are arithmetic here rather than a promise in a README: the test
 * reads the compiled `static/style.css`, works out which `--color-*` values
 * `<html>` ends up with for each scheme the theme's `theme.json` declares — the
 * way a browser would, from the selectors, their specificity, their order and
 * the `prefers-color-scheme` query around them — and computes the contrast of
 * every pair the design puts on screen. A colour changed in the theme's source
 * that breaks one of them fails here rather than in front of somebody trying
 * to read a post, and so does a scheme declared in `theme.json` that the
 * stylesheet draws no tokens for (decision-61).
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

import {
  colorTokens,
  computedTokens,
  mediaHolds,
  selectorMatches,
  stylesheetProblems,
  stylesheetRules,
} from '../theme/scheme-tokens.ts';
import type { TokenPage } from '../theme/scheme-tokens.ts';
import { PACKAGED_THEME_DIR, readTheme } from '../theme/themes.ts';

const STYLESHEET = path.join(PACKAGED_THEME_DIR, 'static', 'style.css');

/** What the theme puts on what, and how much contrast it has to have. */
interface Pair {
  /** What a reader is looking at, for the assertion message. */
  readonly what: string;
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
  { what: 'body text', foreground: 'text', background: 'body', minimum: 7 },
  { what: 'a heading', foreground: 'text', background: 'body', minimum: 7 },
  {
    what: 'a kicker, a date or a meta line',
    foreground: 'muted',
    background: 'body',
    minimum: 7,
  },
  { what: 'footer text', foreground: 'muted', background: 'body', minimum: 7 },
  {
    what: 'a deck, a quote or a bio note',
    foreground: 'muted',
    background: 'body',
    minimum: 7,
  },
  {
    what: 'muted text on a sunk surface',
    foreground: 'muted',
    background: 'base',
    minimum: 7,
  },
  {
    what: 'a link on the paper',
    foreground: 'primary',
    background: 'body',
    minimum: 7,
  },
  {
    what: 'the kind word in a kicker',
    foreground: 'primary',
    background: 'body',
    minimum: 7,
  },
  {
    what: 'a link on a sunk surface',
    foreground: 'primary',
    background: 'base',
    minimum: 7,
  },
  {
    what: 'the words on a submit button',
    foreground: 'body',
    background: 'primary',
    minimum: 7,
  },
  {
    what: 'the words on a submit button under the pointer',
    foreground: 'body',
    background: 'text',
    minimum: 7,
  },
  { what: 'a tag link', foreground: 'secondary', background: 'body', minimum: 7 },
  {
    what: 'the skip link when it is focused',
    foreground: 'text',
    background: 'base-3',
    minimum: 7,
  },
  {
    what: 'text in a field or a notice',
    foreground: 'text',
    background: 'base',
    minimum: 7,
  },
  {
    what: 'text on the cooler sunk surface',
    foreground: 'text',
    background: 'base-2',
    minimum: 7,
  },
  {
    what: 'code in a block',
    foreground: 'code-text',
    background: 'code-background',
    minimum: 7,
  },
  { what: 'an error message', foreground: 'error', background: 'body', minimum: 7 },
  // The highlighter's token colours (TASK-86): Tomorrow on light paper and
  // Tomorrow Night on dark, every one of them on the block background. A
  // syntax theme is drawn for a reader looking at code for an hour, and some of
  // its colours — the comment grey above all — are far too faint for that here;
  // where a stock colour missed, it was darkened or lifted until it made 7:1,
  // and this is where that is kept honest.
  ...(
    [
      ['a comment', 'code-comment'],
      ['a markup tag', 'code-tag'],
      ['a variable or a list bullet', 'code-name'],
      ['a number or a constant', 'code-literal'],
      ['a class name', 'code-class'],
      ['a string', 'code-string'],
      ['a built-in or a regexp', 'code-support'],
      ['a function name or a heading', 'code-function'],
      ['a keyword', 'code-keyword'],
      ['a preprocessor line', 'code-meta'],
    ] as const
  ).map(([what, foreground]) => ({
    what: `${what} in a code block`,
    foreground,
    background: 'code-background',
    minimum: 7 as const,
  })),
  // A diff's added and removed lines keep the block's own ink on a tinted
  // line, the way prism-diff.css did, so the tint is the pair to check.
  {
    what: 'an added line in a diff',
    foreground: 'code-text',
    background: 'code-added-background',
    minimum: 7,
  },
  {
    what: 'a removed line in a diff',
    foreground: 'code-text',
    background: 'code-removed-background',
    minimum: 7,
  },
  // Borders a reader relies on to find a control or a boundary.
  {
    what: 'the focus outline on the paper',
    foreground: 'secondary',
    background: 'body',
    minimum: 3,
  },
  {
    what: 'the focus outline on a field',
    foreground: 'secondary',
    background: 'base',
    minimum: 3,
  },
  {
    what: 'a field’s border on the field',
    foreground: 'edge',
    background: 'base',
    minimum: 3,
  },
  {
    what: 'a field’s border on the paper',
    foreground: 'edge',
    background: 'body',
    minimum: 3,
  },
  {
    what: 'a previous or next card’s border',
    foreground: 'edge',
    background: 'body',
    minimum: 3,
  },
  {
    what: 'a code block’s border',
    foreground: 'edge',
    background: 'code-background',
    minimum: 3,
  },
  {
    what: 'the citation rule',
    foreground: 'primary',
    background: 'body',
    minimum: 3,
  },
  {
    what: 'the blockquote rule',
    foreground: 'primary',
    background: 'body',
    minimum: 3,
  },
  {
    what: 'an invalid field’s border',
    foreground: 'error',
    background: 'base',
    minimum: 3,
  },
];

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

function normal(color: string | undefined): string | undefined {
  return color === undefined ? undefined : channels(color).join(' ');
}

const MODES = ['light', 'dark'] as const;

describe('the default theme palette', () => {
  const rules = stylesheetRules(readFileSync(STYLESHEET, 'utf8'));
  const read = readTheme(PACKAGED_THEME_DIR);
  assert.ok(read.ok, read.ok ? '' : read.reason);
  const { schemes } = read.theme;
  const tokens = (page: TokenPage): Map<string, string> => colorTokens(computedTokens(rules, page));

  it('sets its colours only where this test can read them', () => {
    assert.deepEqual(stylesheetProblems(rules), []);
  });

  it('declares at least one scheme, Paper first', () => {
    assert.equal(schemes[0]?.name, 'paper');
  });

  it('draws a page with no data-scheme in its first scheme, in both modes', () => {
    for (const system of MODES) {
      const plain = tokens({ system });
      assert.ok(plain.size > 0, `a plain page has no colour tokens in ${system} mode`);
      assert.deepEqual(plain, tokens({ scheme: schemes[0]?.name, system }));
    }
  });

  it('says which modes a browser may paint form controls in, following data-mode', () => {
    const scheme = (page: TokenPage): string | undefined =>
      computedTokens(rules, page).get('color-scheme');

    assert.equal(scheme({ system: 'light' }), 'light dark');
    assert.equal(scheme({ system: 'dark', mode: 'light' }), 'light');
    assert.equal(scheme({ system: 'light', mode: 'dark' }), 'dark');
  });

  for (const { name, themeColor } of schemes) {
    describe(`the ${name} scheme`, () => {
      const drawn = {
        light: tokens({ scheme: name, system: 'light' }),
        dark: tokens({ scheme: name, system: 'dark' }),
      } as const;

      it('has its own tokens in the stylesheet, light and dark', () => {
        const own = (system: 'light' | 'dark'): boolean =>
          rules.some(
            (rule) =>
              rule.declarations.has('--color-body') &&
              rule.media.every((condition) => mediaHolds(condition, { system })) &&
              rule.selectors.some(
                (selector) =>
                  selector.includes(`[data-scheme="${name}"]`) &&
                  selectorMatches(selector, { scheme: name, system }),
              ),
          );

        assert.ok(own('light'), `the stylesheet has no :root[data-scheme="${name}"] tokens`);
        assert.ok(own('dark'), `the stylesheet has no dark tokens for the ${name} scheme`);
      });

      it('declares the same colour tokens in both modes', () => {
        const names = (properties: Map<string, string>): string[] => [...properties.keys()].sort();
        assert.deepEqual(names(drawn.dark), names(drawn.light));
      });

      it('follows data-mode over the system setting', () => {
        assert.deepEqual(tokens({ scheme: name, mode: 'light', system: 'dark' }), drawn.light);
        assert.deepEqual(tokens({ scheme: name, mode: 'dark', system: 'light' }), drawn.dark);
        assert.notDeepEqual(drawn.dark, drawn.light);
      });

      it('tints the browser chrome with its own paper', () => {
        for (const mode of MODES) {
          assert.equal(
            normal(themeColor[mode]),
            normal(drawn[mode].get('body')),
            `theme.json gives ${name} a ${mode} themeColor other than its --color-body`,
          );
        }
      });

      for (const mode of MODES) {
        describe(`in ${mode} mode`, () => {
          for (const pair of PAIRS) {
            it(`${pair.what} meets ${String(pair.minimum)}:1`, () => {
              const foreground = drawn[mode].get(pair.foreground);
              const background = drawn[mode].get(pair.background);

              assert.ok(
                foreground,
                `--color-${pair.foreground} is not declared for ${name} ${mode}`,
              );
              assert.ok(
                background,
                `--color-${pair.background} is not declared for ${name} ${mode}`,
              );

              const ratio = contrast(foreground, background);
              assert.ok(
                ratio >= pair.minimum,
                `${name} ${mode}, ${pair.what}: --color-${pair.foreground} on --color-${pair.background} is ${ratio.toFixed(2)}:1, below ${String(pair.minimum)}:1`,
              );
            });
          }
        });
      }
    });
  }
});
