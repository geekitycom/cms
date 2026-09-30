/**
 * What the default theme's stylesheet promises readers the page itself cannot
 * show (TASK-145): that it survives a forced palette, that every control a
 * finger has to hit is at least 24 by 24, that headings and prose wrap well,
 * that it mirrors under `dir="rtl"`, and that the page does not shift sideways
 * when a scrollbar comes and goes.
 *
 * Read out of the compiled file rather than a browser, because the package has
 * none to test with. The file is Tailwind's output (TASK-187), so what is
 * checked is what a reader is served, preflight included. Each assertion names the rule a reader depends on, so a change
 * that drops one fails here rather than on a Windows High Contrast screen or an
 * Arabic site.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

interface Rule {
  media: string | undefined;
  selectors: string[];
  declarations: Map<string, string>;
}

/**
 * Every rule in a stylesheet, comments removed, each with the `@media` it sits
 * in. `@layer` and `@supports` blocks, which Tailwind wraps its output in, are
 * looked through: a rule inside one applies wherever the layer does, and a
 * `@layer` statement with no block is skipped.
 */
function parse(css: string): Rule[] {
  const rules: Rule[] = [];
  const source = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const walk = (text: string, media: string | undefined) => {
    let at = 0;
    while (at < text.length) {
      const open = text.indexOf('{', at);
      if (open === -1) return;
      const prelude = (text.slice(at, open).split(';').at(-1) ?? '').trim();
      let depth = 1;
      let close = open + 1;
      for (; depth > 0; close++) {
        if (text[close] === '{') depth++;
        if (text[close] === '}') depth--;
      }
      const body = text.slice(open + 1, close - 1);
      if (prelude.startsWith('@media')) {
        walk(body, prelude.slice('@media'.length).trim());
      } else if (prelude.startsWith('@layer') || prelude.startsWith('@supports')) {
        walk(body, media);
      } else {
        const declarations = new Map<string, string>();
        for (const declaration of body.split(';')) {
          const colon = declaration.indexOf(':');
          if (colon === -1) continue;
          declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
        }
        const selectors = prelude
          .split(',')
          .map((selector) => selector.replaceAll(/\s+/g, ' ').trim());
        rules.push({ media, selectors, declarations });
      }
      at = close;
    }
  };
  walk(source, undefined);
  return rules;
}

let rules: Rule[];

before(async () => {
  rules = parse(
    await readFile(
      fileURLToPath(new URL('../../themes/default/static/style.css', import.meta.url)),
      'utf8',
    ),
  );
});

/** What a selector is given outside any media query, merged in source order. */
function declared(selector: string, media?: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const rule of rules) {
    if (rule.media !== media || !rule.selectors.includes(selector)) continue;
    for (const [property, value] of rule.declarations) merged.set(property, value);
  }
  return merged;
}

describe('the default theme stylesheet', () => {
  it('parses into rules, so the checks below are reading something', () => {
    assert.ok(rules.length > 100, `only ${rules.length} rules`);
    assert.equal(declared('.screen-reader-text').get('position'), 'absolute');
  });

  it('draws nothing on a physical side of the inline axis, so dir=rtl mirrors it', () => {
    const physical =
      /^(?:(?:margin|padding|scroll-margin|scroll-padding)-(?:left|right)|border-(?:left|right)(?:-.+)?|border-(?:top|bottom)-(?:left|right)-radius|left|right)$/;
    const shorthand = /^(?:margin|padding|border-width|border-style|border-color|inset)$/;
    const offenders: string[] = [];
    for (const rule of rules) {
      for (const [property, value] of rule.declarations) {
        const where = `${rule.selectors.join(', ')} { ${property}: ${value} }`;
        if (physical.test(property)) offenders.push(where);
        if (/^(?:float|clear|text-align)$/.test(property) && /^(?:left|right)$/.test(value)) {
          offenders.push(where);
        }
        const sides = value.split(/\s+(?![^(]*\))/);
        if (shorthand.test(property) && sides.length === 4 && sides[1] !== sides[3]) {
          offenders.push(where);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('keeps a scrollbar’s room whether or not the page scrolls', () => {
    assert.equal(declared('html').get('scrollbar-gutter'), 'stable');
  });

  it('balances every heading and wraps body copy prettily', () => {
    for (const heading of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      assert.equal(declared(heading).get('text-wrap'), 'balance', heading);
    }
    for (const prose of ['p', 'li']) {
      assert.equal(declared(prose).get('text-wrap'), 'pretty', prose);
    }
  });

  it('makes every control that stands alone at least 24 by 24', () => {
    const controls = [
      '.site-nav a',
      '.post-categories a',
      '.blog-post-nav a',
      '.pagination a',
      '.comment-metadata a',
      '.reply a',
      '.comment-error a',
      '.contact-error a',
      '.search-form button',
      '.comment-respond .form-submit button',
      '.comment-respond .form-submit input[type="submit"]',
    ];
    for (const control of controls) {
      const own = declared(control);
      assert.equal(own.get('min-block-size'), '24px', `${control} min-block-size`);
      assert.equal(own.get('min-inline-size'), '24px', `${control} min-inline-size`);
    }
    const checkbox = declared('.comment-respond input[type="checkbox"]');
    assert.equal(checkbox.get('inline-size'), '24px');
    assert.equal(checkbox.get('block-size'), '24px');
  });

  it('under forced colours, borders what was drawn by a background alone', () => {
    const forced = '(forced-colors: active)';
    assert.ok(
      rules.some((rule) => rule.media === forced),
      'there is a forced-colors block',
    );
    // A system colour is a keyword, and the compiler prints it lower case.
    const border = (selector: string, property: string) =>
      declared(selector, forced).get(property)?.toLowerCase();
    for (const control of [
      '.search-form button',
      '.comment-respond .form-submit button',
      '.comment-respond .form-submit input[type="submit"]',
    ]) {
      assert.equal(border(control, 'border'), '1px solid buttontext', control);
    }
    assert.equal(border('hr', 'border-block-start'), '1px solid canvastext');
    assert.equal(border('pre', 'border'), '1px solid canvastext');
  });

  it('never takes a focus ring away, which a forced palette would otherwise redraw', () => {
    const removed = rules.filter(
      (rule) =>
        rule.selectors.some((selector) => selector.includes(':focus')) &&
        [rule.declarations.get('outline'), rule.declarations.get('outline-style')].some(
          (value) => value !== undefined && /^(?:none|0)\b/.test(value),
        ),
    );
    assert.deepEqual(
      removed.map((rule) => rule.selectors.join(', ')),
      [],
    );
  });
});
