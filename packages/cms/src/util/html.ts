/** Text as markup for a text node: only the characters that could open a tag or a reference. */
export function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** A value as markup for an attribute, double- or single-quoted. */
export function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** The named references resolved; the rest of HTML's list is left as written. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

/**
 * Character references resolved, in one pass so `&amp;lt;` is `&lt;`. A name
 * this module does not know, or a number that names no character, is left as
 * the characters it is made of, for an escaper to make safe.
 */
export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;

  return value.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g,
    (whole, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        return codePoint(Number.parseInt(body.slice(2), 16)) ?? whole;
      }
      if (body.startsWith('#')) return codePoint(Number.parseInt(body.slice(1), 10)) ?? whole;
      return ENTITIES[body] ?? whole;
    },
  );
}

function codePoint(value: number): string | undefined {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return undefined;
  if (value >= 0xd800 && value <= 0xdfff) return undefined;
  return String.fromCodePoint(value);
}
