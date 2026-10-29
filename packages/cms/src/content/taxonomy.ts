/**
 * Where the taxonomy archives live, and how their URLs are spelled.
 *
 * The bases are a setting rather than a constant: a site moving off WordPress
 * keeps `/tag/` and `/category/`, and a site that spells them otherwise says
 * so on the settings screen. Everything that builds or parses one of those
 * URLs — the public routes, the canonical redirects, the feeds, the theme, the
 * ActivityStreams hashtags — goes through this module, so they cannot
 * disagree about where an archive is.
 */

import { tagKey } from './tags.ts';

/** Where a paginated listing's later pages live, under any listing root. */
export const PAGE_SEGMENT = 'page';

/** Which taxonomy an archive is over. */
export type Taxonomy = 'tag' | 'category';

/** Both taxonomies, in the order a screen or a loop should take them. */
export const TAXONOMIES: readonly Taxonomy[] = ['tag', 'category'];

/** One archive: a taxonomy and the term whose documents it lists. */
export interface TaxonomyTerm {
  /** `tag` or `category`. */
  taxonomy: Taxonomy;
  /** The term itself, as the file spells it. */
  term: string;
}

/** The URL segment each taxonomy's archives live under. */
export type TaxonomyBases = Readonly<Record<Taxonomy, string>>;

/**
 * One term that was renamed, and what it was renamed to.
 *
 * A rename moves an archive, and an archive is a URL somebody may have linked
 * to. The site records the move so the old URL can point at the new one for as
 * long as it says so — a small list in the settings, and so in `site.json`,
 * where an Eleventy build of the same content can publish the same redirects.
 */
export interface TaxonomyRedirect {
  /** Which taxonomy's archive moved. */
  taxonomy: Taxonomy;
  /** The term that used to be there. */
  from: string;
  /** The term that is there now. */
  to: string;
}

/**
 * The bases a site has before anybody says otherwise: WordPress's own, so a
 * site imported from it keeps every archive URL it had published.
 */
export const DEFAULT_TAXONOMY_BASES: TaxonomyBases = {
  tag: 'tag',
  category: 'category',
};

/**
 * Every path prefix the site's settings choose: the two taxonomy archives,
 * and the wiki. They share the rules a base is checked by, and none of them
 * may be another's word, because each is the first segment the router
 * matches a whole family of URLs on.
 */
export type PermalinkBase = Taxonomy | 'wiki';

/** Every base, in the order a screen or a loop should take them. */
export const PERMALINK_BASES: readonly PermalinkBase[] = [...TAXONOMIES, 'wiki'];

/** The URL segment each family of URLs lives under. */
export type PermalinkBases = Readonly<Record<PermalinkBase, string>>;

/** The bases a site has before anybody says otherwise. */
export const DEFAULT_PERMALINK_BASES: PermalinkBases = {
  ...DEFAULT_TAXONOMY_BASES,
  wiki: 'wiki',
};

/** The word each base is named by in a sentence. */
const PERMALINK_BASE_LABELS: Readonly<Record<PermalinkBase, string>> = {
  tag: 'tag',
  category: 'category',
  wiki: 'wiki',
};

/** The word each taxonomy is called on a screen. */
export const TAXONOMY_LABELS: Readonly<Record<Taxonomy, string>> = {
  tag: 'tag',
  category: 'category',
};

/**
 * What a base may be made of: one path segment, starting with a letter or a
 * digit, of at most 64 characters.
 *
 * Deliberately narrower than what a URL would carry. A base is the first
 * segment of every archive URL the site publishes and the thing the router
 * matches on, so it holds nothing that would need percent-encoding, nothing
 * that could be read as a file extension, and no slash that would make it two
 * segments.
 */
export const TAXONOMY_BASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Top-level paths the site already answers on, which a base may not take over.
 *
 * `feed` was here before anything served it, because the feeds were going to
 * live at `/feed/` and a site that had taken the word would have found its
 * archives shadowed by the upgrade that put them there. `comments` is the
 * site-wide comments feed's root, for the same reason. `taxonomy.test.ts` pins
 * this list against the prefixes those routes are actually registered under, so
 * it cannot fall behind them.
 *
 * `sitemap.xml` and `robots.txt` are here because they are paths the site
 * answers on, which is what the list is: {@link TAXONOMY_BASE_PATTERN} would
 * refuse either of them anyway for the dot, so the entries are belt and
 * braces rather than the only thing standing in the way.
 *
 * `author` and `inbox` are reserved harder than the rest. Every
 * user is an actor at `/author/{username}/` and the shared inbox is `/inbox/`,
 * and an actor id is a name a follower's server has filed the account under:
 * a base that took one of those words would not shadow an archive, it would
 * unmake an account. `content/authors.ts` spells them as `AUTHOR_BASE` and
 * `INBOX_BASE`, and `taxonomy.test.ts` holds this list against those two
 * constants, so the reservation and the URLs cannot drift apart; they are
 * literals here only because that module reads {@link PAGE_SEGMENT} from this
 * one, and a cycle between two files of constants is not worth the tidiness.
 */
