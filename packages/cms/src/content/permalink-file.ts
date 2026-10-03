import path from 'node:path';

import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';

const PERMALINK_FILE_MODE = 0o600;

/**
 * A private file under `dataDir` that keeps one value per post, keyed by its
 * permalink (decision-29): never under `content/`, mode 0600, written
 * atomically under the per-file lock and only when something changed.
 */
export interface PermalinkFile<T> {
  read(permalink: string): T | undefined;
  /** Keep `value` for the post, or forget what it had when `value` is nothing worth keeping. */
  set(permalink: string, value: T | undefined): Promise<void>;
  move(from: string, to: string): Promise<void>;
}

/**
 * The file `name` under `dataDir`. `parse` reads one stored value, or one
 * about to be stored, and answers `undefined` for one that is not worth
 * keeping, which drops it.
 */
export function permalinkFile<T>(
  dataDir: string,
  name: string,
  parse: (value: unknown) => T | undefined,
): PermalinkFile<T> {
  const file = path.join(dataDir, name);
  let cachedText: string | undefined;
  let cached: Record<string, T> = {};

  function parseAll(text: string): Record<string, T> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {};
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const all: Record<string, T> = {};
    for (const [permalink, value] of Object.entries(parsed as Record<string, unknown>)) {
      const kept = parse(value);
      if (kept !== undefined) all[permalink] = kept;
    }
    return all;
  }

  function readAll(): Record<string, T> {
    const text = readFileIfPresentSync(file);
    if (text === undefined) {
      cachedText = undefined;
      cached = {};
    } else if (text !== cachedText) {
      cachedText = text;
      cached = parseAll(text);
    }
    return cached;
  }

  function writeIfChanged(change: (all: Record<string, T>) => boolean): Promise<void> {
    return withFileLock(file, () => {
      const current = readFileIfPresentSync(file);
      const all = current === undefined ? {} : parseAll(current);
      if (change(all)) {
        writeFileAtomicallySync(file, `${JSON.stringify(all, null, 2)}\n`, {
          mode: PERMALINK_FILE_MODE,
        });
      }
    });
  }

  return {
    read(permalink) {
      return readAll()[permalink];
    },

    set(permalink, value) {
      const stored = value === undefined ? undefined : parse(value);
      return writeIfChanged((all) => {
        if (JSON.stringify(all[permalink]) === JSON.stringify(stored)) return false;
        if (stored === undefined) delete all[permalink];
        else all[permalink] = stored;
        return true;
      });
    },

    move(from, to) {
      return writeIfChanged((all) => {
        const value = all[from];
        if (value === undefined || from === to) return false;
        delete all[from];
        all[to] = value;
        return true;
      });
    },
  };
}
