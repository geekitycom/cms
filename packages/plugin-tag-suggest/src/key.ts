/** Letters NFKD leaves whole, spelled out as tags.pub spells them. */
const TRANSLITERATIONS: readonly (readonly [RegExp, string])[] = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/đ|ð/g, 'd'],
  [/ł/g, 'l'],
  [/þ/g, 'th'],
];

/**
 * A tag as tags.pub names its account: lower case ASCII letters and digits,
 * accents dropped, everything else removed. tags.pub folds every tag this way
 * and refuses a spelling that is not already folded, and a tag in a script it
 * folds by transliteration, such as `日本`, comes out empty here and is left
 * out rather than guessed at.
 */
export function hashtagKey(tag: string): string {
  let value = tag.normalize('NFKD').toLowerCase();
  for (const [pattern, replacement] of TRANSLITERATIONS)
    value = value.replace(pattern, replacement);
  return value.replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

/**
 * A tag as the author reads it: no `#`, and several words joined in
 * CamelCase, so `WordCamp US` becomes `WordCampUS` and `indie-web` becomes
 * `IndieWeb`. One word keeps the case it came in.
 */
export function readableTag(tag: string): string {
  const words = tag
    .normalize('NFC')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word !== '');
  if (words.length === 1) return words[0] ?? '';
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}
