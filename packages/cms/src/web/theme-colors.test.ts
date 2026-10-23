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

import { PACKAGED_THEME_DIR, readTheme } from '../theme/themes.ts';

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

/** What the stylesheet sets on `<html>` that this test reads. */
const READ = (property: string): boolean =>
  property.startsWith('--color-') || property === 'color-scheme';

/** One style rule of the compiled stylesheet, with what it sits inside. */
interface Rule {
  readonly selectors: readonly string[];
  /** The conditions of every `@media` around it, innermost last. */
  readonly media: readonly string[];
  /** Inside an `@layer`, which an unlayered rule beats whatever its specificity. */
  readonly layered: boolean;
  readonly declarations: ReadonlyMap<string, string>;
}

/**
 * The style rules that set a colour token or `color-scheme`, in source order.
 *
 * `@layer`, `@supports` and `@media` are looked through, recording the media
 * conditions and whether a layer was crossed; any other at-rule (`@property`,
 * `@keyframes`) holds nothing this test reads.
 */
function rulesOf(css: string): Rule[] {
  const rules: Rule[] = [];
  const source = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');

  function walk(from: number, to: number, media: readonly string[], layered: boolean): void {
    let at = from;
    while (at < to) {
      const open = source.indexOf('{', at);
      const semicolon = source.indexOf(';', at);
      if (open === -1 || open >= to) return;
      if (semicolon !== -1 && semicolon < open) {
        at = semicolon + 1;
        continue;
      }

      const prelude = source.slice(at, open).trim();
      const close = closingBrace(source, open);

      if (prelude.startsWith('@media')) {
        walk(open + 1, close, [...media, prelude.slice('@media'.length).trim()], layered);
      } else if (prelude.startsWith('@layer')) {
        walk(open + 1, close, media, true);
      } else if (prelude.startsWith('@supports')) {
        walk(open + 1, close, media, layered);
      } else if (!prelude.startsWith('@')) {
        const body = source.slice(open + 1, close);
        const declarations = new Map<string, string>();
        for (const [, name = '', value = ''] of body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) {
          if (READ(name)) declarations.set(name, value.trim());
        }
        if (declarations.size > 0) {
          assert.ok(!body.includes('{'), `a nested rule under ${prelude} was not flattened`);
          rules.push({ selectors: splitTopLevel(prelude), media, layered, declarations });
        }
      }

      at = close + 1;
    }
  }

  walk(0, source.length, [], false);
  return rules;
}

function closingBrace(css: string, open: number): number {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('unbalanced braces in the stylesheet');
}

/** A selector list split on the commas that are not inside parentheses. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === '(') depth += 1;
    if (list[index] === ')') depth -= 1;
    if (list[index] === ',' && depth === 0) {
      parts.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

/** The `<html>` element as the stylesheet sees it, and the reader's system setting. */
interface Page {
  readonly scheme?: string | undefined;
  readonly mode?: 'light' | 'dark' | undefined;
  readonly system: 'light' | 'dark';
}

/**
 * Whether one compound selector matches `<html>` on this page, and its
 * specificity as a count of class-level parts, the only kind these use.
 * `undefined` for a selector that cannot match `<html>` at all, such as
 * `:host`. Anything this test does not know how to read fails it, so a
 * selector it would misjudge cannot slip through.
 */
