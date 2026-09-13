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
 * `feed` was here before anything served it: TASK-37 put the feeds at `/feed/`,
 * and a site that had taken the word would find its archives shadowed by an
 * upgrade. `comments` is the site-wide comments feed's root, for the same
 * reason. `taxonomy.test.ts` pins this list against the prefixes those routes
 * are actually registered under, so it cannot fall behind them.
 *
 * `sitemap.xml` and `robots.txt` are here because they are paths the site
 * answers on, which is what the list is: {@link TAXONOMY_BASE_PATTERN} would
 * refuse either of them anyway for the dot, so the entries are belt and
 * braces rather than the only thing standing in the way.
 *
 * `author` and `inbox` are reserved harder than the rest (decision-14). Every
 * user is an actor at `/author/{username}/` and the shared inbox is `/inbox/`,
 * and an actor id is a name a follower's server has filed the account under:
 * a base that took one of those words would not shadow an archive, it would
 * unmake an account. `web/authors.ts` spells them as `AUTHOR_BASE` and
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
];

/**
 * The URL of a page of either taxonomy's archive, by zero-based index.
 *
 * This is the one place a taxonomy archive URL is spelled, so the routes, the
 * pager, the canonical redirect, the theme links and the ActivityStreams
 * hashtags cannot disagree about where an archive lives.
 */
export function termHref(term: TaxonomyTerm, index: number, bases: TaxonomyBases): string {
  const root = `/${bases[term.taxonomy]}/${encodeURIComponent(term.term)}/`;
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

/** One message per base that cannot be used. An empty object is a valid pair. */
export type TaxonomyBaseProblems = Partial<Record<Taxonomy, string>>;

/**
 * What is wrong with a pair of bases, one message per taxonomy.
 *
 * The pair is checked together rather than one at a time because two of the
 * rules are about the pair: they may not be the same word, and neither may be
 * a path the site already answers on.
 */
export function taxonomyBaseProblems(bases: TaxonomyBases): TaxonomyBaseProblems {
  const problems: TaxonomyBaseProblems = {};

  for (const taxonomy of TAXONOMIES) {
    const value = bases[taxonomy].trim();
    const label = TAXONOMY_LABELS[taxonomy];

    if (value === '') {
      problems[taxonomy] = `The ${label} base cannot be empty.`;
    } else if (!TAXONOMY_BASE_PATTERN.test(value)) {
      problems[taxonomy] =
        `A ${label} base is one path segment: up to 64 letters, digits, dashes or ` +
        'underscores, starting with a letter or a digit, and no slash.';
    } else if (RESERVED_TOP_LEVEL_PATHS.includes(value.toLowerCase())) {
      problems[taxonomy] =
        `“${value}” is already a path this site answers on. Reserved: ` +
        `${RESERVED_TOP_LEVEL_PATHS.join(', ')}.`;
    }
  }

  if (
    problems.tag === undefined &&
    problems.category === undefined &&
    bases.tag.trim() === bases.category.trim()
  ) {
    const message = 'The tag base and the category base have to be different words.';
    problems.tag = message;
    problems.category = message;
  }

  return problems;
}

/**
 * A pair of bases as they should be stored: trimmed, and each replaced by its
 * default when it is not usable. Only for reading a value back out of storage
 * or a data file, where a bad value should not take the site down; a value on
 * its way in goes through {@link taxonomyBaseProblems} and is refused.
 */
export function taxonomyBasesOrDefault(bases: Partial<Record<Taxonomy, unknown>>): TaxonomyBases {
  const candidate: Record<Taxonomy, string> = { ...DEFAULT_TAXONOMY_BASES };

  for (const taxonomy of TAXONOMIES) {
    const value = bases[taxonomy];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (TAXONOMY_BASE_PATTERN.test(trimmed) && !RESERVED_TOP_LEVEL_PATHS.includes(trimmed)) {
      candidate[taxonomy] = trimmed;
    }
  }

  // Two taxonomies at the same base would make one of the archives
  // unreachable, so a pair that collides falls back to the defaults rather
  // than serving half of what was asked for.
  return candidate.tag === candidate.category ? DEFAULT_TAXONOMY_BASES : candidate;
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
    if (entry.from === change.from || entry.from === change.to) continue;
    recorded.push(entry.to === change.from ? { ...entry, to: change.to } : entry);
  }

  recorded.push(change);
  return recorded.filter((entry) => entry.from !== entry.to);
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
    (entry) => entry.taxonomy !== taxonomy || (entry.from !== term && entry.to !== term),
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
    (entry) => entry.taxonomy === term.taxonomy && entry.from === term.term,
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
    if (from.trim() === '' || to.trim() === '' || from === to) continue;

    redirects.push({ taxonomy: taxonomy as Taxonomy, from, to });
  }
  return redirects;
}
