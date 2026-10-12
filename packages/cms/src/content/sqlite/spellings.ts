import { LISTED_CLAUSE, NEXT_DUE_SQL } from './clauses.ts';
import { nowKey, cachedStatement, stringOrUndefined } from './database.ts';
import type { CachedSpellings, IndexDatabase, Row } from './database.ts';

const MOST_KEYS_REFRESHED = 500;

const SPELLINGS_SQL = tagSpellingsSql('');
const SPELLINGS_OF_KEYS_SQL = tagSpellingsSql(
  'WHERE spelled.key IN (SELECT value FROM json_each(:keys))',
);
export const SPELLING_EXCLUDING_SQL = tagSpellingsSql(
  'WHERE spelled.key = :key AND spelled.path <> :excluding',
);

export function siteSpellings(index: IndexDatabase): ReadonlyMap<string, string> {
  const { spellings } = index;
  const now = nowKey(index);
  const dataVersion = cachedStatement(index, 'PRAGMA data_version').get()?.['data_version'];
  const current =
    spellings.current === undefined || outOfDate(spellings.current, dataVersion, now)
      ? undefined
      : spellings.current.byKey;

  if (current !== undefined && spellings.staleKeys.size === 0) return current;

  const refreshStaleOnly = current !== undefined && spellings.staleKeys.size <= MOST_KEYS_REFRESHED;
  const byKey = refreshStaleOnly ? current : new Map<string, string>();
  const rows = refreshStaleOnly
    ? refreshStaleSpellings(index, byKey, now)
    : (cachedStatement(index, SPELLINGS_SQL).all(now) as Row[]);
  for (const row of rows) byKey.set(String(row['key']), String(row['tag']));
  spellings.staleKeys.clear();

  const nextScheduledAt = stringOrUndefined(
    (cachedStatement(index, NEXT_DUE_SQL).get(now) as Row)['due'],
  );
  spellings.current = { byKey, dataVersion, workedOutAt: now, nextScheduledAt };
  return byKey;
}

export function markTagsStaleBeforeWrite(index: IndexDatabase, contentPath: string): void {
  for (const row of cachedStatement(index, 'SELECT key FROM document_tags WHERE path = ?').all(
    contentPath,
  )) {
    index.spellings.staleKeys.add(String(row['key']));
  }
}

export function forgetSpellings(index: IndexDatabase): void {
  index.spellings.current = undefined;
  index.spellings.staleKeys.clear();
}

function refreshStaleSpellings(
  index: IndexDatabase,
  byKey: Map<string, string>,
  now: string,
): Row[] {
  const { staleKeys } = index.spellings;
  for (const key of staleKeys) byKey.delete(key);
  return cachedStatement(index, SPELLINGS_OF_KEYS_SQL).all(
    { keys: JSON.stringify([...staleKeys]) },
    now,
  ) as Row[];
}

function outOfDate(cache: CachedSpellings, dataVersion: unknown, now: string): boolean {
  return (
    anotherConnectionWrote(cache, dataVersion) ||
    scheduledPostCameDue(cache, now) ||
    clockWentBack(cache, now)
  );
}

function anotherConnectionWrote(cache: CachedSpellings, dataVersion: unknown): boolean {
  return cache.dataVersion !== dataVersion;
}

function scheduledPostCameDue(cache: CachedSpellings, now: string): boolean {
  return cache.nextScheduledAt !== undefined && now >= cache.nextScheduledAt;
}

function clockWentBack(cache: CachedSpellings, now: string): boolean {
  return now < cache.workedOutAt;
}

function tagSpellingsSql(where: string): string {
  return `
    SELECT key, tag FROM (
      SELECT key, tag, ROW_NUMBER() OVER (
        PARTITION BY key
        ORDER BY SUM(listed) DESC,
          MIN(CASE WHEN listed THEN date_sort END) ASC NULLS LAST,
          COUNT(*) DESC,
          MIN(date_sort) ASC NULLS LAST,
          tag ASC
      ) AS rank
      FROM (
        SELECT spelled.key AS key, spelled.tag AS tag,
          ${LISTED_CLAUSE} AS listed, spelled_in.date_sort AS date_sort
        FROM document_tags AS spelled
        JOIN documents AS spelled_in ON spelled_in.path = spelled.path
        ${where}
      )
      GROUP BY key, tag
    )
    WHERE rank = 1
  `;
}