export const RESERVED_TOP_LEVEL_PATHS: readonly string[] = [
  PAGE_SEGMENT,
  'feed',
  'comments',
  'admin',
  'theme',
  'uploads',
  'nodeinfo',
  'author',
  'inbox',
  'sitemap.xml',
  'robots.txt',
  'search',
];

/**
 * What makes two spellings one term: a tag's key, which ignores case,
 * or a category exactly as it is spelled.
 */
export function termKey(taxonomy: Taxonomy, term: string): string {
  return taxonomy === 'tag' ? tagKey(term) : term;
}

function sameTerm(taxonomy: Taxonomy, a: string, b: string): boolean {
  return termKey(taxonomy, a) === termKey(taxonomy, b);
}

/**
 * The URL of a page of either taxonomy's archive, by zero-based index. A tag's
 * archive is at its key, so every casing of it has one URL.
 *
 * This is the one place a taxonomy archive URL is spelled, so the routes, the
 * pager, the canonical redirect, the theme links and the ActivityStreams
 * hashtags cannot disagree about where an archive lives.
 */
export function termHref(term: TaxonomyTerm, index: number, bases: TaxonomyBases): string {
  const root = `/${bases[term.taxonomy]}/${encodeURIComponent(termKey(term.taxonomy, term.term))}/`;
  return index === 0 ? root : `${root}${PAGE_SEGMENT}/${String(index + 1)}/`;
}

/** The URL of a page of a tag archive, by zero-based index. */
export function tagHref(tag: string, index: number, bases: TaxonomyBases): string {
  return termHref({ taxonomy: 'tag', term: tag }, index, bases);
}

/** The URL of a page of a category archive, by zero-based index. */
export function categoryHref(category: string, index: number, bases: TaxonomyBases): string {
  return termHref({ taxonomy: 'category', term: category }, index, bases);
}

/** The taxonomy a first URL segment names, or `undefined` when it names none. */
export function taxonomyForSegment(
  segment: string | undefined,
  bases: TaxonomyBases,
): Taxonomy | undefined {
  if (segment === undefined) return undefined;
  for (const taxonomy of TAXONOMIES) {
    if (bases[taxonomy] === segment) return taxonomy;
  }
  return undefined;
}

/** One message per base that cannot be used. An empty object is a valid set. */
export type PermalinkBaseProblems = Partial<Record<PermalinkBase, string>>;

/**
 * What is wrong with a set of bases, one message per base.
 *
 * The set is checked together rather than one base at a time because one of
 * the rules is about the set: no two of them may be the same word. A clash is
 * named on both fields, so whichever one the operator meant to change, the
 * message is beside it.
 */
export function permalinkBaseProblems(bases: PermalinkBases): PermalinkBaseProblems {
  const problems: PermalinkBaseProblems = {};

  for (const base of PERMALINK_BASES) {
    const value = bases[base].trim();
    const label = PERMALINK_BASE_LABELS[base];

    if (value === '') {
      problems[base] = `The ${label} base cannot be empty.`;
    } else if (!TAXONOMY_BASE_PATTERN.test(value)) {
      problems[base] =
        `A ${label} base is one path segment: up to 64 letters, digits, dashes or ` +
        'underscores, starting with a letter or a digit, and no slash.';
    } else if (RESERVED_TOP_LEVEL_PATHS.includes(value.toLowerCase())) {
      problems[base] =
        `“${value}” is already a path this site answers on. Reserved: ` +
        `${RESERVED_TOP_LEVEL_PATHS.join(', ')}.`;
    }
  }

  const usable = PERMALINK_BASES.filter((base) => problems[base] === undefined);
  usable.forEach((first, index) => {
    for (const second of usable.slice(index + 1)) {
      if (bases[first].trim() !== bases[second].trim()) continue;
      const message =
        `The ${PERMALINK_BASE_LABELS[first]} base and the ${PERMALINK_BASE_LABELS[second]} ` +
        'base have to be different words.';
      problems[first] ??= message;
      problems[second] ??= message;
    }
  });

  return problems;
}

