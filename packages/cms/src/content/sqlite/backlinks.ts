import type { Document } from '../document.ts';
import { NO_REDIRECTS } from '../redirects.ts';
import { linksInto, siteLinkKey, spelling } from '../site-links.ts';
import type { BacklinkReader, BacklinkSite } from '../store.ts';
import { LISTED_CLAUSE, SERVED_CLAUSE } from './clauses.ts';
import { nowKey, cachedStatement, stringOrUndefined } from './database.ts';
import type { IndexDatabase, Row } from './database.ts';
import { selectNewestFirst } from './documents.ts';
import { BY_FORMER_PERMALINK_SQL, BY_PERMALINK_SQL } from './lookups.ts';

const SERVED_AT_SQL = `SELECT 1 FROM documents WHERE permalink = ? AND ${SERVED_CLAUSE} LIMIT 1`;

const LINKS_INTO = `path IN (
  SELECT path FROM document_links
  WHERE target IN (SELECT value FROM json_each(?))
    AND (query = '' OR target || '?' || query NOT IN (SELECT value FROM json_each(?)))
  UNION
  SELECT path FROM document_links
  WHERE target IN (SELECT value FROM json_each(?))
    AND target || '?' || query IN (SELECT value FROM json_each(?))
)`;

export function backlinkReader(index: IndexDatabase): BacklinkReader {
  return { listBacklinks: (document, site = {}) => listBacklinks(index, document, site) };
}

function listBacklinks(index: IndexDatabase, document: Document, site: BacklinkSite): Document[] {
  const now = nowKey(index);
  const answeredAt = linkKeysOf(index, document);
  if (site.home === true) answeredAt.push('/');
  const into = linksInto(site.redirects ?? NO_REDIRECTS, answeredAt, (sitePath) =>
    [sitePath, `${sitePath}/`].some(
      (url) =>
        cachedStatement(index, SERVED_AT_SQL).get(url, now) !== undefined ||
        cachedStatement(index, BY_FORMER_PERMALINK_SQL).get(url, now) !== undefined,
    ),
  );
  return selectNewestFirst(
    index,
    [LISTED_CLAUSE, 'path <> ?', LINKS_INTO],
    [
      now,
      document.path,
      JSON.stringify(into.paths),
      JSON.stringify(into.intercepted),
      JSON.stringify(into.queries.map((link) => link.path)),
      JSON.stringify(into.queries.map(spelling)),
    ],
    {},
  );
}

/**
 * The paths a link to `document` may name: its permalink, and each of its
 * former ones that the site still answers with it rather than with a live
 * document holding it now or another document claiming it.
 */
function linkKeysOf(index: IndexDatabase, document: Document): string[] {
  const former = (document.redirectFrom ?? []).filter(
    (url) =>
      cachedStatement(index, BY_PERMALINK_SQL).get(url) === undefined &&
      stringOrUndefined(
        (
          cachedStatement(index, BY_FORMER_PERMALINK_SQL).get(url, nowKey(index)) as Row | undefined
        )?.['path'],
      ) === document.path,
  );
  return [...new Set([document.permalink, ...former].map(siteLinkKey))];
}
