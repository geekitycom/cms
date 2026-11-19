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
    /&(?:#([0-9]+);|#[xX]([0-9a-fA-F]+);|([A-Za-z][A-Za-z0-9]*)(;?))/g,
    (
      whole: string,
      decimal: string | undefined,
      hex: string | undefined,
      name: string | undefined,
      semicolon: string,
      offset: number,
    ) => {
      if (hex !== undefined) return codePoint(Number.parseInt(hex, 16)) ?? whole;
      if (decimal !== undefined) return codePoint(Number.parseInt(decimal, 10)) ?? whole;
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

function codePoint(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return undefined;
  if (value >= 0xd800 && value <= 0xdfff) return undefined;
  return String.fromCodePoint(value);
}
