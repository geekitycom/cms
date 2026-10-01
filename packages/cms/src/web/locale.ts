/**
 * The locale a site's dates and counts are written in (TASK-153).
 *
 * One tag per render, resolved from the site data by `siteLocale` and handed
 * to every formatter, so a page never mixes two conventions.
 */

/** The locale of a site that names neither a locale nor a language. */
export const DEFAULT_LOCALE = 'en';

/**
 * A tag as Intl spells it, or `undefined` when Intl will not take it.
 *
 * The settings screen refuses a tag that fails here, so `undefined` means a
 * hand-edited `site.json` or a template argument, and the caller falls back
 * rather than letting a page throw.
 */
export function canonicalLocale(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag.trim())[0];
  } catch {
    return undefined;
  }
}

/**
 * `forms[category]` for `count`'s CLDR plural category in `locale`, with `#`
 * replaced by the count, or `forms.other` when the forms have no entry for
 * that category. Empty when there is neither.
 *
 * The count is written without grouping, so an `en` page says `1000 replies`
 * as it always has, while a locale with digits of its own still uses them.
 */
export function pluralForm(
  count: number,
  forms: Readonly<Record<string, unknown>>,
  locale: string,
): string {
  const category = new Intl.PluralRules(locale).select(count);
  const form = forms[category] ?? forms['other'];
  if (typeof form !== 'string') return '';

  const written = new Intl.NumberFormat(locale, { useGrouping: false }).format(count);
  return form.replaceAll('#', written);
}

/**
 * The front-matter key that names the language a post or a page is written
 * in, when it is not the site's (TASK-154). The name HTML gives the attribute,
 * so an Eleventy build reads the same key as page data.
 */
export const LANG_FRONT_MATTER_KEY = 'lang';

/**
 * The language a document says it is in, as a canonical BCP 47 tag, or
 * `undefined` when it names none or names something that is not a tag. The
 * one reading of {@link LANG_FRONT_MATTER_KEY}, so the page, the feeds and the
 * federated object cannot disagree about a hand-edited value.
 */
export function documentLanguage(document: {
  extra: Readonly<Record<string, unknown>>;
}): string | undefined {
  const tag = document.extra[LANG_FRONT_MATTER_KEY];
  return typeof tag === 'string' && tag.trim() !== '' ? canonicalLocale(tag) : undefined;
}
