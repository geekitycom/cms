import type { WatchDebounce } from '../content/index.ts';
import { nextEvent } from './wait.ts';

export function heldDebounce(): {
  readonly debounce: WatchDebounce;
  holding(path: string): Promise<void>;
  release(path: string): void;
  releaseHeldThenPassThrough(): void;
} {
  const held = new Map<string, () => void>();
  const changed = new Set<() => void>();
  let passing = false;

  const debounce: WatchDebounce = (path, run) => {
    if (passing) {
      const immediate = setImmediate(run);
      return () => clearImmediate(immediate);
    }
    held.set(path, run);
    for (const listener of changed) listener();
    return () => {
      if (held.get(path) === run) held.delete(path);
    };
  };

  function release(path: string): void {
    const run = held.get(path);
    if (run === undefined) throw new Error(`nothing is held for ${path}`);
    held.delete(path);
    run();
  }

  return {
    debounce,
    holding(path) {
      return nextEvent(`the watcher to hold a change to ${path}`, (done) => {
        const check = () => {
          if (held.has(path)) done();
        };
        changed.add(check);
        check();
        return () => changed.delete(check);
      });
    },
    release,
    releaseHeldThenPassThrough() {
      passing = true;
      for (const path of [...held.keys()]) release(path);
    },
  };
}
