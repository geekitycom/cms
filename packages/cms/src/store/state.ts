import type { DatabaseSync } from 'node:sqlite';

export interface StateStore {
  /**
   * One piece of the CMS's own operational state, or `undefined`.
   *
   * Not a setting: nothing here is a site's choice and nothing here belongs in
   * `content/_data/site.json`, which is where a setting lives. It is a cache
   * like the rest of the database, and losing it costs a site nothing it
   * cannot work out again. The scheduler's watermark — how far through the
   * calendar it has got — lives here.
   */
  getState(key: string): string | undefined;
  /** Write one piece of that state. */
  setState(key: string, value: string): void;
}

export function openStateStore(db: DatabaseSync): StateStore {
  const statements = {
    getState: db.prepare('SELECT value FROM cms_state WHERE key = ?'),
    putState: db.prepare(`
      INSERT INTO cms_state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
  };
  return {
    getState(key) {
      const row = statements.getState.get(key) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : String(row['value']);
    },

    setState(key, value) {
      statements.putState.run(key, value, new Date().toISOString());
    },
  };
}
