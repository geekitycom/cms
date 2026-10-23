import { readFileSync, statSync } from 'node:fs';

/**
 * The `--color-*` tokens a theme's compiled stylesheet gives `<html>` in one
 * colour scheme and mode (decision-61), worked out the way a browser would:
 * from the selectors, their specificity, their order, the `@layer` they sit
 * in and the `prefers-color-scheme` query around them.
 *
 * The contrast test holds every pair of these to its minimum. The embed view
 * draws its card in them, and the Appearance screen shows them as swatches.
 * Only what a scheme block uses is read: `:root`, attribute selectors on
 * `data-scheme` and `data-mode`, `:not()`, `:is()` and `:where()`, and
 * `@media (prefers-color-scheme: …)`. Anything else cannot match `<html>` here
 * and is listed by {@link stylesheetProblems}.
 */

/** What the stylesheet sets on `<html>` that is read here. */
const READ = (property: string): boolean =>
  property.startsWith('--color-') || property === 'color-scheme';

/** One style rule of a stylesheet, with what it sits inside. */
export interface StyleRule {
  readonly selectors: readonly string[];
  /** The conditions of every `@media` around it, innermost last. */
  readonly media: readonly string[];
  /** Inside an `@layer`, which an unlayered rule beats whatever its specificity. */
  readonly layered: boolean;
  readonly declarations: ReadonlyMap<string, string>;
  /** Whether it held a rule of its own, which this reader does not flatten. */
  readonly nested: boolean;
}

/** `<html>` as the stylesheet sees it, and the reader's system setting. */
export interface TokenPage {
  readonly scheme?: string | undefined;
  readonly mode?: 'light' | 'dark' | undefined;
  readonly system: 'light' | 'dark';
}

/**
 * The style rules that set a colour token or `color-scheme`, in source order.
 *
 * `@layer`, `@supports` and `@media` are looked through, recording the media
 * conditions and whether a layer was crossed; any other at-rule (`@property`,
 * `@keyframes`) holds nothing read here.
 */
export function stylesheetRules(css: string): StyleRule[] {
  const rules: StyleRule[] = [];
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
      if (close === -1) return;

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
          rules.push({
            selectors: splitTopLevel(prelude),
            media,
            layered,
            declarations,
            nested: body.includes('{'),
          });
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
  return -1;
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

/** A selector's match against `<html>`, or why it could not be read. */
type SelectorMatch =
  { readonly matches: boolean; readonly specificity: number } | { readonly unreadable: string };

/**
 * Whether one compound selector matches `<html>` on this page, and its
 * specificity as a count of class-level parts, the only kind these use.
 * `:host` never matches.
 */
function matchSelector(selector: string, page: TokenPage): SelectorMatch {
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
    if (rest.startsWith(':host')) return { matches: false, specificity: 0 };

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
    if (!pseudo) return { unreadable: selector };
    const open = pseudo[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < rest.length; close += 1) {
      if (rest[close] === '(') depth += 1;
      if (rest[close] === ')') depth -= 1;
      if (depth === 0) break;
    }
    const inner = splitTopLevel(rest.slice(open + 1, close)).map((part) =>
      matchSelector(part, page),
    );
    const unreadable = inner.find((result) => 'unreadable' in result);
    if (unreadable !== undefined) return unreadable;
    const known = inner as { matches: boolean; specificity: number }[];
    const any = known.some((result) => result.matches);
    const most = Math.max(0, ...known.map((result) => result.specificity));

    if (pseudo[1] === 'not') matches &&= !any;
    else matches &&= any;
    if (pseudo[1] !== 'where') specificity += most;
    rest = rest.slice(close + 1);
  }

  return { matches, specificity };
}

/** Whether one selector matches `<html>` on this page. */
export function selectorMatches(selector: string, page: TokenPage): boolean {
  const result = matchSelector(selector, page);
  return 'matches' in result && result.matches;
}

const COLOR_SCHEME_QUERY = /^\(prefers-color-scheme:\s*(light|dark)\)$/;

/** Whether a media condition holds for this reader; only the colour scheme is asked. */
export function mediaHolds(condition: string, page: TokenPage): boolean {
  return COLOR_SCHEME_QUERY.exec(condition)?.[1] === page.system;
}

/**
 * What this reader cannot read in the rules it found: a selector or a media
 * condition it would misjudge, or a rule with another nested inside. A rule
 * like that is passed over, so a stylesheet with any of these may be drawn
 * differently from what {@link computedTokens} says.
 */
export function stylesheetProblems(rules: readonly StyleRule[]): string[] {
  const problems = new Set<string>();
  const page: TokenPage = { system: 'light' };
  for (const rule of rules) {
    if (rule.nested) problems.add(`a nested rule under ${rule.selectors.join(', ')}`);
    for (const condition of rule.media) {
      if (!COLOR_SCHEME_QUERY.test(condition)) problems.add(`@media ${condition}`);
    }
    for (const selector of rule.selectors) {
      const result = matchSelector(selector, page);
      if ('unreadable' in result) problems.add(`the selector ${result.unreadable}`);
    }
  }
  return [...problems];
}

/** What `<html>` ends up with on this page: the cascade over {@link stylesheetRules}. */
export function computedTokens(rules: readonly StyleRule[], page: TokenPage): Map<string, string> {
  const applying: { rule: StyleRule; specificity: number; order: number }[] = [];

  rules.forEach((rule, order) => {
    if (rule.nested) return;
    if (!rule.media.every((condition) => mediaHolds(condition, page))) return;
    const matching = rule.selectors
      .map((selector) => matchSelector(selector, page))
      .filter((result) => 'matches' in result && result.matches) as { specificity: number }[];
    if (matching.length === 0) return;
    const specificity = Math.max(...matching.map((result) => result.specificity));
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

/**
 * Only the colour tokens, keyed without the `--color-` prefix: `body`,
 * `text`, `primary` and the rest.
 */
export function colorTokens(properties: ReadonlyMap<string, string>): Map<string, string> {
  return new Map(
    [...properties]
      .filter(([name]) => name.startsWith('--color-'))
      .map(([name, value]) => [name.slice('--color-'.length), value]),
  );
}

/** One scheme's colour tokens in each mode, keyed as {@link colorTokens} keys them. */
export interface SchemeTokens {
  readonly light: ReadonlyMap<string, string>;
  readonly dark: ReadonlyMap<string, string>;
}

const parsed = new Map<string, { key: string; rules: readonly StyleRule[] }>();

/**
 * The colour tokens of `scheme` in the stylesheet at `file`, light and dark.
 * The file is parsed once and again only when it changes. A file that cannot
 * be read has no tokens.
 */
export function schemeTokens(file: string, scheme: string): SchemeTokens {
  const rules = rulesOfFile(file);
  const drawn = (system: 'light' | 'dark'): Map<string, string> =>
    colorTokens(computedTokens(rules, { scheme, system }));
  return { light: drawn('light'), dark: drawn('dark') };
}

function rulesOfFile(file: string): readonly StyleRule[] {
  let key: string;
  try {
    const stats = statSync(file);
    key = `${String(stats.mtimeMs)}:${String(stats.size)}:${String(stats.ino)}`;
  } catch {
    return [];
  }
  const cached = parsed.get(file);
  if (cached?.key === key) return cached.rules;
  const rules = stylesheetRules(readFileSync(file, 'utf8'));
  parsed.set(file, { key, rules });
  return rules;
}
