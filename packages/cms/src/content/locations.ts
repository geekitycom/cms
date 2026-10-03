import path from 'node:path';

import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { locationOf } from './location.ts';
import type { PostLocation } from './location.ts';

export const LOCATIONS_FILE = 'locations.json';

const LOCATIONS_FILE_MODE = 0o600;

export interface PostLocations {
  read(permalink: string): PostLocation | undefined;
  set(permalink: string, location: PostLocation | undefined): Promise<void>;
  move(from: string, to: string): Promise<void>;
}

type Stored = Record<string, PostLocation>;

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

  function writeIfChanged(change: (all: Stored) => boolean): Promise<void> {
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
      const stored = location === undefined ? undefined : locationOf(location);
      return writeIfChanged((all) => {
        if (sameLocation(all[permalink], stored)) return false;
        if (stored === undefined) delete all[permalink];
        else all[permalink] = stored;
        return true;
      });
    },

    move(from, to) {
      return writeIfChanged((all) => {
        const location = all[from];
        if (location === undefined || from === to) return false;
        delete all[from];
        all[to] = location;
        return true;
      });
    },
  };
}

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

function sameLocation(a: PostLocation | undefined, b: PostLocation | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
