import path from 'node:path';

import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { locationOf } from './location.ts';
import type { PostLocation } from './location.ts';

/**
 * Where every post's location is kept (decision-29): one JSON object under
 * `dataDir`, keyed by the post's permalink, mode 0600.
 *
 * It is under `data/` and not `content/` because a location is personal data
 * and `content/` may be a public git repository. It is keyed by permalink
 * because that is a post's identity (decision-13) and what the syndication
 * copies are keyed by (decision-26). The editor's write path is the one
 * writer: it sets the entry on a save, removes it on a save with the fields
 * cleared, and moves it when a save moves the permalink.
 */

/** The file, relative to `dataDir`. */
export const LOCATIONS_FILE = 'locations.json';

/** Private to the process's user, like `users.json`. */
export const LOCATIONS_FILE_MODE = 0o600;

/** The stored locations, by permalink. */
export interface PostLocations {
  /** The location one post has, if any. Never touches the network. */
  read(permalink: string): PostLocation | undefined;
  /** Set one post's location, or with `undefined` remove it. */
  set(permalink: string, location: PostLocation | undefined): Promise<void>;
  /** Carry a post's location to its new permalink. Nothing stored moves nothing. */
  move(from: string, to: string): Promise<void>;
}

type Stored = Record<string, PostLocation>;

/** The locations file of one data directory. */
export function postLocations(dataDir: string): PostLocations {
  const file = path.join(dataDir, LOCATIONS_FILE);
  let cachedText: string | undefined;
  let cached: Stored = {};

  function readAll(): Stored {
    const text = readFileIfPresentSync(file);
    if (text === undefined) {
      cachedText = undefined;
      cached = {};
    } else if (text !== cachedText) {
      cachedText = text;
      cached = parseLocations(text);
    }
    return cached;
  }

  /**
   * Change the file under its lock, and write it only when something changed:
   * a save that leaves the location as it was must not rewrite the file.
   */
  function update(change: (all: Stored) => boolean): Promise<void> {
    return withFileLock(file, () => {
      const current = readFileIfPresentSync(file);
      const all = current === undefined ? {} : parseLocations(current);
      if (change(all)) {
        writeFileAtomicallySync(file, `${JSON.stringify(all, null, 2)}\n`, {
          mode: LOCATIONS_FILE_MODE,
        });
      }
    });
  }

  return {
    read(permalink) {
      return readAll()[permalink];
    },

    set(permalink, location) {
      // Spelled the one way the file spells every entry, so a location that
      // came back in another key order is the same location.
      const stored = location === undefined ? undefined : locationOf(location);
      return update((all) => {
        if (JSON.stringify(all[permalink]) === JSON.stringify(stored)) return false;
        if (stored === undefined) delete all[permalink];
        else all[permalink] = stored;
        return true;
      });
    },

    move(from, to) {
      return update((all) => {
        const location = all[from];
        if (location === undefined || from === to) return false;
        delete all[from];
        all[to] = location;
        return true;
      });
    },
  };
}

/** The file's entries, each checked, since a person may edit it by hand. */
function parseLocations(text: string): Stored {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const all: Stored = {};
  for (const [permalink, value] of Object.entries(parsed as Record<string, unknown>)) {
    const location = locationOf(value);
    if (location !== undefined) all[permalink] = location;
  }
  return all;
}
