import type { DocumentType } from './document.ts';

/**
 * Letters that Unicode decomposition leaves alone. NFKD splits `é` into `e` and
 * a combining accent, but `æ` and `ß` are letters in their own right, so they
 * need spelling out before the ASCII filter throws them away.
 */
const TRANSLITERATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/đ|ð/g, 'd'],
  [/ł/g, 'l'],
  [/þ/g, 'th'],
  [/ħ/g, 'h'],
  [/ı/g, 'i'],
  [/ŋ/g, 'n'],
];

/**
 * Turn a title into a URL slug: lowercase ASCII letters, digits and hyphens.
 *
 * Accented letters lose their accents, a few letters that do not decompose are
 * transliterated, and everything else becomes a separator. Returns an empty
 * string when nothing survives, so callers can fall back to something else.
 */
export function slugify(title: string): string {
  let value = title.normalize('NFKD').toLowerCase();

  for (const [pattern, replacement] of TRANSLITERATIONS) {
    value = value.replace(pattern, replacement);
  }

  return value
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** What {@link defaultPermalink} needs to know about a document. */
export interface DefaultPermalinkInput {
  type: DocumentType;
  slug: string;
  /** Publish date. Required for posts, ignored for pages. */
  date?: string | Date | undefined;
}

/**
 * The permalink the admin form proposes for a new document.
 *
 * Posts live under their year and month, pages at the top level. Both end in a
 * slash, which is the canonical form. The stored `permalink` is what actually
 * counts: this only fills the field in when the form supplies none.
 */
export function defaultPermalink(input: DefaultPermalinkInput): string {
  if (input.slug === '') {
    throw new TypeError('A permalink needs a non-empty slug.');
  }

  if (input.type === 'page') return `/${input.slug}/`;

  if (input.date === undefined) {
    throw new TypeError(`A post permalink needs a date; "${input.slug}" has none.`);
  }

  const { year, month } = yearAndMonth(input.date);
  return `/${year}/${month}/${input.slug}/`;
}

/**
 * Read the calendar year and month of a date as written, without shifting it
 * into UTC: a post published at 00:30 on 1 October in Berlin belongs to
 * October, not to September.
 */
function yearAndMonth(date: string | Date): { year: string; month: string } {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) {
      throw new TypeError('A post permalink needs a valid date.');
    }
    return {
      year: String(date.getUTCFullYear()).padStart(4, '0'),
      month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    };
  }

  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new TypeError(
      `A post permalink needs an ISO 8601 date, received ${JSON.stringify(date)}`,
    );
  }
  return { year: match[1], month: match[2] };
}
