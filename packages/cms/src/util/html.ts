import { LEGACY_REFERENCES, NAMED_REFERENCES } from './html-entities.ts';

export function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const LONGEST_LEGACY_NAME = Math.max(...[...LEGACY_REFERENCES].map((name) => name.length));

/** Text with its character references resolved, as HTML reads them in text. */
export function decodeEntities(value: string): string {
  return decode(value, false);
}

/**
 * An attribute value with its character references resolved. HTML keeps a
 * legacy name without its semicolon as written when `=` or a letter or digit
 * follows it, so `?a=1&copy=2` is still a query string.
 */
export function decodeAttribute(value: string): string {
  return decode(value, true);
}

function decode(value: string, inAttribute: boolean): string {
  if (!value.includes('&')) return value;

  return value.replace(
    /&(?:#([0-9]+);?|#[xX]([0-9a-fA-F]+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g,
    (
      whole: string,
      decimal: string | undefined,
      hex: string | undefined,
      name: string | undefined,
      semicolon: string,
      offset: number,
    ) => {
      if (hex !== undefined) return codePoint(Number.parseInt(hex, 16));
      if (decimal !== undefined) return codePoint(Number.parseInt(decimal, 10));
      if (name === undefined) return whole;
      if (semicolon === ';') {
        const characters = NAMED_REFERENCES.get(name);
        if (characters !== undefined) return characters;
      }
      for (let length = Math.min(name.length, LONGEST_LEGACY_NAME); length > 0; length -= 1) {
        const legacy = name.slice(0, length);
        if (!LEGACY_REFERENCES.has(legacy)) continue;
        const after = length < name.length ? name[length] : value[offset + whole.length];
        if (inAttribute && after !== undefined && /[=A-Za-z0-9]/.test(after)) return whole;
        return `${NAMED_REFERENCES.get(legacy) ?? ''}${whole.slice(length + 1)}`;
      }
      return whole;
    },
  );
}

const WINDOWS_1252: ReadonlyMap<number, number> = new Map([
  [0x80, 0x20ac],
  [0x82, 0x201a],
  [0x83, 0x0192],
  [0x84, 0x201e],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x02c6],
  [0x89, 0x2030],
  [0x8a, 0x0160],
  [0x8b, 0x2039],
  [0x8c, 0x0152],
  [0x8e, 0x017d],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201c],
  [0x94, 0x201d],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x02dc],
  [0x99, 0x2122],
  [0x9a, 0x0161],
  [0x9b, 0x203a],
  [0x9c, 0x0153],
  [0x9e, 0x017e],
  [0x9f, 0x0178],
]);

/** A numeric reference read as the HTML tokenizer reads it. */
function codePoint(value: number): string {
  if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(WINDOWS_1252.get(value) ?? value);
}