/**
 * A set of bases as they should be stored: trimmed, and each replaced by its
 * default when it is not usable. Only for reading a value back out of storage
 * or a data file, where a bad value should not take the site down; a value on
 * its way in goes through {@link permalinkBaseProblems} and is refused.
 */
export function permalinkBasesOrDefault(
  bases: Partial<Record<PermalinkBase, unknown>>,
): PermalinkBases {
  const candidate: Record<PermalinkBase, string> = { ...DEFAULT_PERMALINK_BASES };

  for (const base of PERMALINK_BASES) {
    const value = bases[base];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (TAXONOMY_BASE_PATTERN.test(trimmed) && !RESERVED_TOP_LEVEL_PATHS.includes(trimmed)) {
      candidate[base] = trimmed;
    }
  }

  // Two bases that are one word would make one family of URLs unreachable, so
  // a set that collides falls back to the defaults rather than serving half
  // of what was asked for.
  const distinct = new Set(PERMALINK_BASES.map((base) => candidate[base])).size;
  return distinct === PERMALINK_BASES.length ? candidate : DEFAULT_PERMALINK_BASES;
}

/**
 * The recorded renames after one more, with chains collapsed.
 *
 * Three rules, all of them about not making a browser walk a history it does
 * not care about. Anything that pointed at `from` is repointed at `to`, so
 * `a → b` followed by `b → c` is stored as `a → c` and answered in one hop. An
 * older record of `from` moving somewhere else is replaced, because it is no
 * longer true. And any record of `to` having moved away is dropped, because
 * the term is back and an archive that answers always beats a record of where
 * it used to be.
 */
export function recordTermRename(
  existing: readonly TaxonomyRedirect[],
  change: TaxonomyRedirect,
): TaxonomyRedirect[] {
  const recorded: TaxonomyRedirect[] = [];

  for (const entry of existing) {
    if (entry.taxonomy !== change.taxonomy) {
      recorded.push(entry);
      continue;
    }
    const same = (a: string, b: string) => sameTerm(change.taxonomy, a, b);
    if (same(entry.from, change.from) || same(entry.from, change.to)) continue;
    recorded.push(same(entry.to, change.from) ? { ...entry, to: change.to } : entry);
  }

  recorded.push(change);
  return recorded.filter((entry) => !sameTerm(entry.taxonomy, entry.from, entry.to));
}

/**
 * The recorded renames after a term is deleted.
 *
 * Every record pointing at it goes: the archive it named is about to 404, and
 * a redirect to a 404 costs a round trip and tells the reader nothing. So does
 * any record of that term having moved, which the delete has just settled.
 */
export function forgetTerm(
  existing: readonly TaxonomyRedirect[],
  taxonomy: Taxonomy,
  term: string,
): TaxonomyRedirect[] {
  return existing.filter(
    (entry) =>
      entry.taxonomy !== taxonomy ||
      (!sameTerm(taxonomy, entry.from, term) && !sameTerm(taxonomy, entry.to, term)),
  );
}

/**
 * Where a term went, or `undefined` when nothing says it went anywhere.
 *
 * One hop, deliberately: the list is written with its chains already collapsed
 * ({@link recordTermRename}), and following it further would let a hand-edited
 * `site.json` send a reader round a loop.
 */
export function redirectedTerm(
  redirects: readonly TaxonomyRedirect[],
  term: TaxonomyTerm,
): string | undefined {
  const found = redirects.find(
    (entry) => entry.taxonomy === term.taxonomy && sameTerm(term.taxonomy, entry.from, term.term),
  );
  return found?.to;
}

/**
 * A value out of `site.json` or a stored setting as the renames it names.
 *
 * Tolerant, like everything that reads that file: an entry that is not a
 * `{ taxonomy, from, to }` of three non-empty strings is dropped rather than
 * failing the read, and so is one that redirects a term to itself.
 */
export function taxonomyRedirectsOf(value: unknown): TaxonomyRedirect[] {
  if (!Array.isArray(value)) return [];

  const redirects: TaxonomyRedirect[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const taxonomy = record['taxonomy'];
    const from = record['from'];
    const to = record['to'];

    if (!TAXONOMIES.includes(taxonomy as Taxonomy)) continue;
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    if (from.trim() === '' || to.trim() === '') continue;
    if (sameTerm(taxonomy as Taxonomy, from, to)) continue;

    redirects.push({ taxonomy: taxonomy as Taxonomy, from, to });
  }
  return redirects;
}