function match(
  selector: string,
  page: Page,
): { matches: boolean; specificity: number } | undefined {
  const attributes: Record<string, string | undefined> = {
    'data-scheme': page.scheme,
    'data-mode': page.mode,
  };
  let rest = selector.trim();
  let matches = true;
  let specificity = 0;

  while (rest !== '') {
    if (rest.startsWith(':root')) {
      specificity += 1;
      rest = rest.slice(':root'.length);
      continue;
    }
    if (rest.startsWith(':host')) return undefined;

    const attribute = /^\[([\w-]+)(?:=(["']?)([^"'\]]*)\2)?\]/.exec(rest);
    if (attribute) {
      const [whole, name = '', , value] = attribute;
      const actual = attributes[name];
      matches &&= value === undefined ? actual !== undefined : actual === value;
      specificity += 1;
      rest = rest.slice(whole.length);
      continue;
    }

    const pseudo = /^:(not|is|where)\(/.exec(rest);
    assert.ok(pseudo, `the colour test cannot read the selector ${selector}`);
    const open = pseudo[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < rest.length; close += 1) {
      if (rest[close] === '(') depth += 1;
      if (rest[close] === ')') depth -= 1;
      if (depth === 0) break;
    }
    const inner = splitTopLevel(rest.slice(open + 1, close)).map((part) => match(part, page));
    const known = inner.filter((result) => result !== undefined);
    const any = known.some((result) => result.matches);
    const most = Math.max(0, ...known.map((result) => result.specificity));

    if (pseudo[1] === 'not') matches &&= !any;
    else matches &&= any;
    if (pseudo[1] !== 'where') specificity += most;
    rest = rest.slice(close + 1);
  }

  return { matches, specificity };
}

/** Whether a media condition holds for this reader; only the colour scheme is asked. */
function holds(condition: string, page: Page): boolean {
  const query = /^\(prefers-color-scheme:\s*(light|dark)\)$/.exec(condition);
  assert.ok(query, `colour tokens are set under @media ${condition}, which this test cannot read`);
  return query[1] === page.system;
}

/** What `<html>` ends up with on this page: the cascade over {@link rulesOf}. */
function computed(rules: readonly Rule[], page: Page): Map<string, string> {
  const applying: { rule: Rule; specificity: number; order: number }[] = [];

  rules.forEach((rule, order) => {
    if (!rule.media.every((condition) => holds(condition, page))) return;
    const results = rule.selectors.map((selector) => match(selector, page));
    const matching = results.filter((result) => result?.matches === true);
    if (matching.length === 0) return;
    const specificity = Math.max(...matching.map((result) => result?.specificity ?? 0));
    applying.push({ rule, specificity, order });
  });

  applying.sort(
    (a, b) =>
      Number(!a.rule.layered) - Number(!b.rule.layered) ||
      a.specificity - b.specificity ||
      a.order - b.order,
  );

  const properties = new Map<string, string>();
  for (const { rule } of applying) {
    for (const [name, value] of rule.declarations) properties.set(name, value);
  }
  return properties;
}

/** Only the colour tokens, without the `--`, which is how {@link PAIRS} names them. */
function colorTokens(properties: ReadonlyMap<string, string>): Map<string, string> {
  return new Map(
    [...properties]
      .filter(([name]) => name.startsWith('--color-'))
      .map(([name, value]) => [name.slice(2), value]),
  );
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

/** The same colour however it is written, so `#FFF` and `#ffffff` compare equal. */
function normal(color: string | undefined): string | undefined {
  return color === undefined ? undefined : channels(color).join(' ');
}

const MODES = ['light', 'dark'] as const;

describe('the default theme palette', () => {
  const rules = rulesOf(readFileSync(STYLESHEET, 'utf8'));
  const read = readTheme(PACKAGED_THEME_DIR);
  assert.ok(read.ok, read.ok ? '' : read.reason);
  const { schemes } = read.theme;
  const tokens = (page: Page): Map<string, string> => colorTokens(computed(rules, page));

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
    const scheme = (page: Page): string | undefined => computed(rules, page).get('color-scheme');

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
              rule.media.every((condition) => holds(condition, { system })) &&
              rule.selectors.some(
                (selector) =>
                  selector.includes(`[data-scheme="${name}"]`) &&
                  match(selector, { scheme: name, system })?.matches === true,
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
            normal(drawn[mode].get('color-body')),
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

              assert.ok(foreground, `--${pair.foreground} is not declared for ${name} ${mode}`);
              assert.ok(background, `--${pair.background} is not declared for ${name} ${mode}`);

              const ratio = contrast(foreground, background);
              assert.ok(
                ratio >= pair.minimum,
                `${name} ${mode}, ${pair.what}: --${pair.foreground} on --${pair.background} is ${ratio.toFixed(2)}:1, below ${String(pair.minimum)}:1`,
              );
            });
          }
        });
      }
    });
  }
});
