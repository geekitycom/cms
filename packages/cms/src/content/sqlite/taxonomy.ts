import type { TaxonomyReader } from '../store.ts';
import { tagKey } from '../tags.ts';
import type { Taxonomy } from '../taxonomy.ts';
import { LISTED_CLAUSE, TERM_TABLES } from './clauses.ts';
import type { TermTable } from './clauses.ts';
import { nowKey, cachedStatement, stringOrUndefined } from './database.ts';
import type { IndexDatabase } from './database.ts';
import { siteSpellings, SPELLING_EXCLUDING_SQL } from './spellings.ts';

const TAG_COUNTS_SQL = `
  SELECT document_tags.key AS key, MIN(document_tags.tag) AS tag, COUNT(*) AS count
  FROM document_tags
  JOIN documents ON documents.path = document_tags.path
  WHERE ${LISTED_CLAUSE}
  GROUP BY document_tags.key
`;

const CATEGORY_COUNTS_SQL = `
  SELECT document_categories.category AS category, COUNT(*) AS count
  FROM document_categories
  JOIN documents ON documents.path = document_categories.path
  WHERE ${LISTED_CLAUSE}
  GROUP BY document_categories.category
  ORDER BY count DESC, category ASC
`;

const TERM_USAGE_SQL: Readonly<Record<Taxonomy, string>> = {
  tag: termUsageSql(TERM_TABLES.tag),
  category: termUsageSql(TERM_TABLES.category),
};

export function taxonomyReader(index: IndexDatabase): TaxonomyReader {
  return {
    listTags() {
      const spellings = siteSpellings(index);
      return cachedStatement(index, TAG_COUNTS_SQL)
        .all(nowKey(index))
        .map((row) => ({
          tag: spellings.get(String(row['key'])) ?? String(row['tag']),
          count: Number(row['count']),
        }))
        .sort((a, b) => b.count - a.count || compareByUtf16CodeUnit(a.tag, b.tag));
    },

    listCategories() {
      return cachedStatement(index, CATEGORY_COUNTS_SQL)
        .all(nowKey(index))
        .map((row) => ({ category: String(row['category']), count: Number(row['count']) }));
    },

    listTermUsage(taxonomy) {
      const spellings: ReadonlyMap<string, string> =
        taxonomy === 'tag' ? siteSpellings(index) : new Map();
      return cachedStatement(index, TERM_USAGE_SQL[taxonomy])
        .all(nowKey(index))
        .map((row) => ({
          term: spellings.get(String(row['key'])) ?? String(row['term']),
          published: Number(row['published']),
          total: Number(row['total']),
        }))
        .sort((a, b) => compareByUtf16CodeUnit(a.term, b.term));
    },

    tagSpelling(tag, options = {}) {
      if (options.excluding === undefined) return siteSpellings(index).get(tagKey(tag));
      const row = cachedStatement(index, SPELLING_EXCLUDING_SQL).get(
        { key: tagKey(tag), excluding: options.excluding },
        nowKey(index),
      );
      return stringOrUndefined(row?.['tag']);
    },
  };
}

function termUsageSql({ table, matchColumn, column }: TermTable): string {
  return `
    SELECT ${table}.${matchColumn} AS key, MIN(${table}.${column}) AS term,
      COALESCE(SUM(${LISTED_CLAUSE}), 0) AS published,
      COUNT(*) AS total
    FROM ${table}
    JOIN documents ON documents.path = ${table}.path
    GROUP BY ${table}.${matchColumn}
  `;
}

function compareByUtf16CodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
