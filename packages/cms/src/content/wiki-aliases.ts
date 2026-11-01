import type { Document } from './document.ts';
import { slugify, wikiBaseOf } from './slug.ts';

/** The front matter key that lists the other names a wiki page answers to. */
export const ALIASES_FRONT_MATTER_KEY = 'aliases';

type Aliased = Pick<Document, 'type' | 'slug' | 'permalink' | 'extra'>;

/**
 * The names a wiki page answers to besides its own, as written. One name may
 * be a bare string. A post or a page has none.
 */
export function aliasesOf(document: Aliased): string[] {
  if (document.type !== 'wiki') return [];
  const value = document.extra[ALIASES_FRONT_MATTER_KEY];
  const names = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  return distinctAliases(
    names.filter((name): name is string => typeof name === 'string'),
    document.slug,
  );
}

/**
 * The names worth keeping: trimmed, the first of any that share a slug, and
 * none that slugifies to nothing or to the page's own slug.
 */
export function distinctAliases(names: readonly string[], ownSlug: string): string[] {
  const seen = new Set([ownSlug]);
  const kept: string[] = [];
  for (const name of names.map((entry) => entry.trim())) {
    const slug = slugify(name);
    if (slug === '' || seen.has(slug)) continue;
    seen.add(slug);
    kept.push(name);
  }
  return kept;
}

/** The slugs a wiki page's aliases claim under the wiki base. */
export function aliasSlugsOf(document: Aliased): string[] {
  return aliasesOf(document).map(slugify);
}

/**
 * The paths a wiki page's aliases claim, worked out from its permalink, so
 * they move with the wiki base as the page does.
 */
export function aliasPathsOf(document: Aliased): string[] {
  const base = wikiBaseOf(document);
  if (base === undefined) return [];
  return aliasSlugsOf(document).map((slug) => `/${base}/${slug}/`);
}
