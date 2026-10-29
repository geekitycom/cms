import type { PermalinkBases } from '../content/taxonomy.ts';

/** The pages of the wiki index that start with one letter. */
export interface WikiGroup<T> {
  /** The letter, upper-cased and without its accent, or `#` for a page that starts with no letter. */
  readonly letter: string;
  readonly pages: readonly T[];
}

/** Where the wiki index lives: the wiki base itself. */
export function wikiIndexHref(bases: Pick<PermalinkBases, 'wiki'>): string {
  return `/${bases.wiki}/`;
}

/**
 * Entries A to Z by their label, ignoring case and accents, in a group for
 * each first letter.
 *
 * `Éclairs` sorts and files under E, as a reader looking for it would look.
 * A label that starts with a digit or a symbol goes under `#`, which comes
 * first because that is where those labels sort.
 */
export function wikiGroups<T>(entries: readonly T[], label: (entry: T) => string): WikiGroup<T>[] {
  const sorted = [...entries].sort((a, b) =>
    label(a).localeCompare(label(b), undefined, { sensitivity: 'base', numeric: true }),
  );
  const groups = new Map<string, T[]>();
  for (const entry of sorted) {
    const letter = indexLetter(label(entry));
    const group = groups.get(letter);
    if (group === undefined) groups.set(letter, [entry]);
    else group.push(entry);
  }
  return [...groups].map(([letter, pages]) => ({ letter, pages }));
}

function indexLetter(label: string): string {
  const [first = ''] = label.trim().normalize('NFD');
  return /^\p{L}$/u.test(first) ? first.toLocaleUpperCase() : '#';
}
