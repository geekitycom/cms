import { statSync } from 'node:fs';

import { readFileIfPresentSync, writeFileAtomicallySync } from '../files/atomic.ts';
import { relayList } from '../site/setting-values.ts';
import type { SiteSettings } from '../site/settings.ts';
import {
  parseSiteJson,
  settingsFromSiteJson,
  siteDataPath,
  siteJsonText,
} from '../site/site-json.ts';
import { DEFAULT_MENU_NAME, menuItemsFromText } from '../web/navigation.ts';
import { taxonomyRedirectsOf } from '../web/taxonomy.ts';
import type { TaxonomyRedirect } from '../web/taxonomy.ts';
import type { AdminStore, LegacySetting } from './store.ts';

/**
 * Turn an older site's settings rows into `content/_data/site.json`, once, and
 * drop the table.
 *
 * TASK-14 made SQLite the source and the file its mirror; decision-9 reversed
 * that, and a site upgrading across the two has rows nothing would ever read
 * again. So the first boot of this version writes them out. Which side wins
 * when both have something to say is decided the way it is decided everywhere
 * else: the file wins when it was written after the last save, because that is
 * a hand edit or a restored checkout, and the rows win otherwise. Either way
 * the actor handle and type come from the rows, because `site.json` never
 * carried them and losing them would rename the site's actor.
 *
 * Synchronous because `createCms` is: it runs before the server is listening
 * and before anything else has touched the file.
 */
export function migrateSettingsToFile(options: { admin: AdminStore; contentDir: string }): void {
  const { admin, contentDir } = options;
  const rows = admin.legacySettings();

  if (rows !== undefined && rows.length > 0) {
    const stored = settingsFromRows(rows);
    const file = siteDataPath(contentDir);
    const existing = parseSiteJson(readFileIfPresentSync(file) ?? '');
    const settings = fileWasEditedLast(file, rows) ? settingsFromSiteJson(existing) : stored;

    writeFileAtomicallySync(file, siteJsonText(settings, existing));
  }

  // Dropped whether or not it had rows: a fresh database gets the table from
  // migration 3, which has shipped and so is never edited, and a site that has
  // been migrated must not be asked again on the next boot.
  admin.dropLegacyTable('settings');
}

/** The old key/value rows as settings, defaults filled in. */
function settingsFromRows(rows: readonly LegacySetting[]): SiteSettings {
  const stored: Record<string, string> = {};
  for (const row of rows) stored[row.key] = row.value;

  // Through the file's own reader, so one description of what a setting is
  // worth serves both: the rows are spelled as the file spells them and read
  // back the same way. `relays`, `navigation` and `taxonomyRedirects` were
  // stored one entry per line, which is not how the file holds them.
  return settingsFromSiteJson({
    ...stored,
    ...(stored['baseUrl'] === undefined ? {} : { url: stored['baseUrl'] }),
    ...(stored['postsPerPage'] === undefined
      ? {}
      : { postsPerPage: Number(stored['postsPerPage']) }),
    relays: relayList(stored['relays'] ?? ''),
    menus: { [DEFAULT_MENU_NAME]: menuItemsFromText(stored['navigation'] ?? '') },
    taxonomyRedirects: redirectList(stored['taxonomyRedirects'] ?? ''),
  });
}

/**
 * Whether `site.json` has been written since the newest settings row was.
 *
 * A missing file has not, so the rows win. A file whose modification time
 * cannot be read is treated the same way: the rows are the only thing that is
 * certainly there.
 */
function fileWasEditedLast(file: string, rows: readonly LegacySetting[]): boolean {
  let modified: number;
  try {
    modified = statSync(file).mtimeMs;
  } catch {
    return false;
  }

  const newest = rows.reduce((latest, row) => {
    const at = Date.parse(row.updatedAt);
    return Number.isNaN(at) ? latest : Math.max(latest, at);
  }, 0);

  return modified > newest;
}

/**
 * A `taxonomy|from|to` block as the renames it names, which is how the old
 * settings table spelled them ({@link migrateSettingsToFile}).
 *
 * The same tolerance the rest of this file reads its lists with: a line that
 * is not three non-empty parts naming a real taxonomy is dropped rather than
 * failing the read.
 */
function redirectList(value: string): TaxonomyRedirect[] {
  const entries: Record<string, unknown>[] = [];
  for (const line of value.split('\n')) {
    const parts = line.split('|');
    if (parts.length !== 3) continue;
    entries.push({
      taxonomy: (parts[0] ?? '').trim(),
      from: (parts[1] ?? '').trim(),
      to: (parts[2] ?? '').trim(),
    });
  }
  // Through the same reader `site.json` goes through, so the two spellings of
  // the list cannot mean different things.
  return taxonomyRedirectsOf(entries);
}
